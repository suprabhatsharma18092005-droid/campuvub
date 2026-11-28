import { test, expect } from 'vitest';
import {
  formatTelegramDeliveryBoyMessage,
  normalizeTelegramChatId,
  parseTelegramError,
  sendTelegramDetailed,
} from './telegram.server.ts';

test('normalizes numeric chat IDs, negative group IDs, and t.me links cleanly', () => {
  expect(normalizeTelegramChatId(' 5123 456 789 ')).toBe('5123456789');
  expect(normalizeTelegramChatId('id: -1001987654321')).toBe('-1001987654321');
  expect(normalizeTelegramChatId('https://t.me/campu_rider')).toBe('@campu_rider');
  expect(normalizeTelegramChatId('   ')).toBeNull();
});

test('gives clear @userinfobot guidance when @username fails with chat not found', () => {
  const err = parseTelegramError(400, JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), '@rahul');
  expect(err).toContain('@userinfobot');
  expect(err).toContain('/start');
});

test('formats delivery boy Telegram message with UPI privacy and COD collect total', () => {
  const upiMsg = formatTelegramDeliveryBoyMessage({
    boyName: 'Rahul',
    orderId: 'abcdef12-0000-0000-0000-000000000000',
    customerName: 'Aman',
    deliveryAddress: 'Hostel B, Room 104',
    phoneNumber: '9876543210',
    items: [{ name: 'Maggi', qty: 2, price: 30 }],
    paymentMethod: 'UPI',
    paidWithCoins: false,
    codCollectAmount: null,
  });
  expect(upiMsg).toContain('2x Maggi');
  expect(upiMsg).not.toContain('₹30');
  expect(upiMsg).toContain('Do NOT collect cash');

  const codMsg = formatTelegramDeliveryBoyMessage({
    boyName: 'Rahul',
    orderId: 'abcdef12-0000-0000-0000-000000000000',
    customerName: 'Aman',
    deliveryAddress: 'Hostel B, Room 104',
    phoneNumber: '9876543210',
    items: [{ name: 'Maggi', qty: 2, price: 30 }],
    paymentMethod: 'COD',
    paidWithCoins: false,
    codCollectAmount: 68,
  });
  expect(codMsg).toContain('Collect Total: ₹68');
});

test('detects ok:false JSON body even when proxy responds HTTP 200', async () => {
  const prev = process.env['TELEGRAM_BOT_TOKEN'];
  process.env['TELEGRAM_BOT_TOKEN'] = 'test-token-123';
  try {
    const fakeFetch = async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const res = await sendTelegramDetailed('5123456789', '<b>Test</b>', false, fakeFetch);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('chat not found');
  } finally {
    if (prev === undefined) delete process.env['TELEGRAM_BOT_TOKEN'];
    else process.env['TELEGRAM_BOT_TOKEN'] = prev;
  }
});
