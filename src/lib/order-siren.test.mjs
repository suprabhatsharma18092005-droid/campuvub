import { test, expect } from 'vitest';
import { ringingOrderIds } from './order-siren.ts';

const now = Date.parse('2026-11-12T10:00:00Z');
const at = (min) => new Date(now - min * 60000).toISOString();

test('pending and payment_review orders ring until acknowledged', () => {
  const orders = [
    { id: 'a', status: 'pending', created_at: at(5) },
    { id: 'b', status: 'payment_review', created_at: at(5) },
    { id: 'c', status: 'accepted', created_at: at(5) },
  ];
  expect(ringingOrderIds(orders, new Set(), now)).toEqual(['a', 'b']);
  expect(ringingOrderIds(orders, new Set(['a']), now)).toEqual(['b']);
});

test('orders older than 2 hours do not ring', () => {
  expect(ringingOrderIds([{ id: 'x', status: 'pending', created_at: at(121) }], new Set(), now)).toEqual([]);
  expect(ringingOrderIds([{ id: 'y', status: 'pending', created_at: at(119) }], new Set(), now)).toEqual(['y']);
});

test('auto-accepted Campu Coin orders ring until acknowledged or dispatched', () => {
  const coinOrder = { id: 'coin-1', status: 'accepted', created_at: at(3) };
  const dispatchedCoin = { id: 'coin-2', status: 'out_for_delivery', created_at: at(3) };
  const normalAccepted = { id: 'upi-1', status: 'accepted', created_at: at(3), payment_method: 'UPI', utr_number: '412345678901', accepted_at: at(1) };
  const fullCoinIds = new Set(['coin-1', 'coin-2']);

  expect(ringingOrderIds([coinOrder, dispatchedCoin, normalAccepted], new Set(), now, fullCoinIds)).toEqual(['coin-1']);
  expect(ringingOrderIds([coinOrder, dispatchedCoin, normalAccepted], new Set(['coin-1']), now, fullCoinIds)).toEqual([]);
});

test('auto-accepted Campu Coin order rings immediately via coin receipt fast-path before ledger sync', () => {
  const fastCoinOrder = {
    id: 'coin-fast',
    status: 'accepted',
    created_at: at(2),
    accepted_at: at(2),
    payment_method: 'UPI',
    utr_number: '991234567890',
  };
  expect(ringingOrderIds([fastCoinOrder], new Set(), now)).toEqual(['coin-fast']);
  expect(ringingOrderIds([fastCoinOrder], new Set(['coin-fast']), now)).toEqual([]);
});
