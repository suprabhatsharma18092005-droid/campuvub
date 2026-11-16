/**
 * Notification events. A host that holds the private backend key and Firebase
 * credentials sends locally; any other host (e.g. a Vercel build) forwards the
 * event — never device tokens or message content — with the caller's own
 * session to the trusted Lovable-hosted deployment, which re-checks
 * permissions before sending.
 *
 * Server-only module (.server.ts) — never bundled into client code.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRequest } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { Database } from '@/integrations/supabase/types';
import { serviceAccountStatus } from './fcm.server';
import { getRelayConfig } from './push-relay.server';

export const pushEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('new_order'), orderId: z.string().uuid() }),
  z.object({ type: z.literal('order_status'), orderId: z.string().uuid() }),
  z.object({ type: z.literal('broadcast'), broadcastId: z.string().uuid() }),
  z.object({ type: z.literal('vip_request'), vipId: z.string().uuid() }),
  z.object({ type: z.literal('test') }),
]);
export type PushEvent = z.infer<typeof pushEventSchema>;
export type PushEventResult = { sent: number; devices?: number; error?: string };
type EventContext = { supabase: SupabaseClient<Database>; userId: string };

/** Public address of the trusted host; overridable per deployment. Not a credential. */
const DEFAULT_TRUSTED_HOST = 'https://campuvub.lovable.app';
/** Alerts can only be triggered for orders/broadcasts created moments ago. */
export const EVENT_WINDOW_MS = 10 * 60 * 1000;

export class PushForbiddenError extends Error {}

export function isRecent(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const age = now - new Date(createdAt).getTime();
  return age >= -60_000 && age <= EVENT_WINDOW_MS;
}

/** True when this host can look up devices and reach Firebase on its own. */
export function canSendLocally(): boolean {
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) return false;
  const gateway = Boolean(process.env['LOVABLE_API_KEY'] && process.env['FIREBASE_MESSAGING_API_KEY']);
  return Boolean(serviceAccountStatus().account) || gateway || Boolean(getRelayConfig());
}

async function isAdmin(ctx: EventContext) {
  const { data, error } = await ctx.supabase.rpc('has_role', { _user_id: ctx.userId, _role: 'admin' });
  return !error && Boolean(data);
}

/** Authorizes the caller for the event, then sends using privileged token lookups. */
export async function runPushEvent(event: PushEvent, ctx: EventContext): Promise<PushEventResult> {
  const delivery = await import('./push-delivery.server');
  switch (event.type) {
    case 'new_order': {
      const { data: order } = await ctx.supabase.from('orders')
        .select('id,total,student_id,created_at').eq('id', event.orderId).maybeSingle();
      if (!order || order.student_id !== ctx.userId || !isRecent(order.created_at)) throw new PushForbiddenError('Forbidden');
      return delivery.sendNewOrderAlert(order);
    }
    case 'order_status': {
      const { data: order } = await ctx.supabase.from('orders')
        .select('id,student_id,status').eq('id', event.orderId).maybeSingle();
      if (!order) throw new PushForbiddenError('Forbidden');
      const ownCancel = order.student_id === ctx.userId && order.status === 'cancelled';
      if (!ownCancel && !(await isAdmin(ctx))) throw new PushForbiddenError('Forbidden');
      return delivery.sendStatusAlert(order);
    }
    case 'broadcast': {
      if (!(await isAdmin(ctx))) throw new PushForbiddenError('Forbidden');
      const { data: row } = await ctx.supabase.from('broadcasts')
        .select('title,body,created_at').eq('id', event.broadcastId).maybeSingle();
      if (!row || !isRecent(row.created_at)) throw new PushForbiddenError('Forbidden');
      return delivery.safelySendPush(() => delivery.deviceTokens(), { title: row.title, body: row.body, path: '/' });
    }
    case 'vip_request': {
      const { data: sub } = await ctx.supabase
        .from('vip_subscriptions')
        .select('id,user_id,utr_number,amount,created_at')
        .eq('id', event.vipId)
        .maybeSingle();
      if (!sub || sub.user_id !== ctx.userId || !isRecent(sub.created_at)) {
        throw new PushForbiddenError('Forbidden');
      }
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('full_name')
        .eq('id', ctx.userId)
        .maybeSingle();
      return delivery.sendVipRequestAlert({
        id: sub.id,
        customerName: profile?.full_name?.trim() || 'A student',
        utrNumber: sub.utr_number,
        amount: Number(sub.amount),
      });
    }
    case 'test': {
      if (!(await isAdmin(ctx))) throw new PushForbiddenError('Forbidden');
      const tokens = await delivery.deviceTokens([ctx.userId]);
      if (!tokens.length) return { sent: 0, devices: 0 };
      const { sendPushToTokens } = await import('./fcm.server');
      const { sent } = await sendPushToTokens(tokens, { title: 'Test notification ✅', body: 'Push delivery is working.', path: '/admin' });
      return { sent, devices: tokens.length };
    }
  }
}

type ForwardOptions = { base?: string | undefined; fetchImpl?: typeof fetch };

/**
 * Hands an event to the trusted host with the caller's own session. Only the
 * event (type + id) and the caller's authorization header leave this host.
 */
export async function forwardPushEvent(event: PushEvent, auth: string | null | undefined, options: ForwardOptions = {}): Promise<PushEventResult> {
  if (!auth?.startsWith('Bearer ')) return { sent: 0, error: 'Not signed in' };
  const base = (options.base || DEFAULT_TRUSTED_HOST).replace(/\/+$/, '');
  if (!base.startsWith('https://')) return { sent: 0, error: 'Notification host must use https' };
  const res = await (options.fetchImpl ?? fetch)(`${base}/api/public/push-event`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    console.error(`Push event hand-off failed [${res.status}]: ${(await res.text()).slice(0, 200)}`);
    return { sent: 0, error: `Notification host responded ${res.status}` };
  }
  const body = (await res.json()) as Partial<PushEventResult>;
  return { sent: Number(body.sent) || 0, ...(typeof body.devices === 'number' ? { devices: body.devices } : {}) };
}

/** Send here when possible, otherwise hand the event to the trusted host. Never throws. */
export async function dispatchPushEvent(event: PushEvent, ctx: EventContext): Promise<PushEventResult> {
  try {
    if (!process.env['SUPABASE_URL'] || !process.env['SUPABASE_PUBLISHABLE_KEY']) {
      return { sent: 0 };
    }
    if (canSendLocally()) return await runPushEvent(event, ctx);
    return await forwardPushEvent(event, getRequest()?.headers.get('authorization'), {
      base: process.env['PUSH_EVENT_HOST_URL'],
    });
  } catch (error) {
    console.error('Push event failed', error);
    return { sent: 0, error: 'Notification could not be sent' };
  }
}

function withApiKey(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith('sb_') && headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization');
    headers.set('apikey', key);
    return fetch(input, { ...init, headers });
  };
}

/** Verifies a caller's session token and returns a client scoped to that user. */
export async function contextFromBearer(authHeader: string | null): Promise<EventContext | null> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !key || !authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.split('.').length !== 3) return null;
  const supabase = createClient<Database>(url, key, {
    global: { fetch: withApiKey(key), headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return { supabase, userId: data.claims.sub };
}
