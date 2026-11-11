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
});

/** Insert under the existing database rules; finish the admin alert before returning. */
export const placeOrderWithPush = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof orderInputSchema>) => orderInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase.from('orders')
      .insert({ ...data, student_id: context.userId }).select('id').single();
    if (error || !order) throw new Error(error?.message ?? 'Could not place order');
    await dispatch({ type: 'new_order', orderId: order.id }, context);
    return { id: order.id };
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
      const { error } = await context.supabase.from('orders').update({ status: data.status }).eq('id', data.orderId);
      if (error) throw error;
    }
    await dispatch({ type: 'order_status', orderId: data.orderId }, context);
    return { ok: true };
  });

export const cancelOrderWithPush = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => orderIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error: readError } = await context.supabase.from('orders').select('payment_method,student_id').eq('id', data.orderId).single();
    if (readError || !order || order.student_id !== context.userId) throw new Error('Forbidden');
    // Existing cancellation-window trigger/RLS remain the enforcement boundary.
    const { error } = await context.supabase.from('orders').update({
      status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_fee: 0,
      refund_status: order.payment_method === 'UPI' ? 'pending' : 'none',
    }).eq('id', data.orderId).select('id').single();
    if (error) throw error;
    await dispatch({ type: 'order_status', orderId: data.orderId }, context);
    return { ok: true };
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
