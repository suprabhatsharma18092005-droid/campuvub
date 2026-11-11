import { expect, test } from 'bun:test';
import { safelySendPush } from './push-delivery.server.ts';

test('push operation waits for token lookup and send completion', async () => {
  let release;
  let finished = false;
  const pending = new Promise((resolve) => { release = resolve; });
  const result = safelySendPush(async () => { await pending; return []; }, { title: 'New Order', body: 'Test' })
    .then((value) => { finished = true; return value; });
  await Promise.resolve();
  expect(finished).toBe(false);
  release();
  expect(await result).toEqual({ sent: 0, staleTokens: [] });
  expect(finished).toBe(true);
});

test('token lookup errors do not reject successful order operations', async () => {
  const result = await safelySendPush(async () => { throw new Error('lookup unavailable'); }, { title: 'New Order', body: 'Test' });
  expect(result).toEqual({ sent: 0, staleTokens: [] });
});