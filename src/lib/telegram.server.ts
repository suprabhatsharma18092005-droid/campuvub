/** Backup alerts via Telegram. Skips silently when not configured; never throws. */
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/telegram';

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId: string | null | undefined, htmlText: string): Promise<boolean> {
  const targetChatId = chatId?.trim() || process.env['TELEGRAM_ADMIN_CHAT_ID']?.trim();
  if (!targetChatId) return false;

  const lovableKey = process.env['LOVABLE_API_KEY']?.trim();
  const telegramKey = process.env['TELEGRAM_API_KEY']?.trim();
  const botToken = process.env['TELEGRAM_BOT_TOKEN']?.trim();

  try {
    if (lovableKey && telegramKey) {
      const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          'X-Connection-Api-Key': telegramKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        console.error(`Telegram gateway alert failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    }

    if (botToken) {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text: htmlText, parse_mode: 'HTML' }),
      });
      if (!res.ok) {
        console.error(`Telegram bot alert failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
        return false;
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error('Telegram alert failed', error);
    return false;
  }
}

export async function sendTelegramOrderAlert(orderId: string): Promise<boolean> {
  const lovableKey = process.env['LOVABLE_API_KEY'];
  const telegramKey = process.env['TELEGRAM_API_KEY'];
  const chatId = process.env['TELEGRAM_ADMIN_CHAT_ID'];
  if (!lovableKey || !telegramKey || !chatId) return false;
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: order } = await supabaseAdmin.from('orders')
      .select('id,total,cart_items,payment_method,delivery_address,phone_number,student_id')
      .eq('id', orderId).maybeSingle();
    if (!order) return false;
    const { data: profile } = await supabaseAdmin.from('profiles').select('full_name').eq('id', order.student_id).maybeSingle();
    const items = (Array.isArray(order.cart_items) ? order.cart_items : []) as { name?: string; qty?: number }[];
    const text = [
      `🚀 <b>New Order #${order.id.slice(0, 8).toUpperCase()} - ₹${Number(order.total).toFixed(0)}</b>`,
      `👤 Student: ${esc(profile?.full_name ?? 'Student')} (${esc(order.delivery_address ?? '-')})`,
      order.phone_number ? `📞 ${esc(order.phone_number)}` : '',
      `📦 Items: ${esc(items.map((i) => `${i.qty ?? 1}x ${i.name ?? 'Item'}`).join(', '))}`,
      `💳 Payment: ${esc(order.payment_method)}`,
    ].filter(Boolean).join('\n');
    return sendTelegramMessage(chatId, text);
  } catch (error) {
    console.error('Telegram alert failed', error);
    return false;
  }
}

/** Sends a Delivery Boy assignment alert respecting strict UPI/COD privacy rules. */
export async function sendTelegramDeliveryBoyAlert(params: {
  boyName: string;
  boyChatId?: string | null | undefined;
  orderId: string;
  customerName: string;
  deliveryAddress: string;
  phoneNumber?: string | null | undefined;
  items: { name: string; qty: number; price: number }[];
  paymentMethod: 'UPI' | 'COD';
  paidWithCoins: boolean;
  codCollectAmount: number | null;
}): Promise<boolean> {
  const targetChat =
    params.boyChatId?.trim() ||
    process.env['TELEGRAM_DELIVERY_CHAT_ID']?.trim() ||
    process.env['TELEGRAM_ADMIN_CHAT_ID']?.trim();
  if (!targetChat) return false;

  const isPrepaid = params.paymentMethod === 'UPI' || params.paidWithCoins;
  const itemLines = params.items
    .map((i) => `  • ${i.qty}x ${esc(i.name)} — ₹${Number(i.price).toFixed(0)}`)
    .join('\n');

  const lines = [
    `🛵 <b>Delivery Assigned to ${esc(params.boyName)} (#${params.orderId.slice(0, 8).toUpperCase()})</b>`,
    `📍 Address: ${esc(params.deliveryAddress)}`,
    `👤 Customer: ${esc(params.customerName)}`,
    params.phoneNumber ? `📞 ${esc(params.phoneNumber)}` : '',
    `📦 Items:\n${itemLines}`,
    isPrepaid
      ? `💳 Payment: <b>UPI Prepaid (Do NOT collect cash)</b>`
      : `💵 Cash on Delivery — <b>Collect Total: ₹${Number(params.codCollectAmount ?? 0).toFixed(0)}</b>`,
    `Ask customer for 4-digit OTP to complete delivery.`,
  ].filter(Boolean);

  return sendTelegramMessage(targetChat, lines.join('\n'));
}

/** Sends a Delivery Boy Payout Request alert to Admin's Telegram. */
export async function sendTelegramPayoutAlert(params: {
  boyName: string;
  phone?: string | null | undefined;
  amount: number;
  method: 'UPI' | 'COD';
  upiId?: string | null | undefined;
  bankingName?: string | null | undefined;
}): Promise<boolean> {
  const adminChat = process.env['TELEGRAM_ADMIN_CHAT_ID']?.trim();
  if (!adminChat) return false;

  const lines = [
    `💸 <b>Delivery Boy Payout Request — ₹${Number(params.amount).toFixed(2)}</b>`,
    `🛵 Rider: ${esc(params.boyName)}${params.phone ? ` (${esc(params.phone)})` : ''}`,
    params.method === 'UPI'
      ? `💳 Method: <b>UPI</b>\n🏦 Banking Name: ${esc(params.bankingName ?? '-')}\n🔗 UPI ID: <code>${esc(params.upiId ?? '-')}</code>`
      : `💵 Method: <b>Cash on Delivery (Cash Handover)</b>`,
    `Review in Admin → Delivery Boys`,
  ];

  return sendTelegramMessage(adminChat, lines.join('\n'));
}
