import { expect, test } from 'bun:test';
import { EVENT_WINDOW_MS, PushForbiddenError, forwardPushEvent, isRecent, pushEventSchema, runPushEvent } from './push-events.server.ts';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

function ctx({ row = null, admin = false } = {}) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
  return { userId: ME, supabase: { from: () => chain, rpc: async () => ({ data: admin, error: null }) } };
}

test('alerts are only allowed for orders and broadcasts created in the last 10 minutes', () => {
  const now = Date.parse('2026-11-10T08:00:00Z');
  expect(isRecent(new Date(now - EVENT_WINDOW_MS).toISOString(), now)).toBe(true);
  expect(isRecent(new Date(now - EVENT_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
  expect(isRecent(null, now)).toBe(false);
});

test('only known event types with valid ids are accepted', () => {
  expect(pushEventSchema.safeParse({ type: 'new_order', orderId: ORDER }).success).toBe(true);
  expect(pushEventSchema.safeParse({ type: 'vip_request', vipId: ORDER }).success).toBe(true);
  expect(pushEventSchema.safeParse({ type: 'new_order', orderId: 'x' }).success).toBe(false);
  expect(pushEventSchema.safeParse({ type: 'custom', title: 'Hi' }).success).toBe(false);
});

test('vip-request alerts are refused for someone else or old requests', async () => {
  const other = { id: ORDER, user_id: OTHER, utr_number: '123456789012', amount: 149, created_at: new Date().toISOString() };
  await expect(runPushEvent({ type: 'vip_request', vipId: ORDER }, ctx({ row: other }))).rejects.toBeInstanceOf(PushForbiddenError);
  const old = { id: ORDER, user_id: ME, utr_number: '123456789012', amount: 149, created_at: new Date(Date.now() - EVENT_WINDOW_MS - 60_000).toISOString() };
  await expect(runPushEvent({ type: 'vip_request', vipId: ORDER }, ctx({ row: old }))).rejects.toBeInstanceOf(PushForbiddenError);
});

test('new-order alerts are refused for someone else\u2019s order', async () => {
  const row = { id: ORDER, total: 100, student_id: OTHER, created_at: new Date().toISOString() };
  await expect(runPushEvent({ type: 'new_order', orderId: ORDER }, ctx({ row }))).rejects.toBeInstanceOf(PushForbiddenError);
});

test('new-order alerts are refused for old orders', async () => {
  const row = { id: ORDER, total: 100, student_id: ME, created_at: new Date(Date.now() - EVENT_WINDOW_MS - 60_000).toISOString() };
  await expect(runPushEvent({ type: 'new_order', orderId: ORDER }, ctx({ row }))).rejects.toBeInstanceOf(PushForbiddenError);
});

test('status alerts need an admin unless a customer cancelled their own order', async () => {
  const accepted = { id: ORDER, student_id: ME, status: 'accepted' };
  await expect(runPushEvent({ type: 'order_status', orderId: ORDER }, ctx({ row: accepted }))).rejects.toBeInstanceOf(PushForbiddenError);
  const othersCancel = { id: ORDER, student_id: OTHER, status: 'cancelled' };
  await expect(runPushEvent({ type: 'order_status', orderId: ORDER }, ctx({ row: othersCancel }))).rejects.toBeInstanceOf(PushForbiddenError);
});

test('broadcasts and test notifications need an admin', async () => {
  await expect(runPushEvent({ type: 'broadcast', broadcastId: ORDER }, ctx())).rejects.toBeInstanceOf(PushForbiddenError);
  await expect(runPushEvent({ type: 'test' }, ctx())).rejects.toBeInstanceOf(PushForbiddenError);
});

test('hand-off sends only the event and the caller\u2019s own session to the trusted host', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return Response.json({ sent: 2, devices: 3 }); };
  const result = await forwardPushEvent({ type: 'new_order', orderId: ORDER }, 'Bearer user.jwt.token', { base: 'https://host.example/', fetchImpl });
  expect(result).toEqual({ sent: 2, devices: 3 });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://host.example/api/public/push-event');
  expect(calls[0].init.headers).toEqual({ authorization: 'Bearer user.jwt.token', 'content-type': 'application/json' });
  expect(JSON.parse(calls[0].init.body)).toEqual({ type: 'new_order', orderId: ORDER });
});

test('hand-off is skipped without a session or over plain http', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return Response.json({ sent: 1 }); };
  expect((await forwardPushEvent({ type: 'test' }, null, { fetchImpl })).sent).toBe(0);
  expect((await forwardPushEvent({ type: 'test' }, 'Bearer a.b.c', { base: 'http://insecure.example', fetchImpl })).sent).toBe(0);
  expect(called).toBe(false);
});

test('a failed hand-off reports zero sent with the host status', async () => {
  const fetchImpl = async () => new Response('nope', { status: 503 });
  expect(await forwardPushEvent({ type: 'test' }, 'Bearer a.b.c', { base: 'https://host.example', fetchImpl }))
    .toEqual({ sent: 0, error: 'Notification host responded 503' });
});
