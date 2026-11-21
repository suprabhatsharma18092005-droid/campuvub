import { FIREBASE_PROJECT_ID } from './firebase-config';
import { sendPushToTokens, type PushPayload } from './fcm.server';

export async function deviceTokens(userIds?: string[]): Promise<string[]> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  let query = supabaseAdmin.from('push_devices').select('token').eq('project_id', FIREBASE_PROJECT_ID);
  if (userIds) {
    if (!userIds.length) return [];
    query = query.in('user_id', userIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => row.token);
}

export async function adminTokens(): Promise<string[]> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data, error } = await supabaseAdmin.from('user_roles').select('user_id').eq('role', 'admin');
  if (error) throw error;
  return deviceTokens((data ?? []).map((row) => row.user_id));
}

export const STATUS_COPY: Record<string, { title: string; body: string }> = {
  pending: { title: 'Order placed', body: 'Your order has been received.' },
  payment_review: { title: 'Payment under review', body: 'We are verifying your UPI payment.' },
  accepted: { title: 'Order Accepted! ✅', body: 'Your order is being prepared.' },
  preparing: { title: 'Preparing your order', body: 'Your order is being prepared.' },
  out_for_delivery: { title: 'Out for Delivery! 🛵', body: 'Your order is on the way to your room.' },
  delivered: { title: 'Delivered! 📦', body: 'Your order has been delivered. Enjoy!' },
  cancelled: { title: 'Order Cancelled ❌', body: 'Sorry, your order could not be fulfilled.' },
};

/** Await delivery, but never let a notification failure roll back a completed operation. */
export async function safelySendPush(tokens: () => Promise<string[]>, payload: PushPayload) {
  try {
    return await sendPushToTokens(await tokens(), payload);
  } catch (error) {
    console.error('Push delivery failed', error);
    return { sent: 0, staleTokens: [] as string[] };
  }
}

/** Telegram backup is sent by the database (queue + retry), so it works from every host. */
export async function sendNewOrderAlert(order: { id: string; total: number }) {
  return safelySendPush(adminTokens, {
    title: 'New Order! 🚀',
    body: `Order #${order.id.slice(0, 8).toUpperCase()} placed. Total: ₹${Number(order.total).toFixed(0)}.`,
    path: '/admin',
  });
}

export async function sendStatusAlert(order: { id: string; student_id: string; status: string }) {
  return safelySendPush(() => deviceTokens([order.student_id]), {
    ...(STATUS_COPY[order.status] ?? { title: 'Order updated', body: 'Your order status changed.' }),
    path: `/orders/${order.id}`,
  });
}

export async function sendVipRequestAlert(req: {
  id: string;
  customerName: string;
  utrNumber: string;
  amount: number;
}) {
  return safelySendPush(adminTokens, {
    title: `👑 New VIP Pass Request! (₹${Number(req.amount).toFixed(0)})`,
    body: `${req.customerName} submitted UTR ${req.utrNumber} for Campu VIP. Tap to approve.`,
    path: '/admin?tab=vip',
  });
}

export async function sendCoinRequestAlert(req: {
  requestId: string;
  customerName: string;
  utrNumber: string;
  coins: number;
  amount: number;
}) {
  return safelySendPush(adminTokens, {
    title: `🪙 New Coin Recharge Request! (${req.coins} Coins · ₹${Number(req.amount).toFixed(0)})`,
    body: `${req.customerName} submitted UTR ${req.utrNumber}. Tap to verify & credit.`,
    path: '/admin?tab=coins',
  });
}

export async function sendCoinStatusAlert(info: {
  userId: string;
  coins: number;
  status: 'approved' | 'rejected';
}) {
  return safelySendPush(() => deviceTokens([info.userId]), {
    title:
      info.status === 'approved'
        ? `🪙 ${info.coins} Campu Coins Added!`
        : 'Coin Recharge Rejected',
    body:
      info.status === 'approved'
        ? `${info.coins} coins (₹${info.coins}) are now ready in your Campu Wallet.`
        : `Your ₹${info.coins} coin recharge could not be verified. Contact support if needed.`,
    path: '/coins',
  });
}

export async function sendDeliveryAssignedAlert(info: {
  boyUserId: string;
  orderId: string;
  deliveryAddress: string;
  paymentMethod: 'UPI' | 'COD';
  paidWithCoins: boolean;
  codCollectAmount: number | null;
}) {
  const isPrepaid = info.paymentMethod === 'UPI' || info.paidWithCoins;
  const body = isPrepaid
    ? `Prepaid UPI order #${info.orderId.slice(0, 8).toUpperCase()} for ${info.deliveryAddress}.`
    : `COD order #${info.orderId.slice(0, 8).toUpperCase()} · Collect ₹${Number(info.codCollectAmount ?? 0).toFixed(0)} at ${info.deliveryAddress}.`;
  return safelySendPush(() => deviceTokens([info.boyUserId]), {
    title: '🛵 New Delivery Assigned!',
    body,
    path: '/delivery',
  });
}

export async function sendDeliveryPayoutRequestAlert(info: {
  boyName: string;
  amount: number;
  method: 'UPI' | 'COD';
  upiId?: string | null | undefined;
  bankingName?: string | null | undefined;
}) {
  const detail =
    info.method === 'UPI'
      ? `UPI: ${info.upiId ?? ''} (${info.bankingName ?? ''})`
      : 'Cash on Delivery (Cash Handover)';
  return safelySendPush(adminTokens, {
    title: `💸 Delivery Payout Request (₹${Number(info.amount).toFixed(0)})`,
    body: `${info.boyName} requested ₹${Number(info.amount).toFixed(0)} via ${detail}.`,
    path: '/admin?tab=delivery',
  });
}

export async function sendDeliveryPayoutStatusAlert(info: {
  boyUserId: string;
  amount: number;
  status: 'paid' | 'rejected';
  method: 'UPI' | 'COD';
}) {
  return safelySendPush(() => deviceTokens([info.boyUserId]), {
    title:
      info.status === 'paid'
        ? `💸 Payout Sent! (₹${Number(info.amount).toFixed(0)})`
        : 'Payout Request Rejected',
    body:
      info.status === 'paid'
        ? `Your ₹${Number(info.amount).toFixed(0)} ${info.method === 'UPI' ? 'UPI' : 'Cash'} payout has been completed.`
        : `Your ₹${Number(info.amount).toFixed(0)} payout request was declined by Admin.`,
    path: '/delivery',
  });
}
