import { expect, test } from "bun:test";
import {
  aggregateAllDailyHistory,
  computeOrderAccounting,
  emptyAdminAccounting,
  parseAdminAccounting,
  syncAccountingWithOrders,
  toIstDateKey,
} from "./admin-accounting.ts";

test("computes display sales, original shop cost, product profit, delivery boy paid/kept, and net profit", () => {
  const productCosts = {
    "p-1": { originalPrice: 15, updatedAt: "2026-11-21T00:00:00Z" },
    "p-2": { originalPrice: 40, updatedAt: "2026-11-21T00:00:00Z" },
  };
  const snap = computeOrderAccounting({
    order: {
      id: "ord-1",
      created_at: "2026-11-21T10:00:00Z",
      status: "delivered",
      subtotal: 120,
      delivery_fee: 5,
      total: 125,
      cart_items: [
        { id: "p-1", name: "Maggie", qty: 2, price: 20 },
        { id: "p-2", name: "Cold Coffee", qty: 1, price: 80 },
      ],
    },
    productCosts,
    assignment: {
      id: "assign:ord-1",
      orderId: "ord-1",
      boyId: "boy-1",
      boyName: "Rahul",
      customerName: "Aman",
      phoneNumber: null,
      deliveryAddress: "Hostel A",
      deliveryType: "quick",
      deliveryDate: null,
      items: [],
      paymentMethod: "UPI",
      paidWithCoins: false,
      codCollectAmount: null,
      deliveryFee: 5,
      earningAmount: 4,
      otpDigest: "abc",
      status: "delivered",
      assignedAt: "2026-11-21T10:01:00Z",
      earningCredited: true,
    },
  });

  // Display sales: 2*20 + 1*80 = 120
  expect(snap.displaySales).toBe(120);
  // Original cost: 2*15 + 1*40 = 70
  expect(snap.originalCostTotal).toBe(70);
  // Product profit: 120 - 70 = 50
  expect(snap.productProfit).toBe(50);
  // Delivery collected = 5, paid to boy = 4, kept = 1
  expect(snap.deliveryCollected).toBe(5);
  expect(snap.deliveryPaidToBoy).toBe(4);
  expect(snap.deliveryKept).toBe(1);
  // Overall profit = 50 + 1 = 51 (equals grandTotal 125 - cost 70 - boyPaid 4)
  expect(snap.netProfit).toBe(51);
  expect(snap.missingCostItems).toBe(0);
});

test("preserves historical order cost snapshots even if product originalPrice changes later", () => {
  const base = {
    ...emptyAdminAccounting(),
    productCosts: {
      "p-1": { originalPrice: 14, updatedAt: "2026-11-20T00:00:00Z" },
    },
  };
  const order = {
    id: "ord-hist",
    created_at: "2026-11-20T08:00:00Z",
    status: "delivered",
    subtotal: 20,
    delivery_fee: 5,
    total: 25,
    cart_items: [{ id: "p-1", name: "Maggie", qty: 1, price: 20 }],
  };

  const firstSync = syncAccountingWithOrders({
    base,
    orders: [order],
    assignmentsByOrder: {},
  });
  expect(firstSync.changed).toBe(true);
  expect(firstSync.next.orderCostSnapshots["ord-hist"]?.originalCostTotal).toBe(14);
  expect(firstSync.next.orderCostSnapshots["ord-hist"]?.productProfit).toBe(6);

  // Now admin changes Maggie originalPrice to 18 on a future date
  const updatedBase = {
    ...firstSync.next,
    productCosts: {
      "p-1": { originalPrice: 18, updatedAt: "2026-11-21T00:00:00Z" },
    },
  };
  const secondSync = syncAccountingWithOrders({
    base: updatedBase,
    orders: [order],
    assignmentsByOrder: {},
  });
  // Existing delivered snapshot stays 14 (historic cost preserved)
  expect(secondSync.next.orderCostSnapshots["ord-hist"]?.originalCostTotal).toBe(14);
  expect(secondSync.next.orderCostSnapshots["ord-hist"]?.productProfit).toBe(6);

  // Explicit recalculate updates it if desired
  const recalcSync = syncAccountingWithOrders({
    base: updatedBase,
    orders: [order],
    assignmentsByOrder: {},
    forceRecalculateCosts: true,
  });
  expect(recalcSync.next.orderCostSnapshots["ord-hist"]?.originalCostTotal).toBe(18);
  expect(recalcSync.next.orderCostSnapshots["ord-hist"]?.productProfit).toBe(2);
});

test("syncs dailyHistory in IST and aggregates across saved history beyond live window", () => {
  const oldDay = "2026-11-10";
  const base = parseAdminAccounting(
    JSON.stringify({
      version: 1,
      productCosts: { "p-1": { originalPrice: 10, updatedAt: "2026-11-21T00:00:00Z" } },
      orderCostSnapshots: {},
      dailyHistory: {
        [oldDay]: {
          dateKey: oldDay,
          deliveredOrders: 3,
          totalOrdersPlaced: 4,
          cancelledOrders: 1,
          displaySales: 300,
          originalCostTotal: 220,
          productProfit: 80,
          deliveryCollected: 15,
          deliveryPaidToBoy: 12,
          deliveryKept: 3,
          grandTotalSales: 315,
          netProfit: 83,
          missingCostItems: 0,
          updatedAt: "2026-11-10T18:00:00Z",
        },
      },
      updatedAt: "2026-11-10T18:00:00Z",
    }),
  );

  // Order created at 2026-11-20T20:00:00Z is 2026-11-21 01:30 AM IST
  const isoOrderTime = "2026-11-20T20:00:00Z";
  expect(toIstDateKey(isoOrderTime)).toBe("2026-11-21");

  const synced = syncAccountingWithOrders({
    base,
    orders: [
      {
        id: "ord-today",
        created_at: isoOrderTime,
        status: "delivered",
        subtotal: 50,
        delivery_fee: 8,
        total: 58,
        cart_items: [{ id: "p-1", name: "Snack", qty: 2, price: 25 }],
      },
      {
        id: "ord-today-pending",
        created_at: isoOrderTime,
        status: "accepted",
        subtotal: 40,
        delivery_fee: 5,
        total: 45,
        cart_items: [{ id: "p-1", name: "Snack", qty: 2, price: 20 }],
      },
    ],
    assignmentsByOrder: {
      "ord-today": {
        id: "a1",
        orderId: "ord-today",
        boyId: "b1",
        boyName: "Boy",
        customerName: "Stu",
        phoneNumber: null,
        deliveryAddress: "H1",
        deliveryType: "quick",
        deliveryDate: null,
        items: [],
        paymentMethod: "COD",
        paidWithCoins: false,
        codCollectAmount: 58,
        deliveryFee: 8,
        earningAmount: 7,
        otpDigest: "x",
        status: "delivered",
        assignedAt: isoOrderTime,
        earningCredited: true,
      },
    },
  });

  const todaySummary = synced.next.dailyHistory["2026-11-21"];
  expect(todaySummary?.totalOrdersPlaced).toBe(2);
  expect(todaySummary?.deliveredOrders).toBe(1);
  expect(todaySummary?.pendingOrders).toBe(1);
  expect(todaySummary?.cancelledOrders).toBe(0);
  expect(todaySummary?.displaySales).toBe(50);
  expect(todaySummary?.originalCostTotal).toBe(20);
  expect(todaySummary?.productProfit).toBe(30);
  expect(todaySummary?.deliveryCollected).toBe(8);
  expect(todaySummary?.deliveryPaidToBoy).toBe(7);
  expect(todaySummary?.deliveryKept).toBe(1);
  expect(todaySummary?.netProfit).toBe(31);

  // Old day stays intact in history even when omitted from live query (and derives pendingOrders=0)
  expect(synced.next.dailyHistory[oldDay]?.netProfit).toBe(83);
  expect(synced.next.dailyHistory[oldDay]?.pendingOrders).toBe(0);

  const allTime = aggregateAllDailyHistory(synced.next.dailyHistory);
  expect(allTime.deliveredOrders).toBe(4);
  expect(allTime.pendingOrders).toBe(1);
  expect(allTime.totalOrdersPlaced).toBe(6);
  expect(allTime.displaySales).toBe(350);
  expect(allTime.originalCostTotal).toBe(240);
  expect(allTime.productProfit).toBe(110);
  expect(allTime.deliveryKept).toBe(4);
  expect(allTime.netProfit).toBe(114);
});
