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
