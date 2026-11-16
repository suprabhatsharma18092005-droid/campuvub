import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { FIREBASE_PROJECT_ID } from './firebase-config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

/**
 * Every notification goes through dispatchPushEvent: it sends here when this
 * host holds the private keys (Lovable), or hands the event to the trusted
 * Lovable-hosted app with the caller's own session (e.g. Vercel). It is awaited
 * and never throws, so a notification failure cannot undo an order change.
 */
type AuthContext = { supabase: SupabaseClient<Database>; userId: string };
async function assertAdmin(context: AuthContext) {
  const { data, error } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
  if (error || !data) throw new Error('Forbidden');
}

async function dispatch(event: import('./push-events.server').PushEvent, context: AuthContext) {
  const { dispatchPushEvent } = await import('./push-events.server');
  return dispatchPushEvent(event, context);
}

/** Kept for older clients; uses the same sign-in-protected database function as the browser. */
export const registerPushToken = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; deviceId: string }) => z.object({
    token: z.string().min(10).max(500), deviceId: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc('register_push_device', {
      _token: data.token, _device_id: data.deviceId, _project_id: FIREBASE_PROJECT_ID,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const orderIdSchema = z.object({ orderId: z.string().uuid() });
const orderInputSchema = z.object({
  cart_items: z.array(z.object({ id: z.string().uuid(), name: z.string(), qty: z.number().int().positive(), price: z.number().nonnegative(), image_url: z.string().nullable(), mode: z.enum(['quick', 'sunday_tuesday']).optional() })).min(1),
  subtotal: z.number().nonnegative(), payment_method: z.enum(['UPI', 'COD']),
  utr_number: z.string().nullable(), delivery_fee: z.number().nonnegative(), total: z.number().nonnegative(),
  delivery_address: z.string().min(1), phone_number: z.string().nullable(), delivery_otp: z.string(),
  status: z.enum(['payment_review', 'pending']), delivery_type: z.enum(['quick', 'sunday_tuesday']),
  delivery_date: z.string().nullable(),
  coins_used: z.number().int().min(0).optional(),
});

function hasLiveAdminDb() {
  return Boolean(process.env['SUPABASE_URL'] && process.env['SUPABASE_SERVICE_ROLE_KEY']);
}

type OrderCartItem = { id: string; name: string; qty: number };

async function adjustStock(
  items: OrderCartItem[],
  direction: 'deduct' | 'restore',
): Promise<Array<{ id: string; previousQty: number; previousInStock: boolean }>> {
  if (!hasLiveAdminDb() || items.length === 0) return [];
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');

  const aggregated = new Map<string, { name: string; qty: number }>();
  for (const item of items) {
    const prev = aggregated.get(item.id);
    aggregated.set(item.id, { name: item.name, qty: (prev?.qty ?? 0) + item.qty });
  }

  const applied: Array<{ id: string; previousQty: number; previousInStock: boolean }> = [];
  const ids = Array.from(aggregated.keys());
  const { data: rows, error } = await supabaseAdmin
    .from('products')
    .select('id, name, stock_quantity, in_stock')
    .in('id', ids);
  if (error) throw new Error('Could not verify product inventory.');

  const rowMap = new Map((rows ?? []).map((r) => [r.id, r]));

  for (const [id, item] of aggregated.entries()) {
    const prod = rowMap.get(id);
    if (!prod) throw new Error(`${item.name} is no longer available.`);
    if (direction === 'deduct') {
      if (!prod.in_stock || prod.stock_quantity <= 0) {
        throw new Error(`${item.name} is out of stock.`);
      }
      if (prod.stock_quantity < item.qty) {
        throw new Error(`Only ${prod.stock_quantity} left for ${item.name}.`);
      }
      const nextQty = prod.stock_quantity - item.qty;
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('products')
        .update({ stock_quantity: nextQty, in_stock: nextQty > 0 })
        .eq('id', id)
        .eq('stock_quantity', prod.stock_quantity)
        .gte('stock_quantity', item.qty)
        .select('id');
      if (updErr || !updated || updated.length === 0) {
        // Roll back any earlier decrements from this same order.
        for (const prev of applied) {
          await supabaseAdmin
            .from('products')
            .update({ stock_quantity: prev.previousQty, in_stock: prev.previousInStock })
            .eq('id', prev.id);
        }
        throw new Error(`${item.name} just sold out. Refresh your cart and try again.`);
      }
      applied.push({ id, previousQty: prod.stock_quantity, previousInStock: prod.in_stock });
    } else {
      const nextQty = prod.stock_quantity + item.qty;
      await supabaseAdmin
        .from('products')
        .update({ stock_quantity: nextQty, in_stock: nextQty > 0 })
        .eq('id', id);
    }
  }
  return applied;
}

/** Insert under the existing database rules; finish stock reservation & admin alert before returning. */
export const placeOrderWithPush = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof orderInputSchema>) => orderInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { QUICK_MIN_ORDER, SCHEDULED_MIN_ORDER } = await import('./scheduled-fee');
    if (data.delivery_type === 'quick' && data.subtotal < QUICK_MIN_ORDER) {
      throw new Error(`Minimum order is ₹${QUICK_MIN_ORDER} for Quick Delivery.`);
    }
    if (data.delivery_type === 'sunday_tuesday' && data.subtotal < SCHEDULED_MIN_ORDER) {
      throw new Error(`Minimum order is ₹${SCHEDULED_MIN_ORDER} for Sunday & Tuesday Special.`);
    }

    // Also validate live stock via caller Supabase client even if admin key isn't set.
    const { data: stockRows } = await context.supabase
      .from('products')
      .select('id, name, stock_quantity, in_stock')
      .in('id', data.cart_items.map((i) => i.id));
    if (stockRows) {
      const map = new Map(stockRows.map((r) => [r.id, r]));
      for (const item of data.cart_items) {
        const prod = map.get(item.id);
        if (!prod || !prod.in_stock || prod.stock_quantity <= 0) {
          throw new Error(`${item.name} is out of stock.`);
        }
        if (prod.stock_quantity < item.qty) {
          throw new Error(`Only ${prod.stock_quantity} left for ${item.name}.`);
        }
      }
    }

    const coinsUsed = Math.max(0, Math.floor(data.coins_used ?? 0));
    if (coinsUsed > data.total) {
      throw new Error('Coins used cannot exceed order total.');
    }
    if (coinsUsed > 0) {
      const { COIN_LEDGER_SETTING_KEY, parseCoinLedger, reconcileCoinLedger } = await import('@/lib/coins');
      const [{ data: settingRow }, { data: sugRows }, { data: ordRows }] = await Promise.all([
        context.supabase.from('app_settings').select('value').eq('key', COIN_LEDGER_SETTING_KEY).maybeSingle(),
        context.supabase.from('suggestions').select('id, user_id, suggestion_text').eq('user_id', context.userId).order('created_at', { ascending: false }).limit(200),
        context.supabase.from('orders').select('id, status').eq('student_id', context.userId).order('created_at', { ascending: false }).limit(200),
      ]);
      const base = parseCoinLedger(settingRow?.value);
      const orderStatuses = Object.fromEntries((ordRows ?? []).map((o) => [o.id, o.status])) as Record<string, string>;
      const merged = reconcileCoinLedger(base, sugRows ?? [], orderStatuses).ledger;
      const availableCoins = Math.max(0, Math.floor(merged.balances[context.userId] ?? 0));
      if (coinsUsed > availableCoins) {
        throw new Error(`Insufficient Campu Coins. Available balance: ${availableCoins} coins.`);
      }
    }

    const reserved = await adjustStock(data.cart_items, 'deduct');
    const { coins_used: _omitCoins, ...orderPayload } = data;
    void _omitCoins;
    const { data: order, error } = await context.supabase
      .from('orders')
      .insert({ ...orderPayload, student_id: context.userId })
      .select('id')
      .single();

    if (error || !order) {
      if (reserved.length > 0 && hasLiveAdminDb()) {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        for (const prev of reserved) {
          await supabaseAdmin
            .from('products')
            .update({ stock_quantity: prev.previousQty, in_stock: prev.previousInStock })
            .eq('id', prev.id);
        }
      }
      throw new Error(error?.message ?? 'Could not place order');
    }

    let coinsPersistedRemotely = false;
    if (coinsUsed > 0 && hasLiveAdminDb()) {
      try {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { COIN_LEDGER_SETTING_KEY, applyOrderCoinSpendToLedger, parseCoinLedger, reconcileCoinLedger } = await import('@/lib/coins');
        const [{ data: settingRow }, { data: sugRows }, { data: ordRows }] = await Promise.all([
          supabaseAdmin.from('app_settings').select('value').eq('key', COIN_LEDGER_SETTING_KEY).maybeSingle(),
          supabaseAdmin.from('suggestions').select('id, user_id, suggestion_text').order('created_at', { ascending: false }).limit(500),
          supabaseAdmin.from('orders').select('id, status').order('created_at', { ascending: false }).limit(500),
        ]);
        const base = parseCoinLedger(settingRow?.value);
        const orderStatuses = Object.fromEntries((ordRows ?? []).map((o) => [o.id, o.status])) as Record<string, string>;
        const merged = reconcileCoinLedger(base, sugRows ?? [], orderStatuses).ledger;
        const { next, applied } = applyOrderCoinSpendToLedger(merged, {
          orderId: order.id,
          userId: context.userId,
          coinsUsed,
          orderTotal: data.total,
          payableAmount: Math.max(0, data.total - coinsUsed),
          paymentMethod: data.total - coinsUsed === 0 ? 'COINS' : data.payment_method,
          refunded: false,
          createdAt: new Date().toISOString(),
        });
        if (applied) {
          const { error: coinSaveErr } = await supabaseAdmin
            .from('app_settings')
            .upsert({ key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(next) }, { onConflict: 'key' });
          coinsPersistedRemotely = !coinSaveErr;
        }
      } catch {
        coinsPersistedRemotely = false;
      }
    }

    await dispatch({ type: 'new_order', orderId: order.id }, context);
    return { id: order.id, coinsUsed, coinsPersistedRemotely };
  });

/** Kept for older callers; only the owner can announce their own recent order. */
export const notifyNewOrder = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => dispatch({ type: 'new_order', orderId: data.orderId }, context));

export const updateOrderWithPush = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; status: string; otp?: string }) => z.object({
    orderId: z.string().uuid(), status: z.enum(['pending', 'payment_review', 'accepted', 'out_for_delivery', 'delivered', 'cancelled']),
    otp: z.string().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.status === 'delivered') {
      if (!data.otp) throw new Error('Delivery code required');
      const { error } = await context.supabase.rpc('deliver_order_with_otp', { _order_id: data.orderId, _delivery_otp: data.otp });
      if (error) throw error;
    } else {
      const { data: prevOrder } = await context.supabase
        .from('orders')
        .select('status, cart_items, payment_method, accepted_at, refund_status')
        .eq('id', data.orderId)
        .maybeSingle();

      const wasAcceptedUpi =
        prevOrder?.payment_method === 'UPI' && Boolean(prevOrder?.accepted_at);

      const patch: Database['public']['Tables']['orders']['Update'] = { status: data.status };
      if (data.status === 'accepted' && !prevOrder?.accepted_at) {
        patch.accepted_at = new Date().toISOString();
      } else if (data.status === 'cancelled') {
        patch.cancelled_at = new Date().toISOString();
        patch.refund_status = wasAcceptedUpi
          ? prevOrder?.refund_status === 'refunded'
            ? 'refunded'
            : 'pending'
          : 'none';
      }

      const { error } = await context.supabase.from('orders').update(patch).eq('id', data.orderId);
      if (error) throw error;
      if (
        data.status === 'cancelled' &&
        prevOrder &&
        prevOrder.status !== 'cancelled' &&
        prevOrder.status !== 'delivered' &&
        Array.isArray(prevOrder.cart_items)
      ) {
        await adjustStock(prevOrder.cart_items as OrderCartItem[], 'restore').catch(() => undefined);
      }
      if (data.status === 'cancelled' && prevOrder?.status !== 'cancelled') {
        const { refundOrderCoinsIfApplicable } = await import('./coins.functions');
        const client = hasLiveAdminDb()
          ? (await import('@/integrations/supabase/client.server')).supabaseAdmin
          : (context.supabase as unknown as typeof import('@/integrations/supabase/client.server').supabaseAdmin);
        await refundOrderCoinsIfApplicable(data.orderId, client).catch(() => 0);
      }
    }
    await dispatch({ type: 'order_status', orderId: data.orderId }, context);
    return { ok: true };
  });

export const cancelOrderWithPush = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error: readError } = await context.supabase
      .from('orders')
      .select('payment_method,student_id,status,cart_items')
      .eq('id', data.orderId)
      .single();
    if (readError || !order || order.student_id !== context.userId) throw new Error('Forbidden');
    // Existing cancellation-window trigger/RLS remain the enforcement boundary.
    const { error } = await context.supabase.from('orders').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_fee: 0,
      refund_status: order.payment_method === 'UPI' ? 'pending' : 'none',
    }).eq('id', data.orderId).select('id').single();
    if (error) throw error;
    if (order.status !== 'cancelled' && order.status !== 'delivered' && Array.isArray(order.cart_items)) {
      await adjustStock(order.cart_items as OrderCartItem[], 'restore').catch(() => undefined);
    }
    let refundedCoins = 0;
    if (hasLiveAdminDb()) {
      const { refundOrderCoinsIfApplicable } = await import('./coins.functions');
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      refundedCoins = await refundOrderCoinsIfApplicable(data.orderId, supabaseAdmin).catch(() => 0);
    }
    await dispatch({ type: 'order_status', orderId: data.orderId }, context);
    return { ok: true, refundedCoins };
  });

export const notifyOrderStatus = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; status: string }) => orderIdSchema.extend({ status: z.string() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: order, error } = await context.supabase.from('orders').select('status').eq('id', data.orderId).single();
    if (error || !order || order.status !== data.status) return { sent: 0 };
    return dispatch({ type: 'order_status', orderId: data.orderId }, context);
  });

export const notifyBroadcast = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; body: string }) => z.object({ title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(300) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await context.supabase.from('broadcasts').insert(data).select('id').single();
    if (error || !row) throw new Error(error?.message ?? 'Could not save broadcast');
    return dispatch({ type: 'broadcast', broadcastId: row.id }, context);
  });

export const notifyVipRequest = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { vipId: string }) => z.object({ vipId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => dispatch({ type: 'vip_request', vipId: data.vipId }, context));

export const pushHealthCheck = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { serviceAccountStatus, getAccessToken } = await import('./fcm.server');
    const { canSendLocally } = await import('./push-events.server');
    const status = serviceAccountStatus();
    let accessToken = false;
    let tokenError: string | null = null;
    if (status.account && status.projectId === FIREBASE_PROJECT_ID) {
      try { accessToken = Boolean(await getAccessToken(status.account)); }
      catch { tokenError = 'Firebase authentication failed; update the service-account secret.'; }
    } else if (canSendLocally()) { tokenError = null; }
    else { tokenError = 'This host forwards notifications to the Lovable-hosted app.'; }
    let adminProfilesWithToken: number | null = null;
    if (process.env['SUPABASE_SERVICE_ROLE_KEY']) {
      try { adminProfilesWithToken = (await (await import('./push-delivery.server')).adminTokens()).length; }
      catch { adminProfilesWithToken = null; }
    }
    return { secretFound: Boolean(status.secretName), secretName: status.secretName, parses: status.parses,
      projectId: status.projectId, accessToken, tokenError, sendsLocally: canSendLocally(), adminProfilesWithToken };
  });

export const sendTestPushToMe = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const result = await dispatch({ type: 'test' }, context);
    if (result.error) return { ok: false, message: `Push test failed: ${result.error}.` };
    if (result.devices === 0) return { ok: false, message: 'Enable notifications on this device first.' };
    return {
      ok: result.sent > 0,
      message: result.sent > 0 ? `Sent to ${result.sent} device(s).` : 'Push was not sent. Check the puch-campu credentials and device permissions.',
    };
  });
