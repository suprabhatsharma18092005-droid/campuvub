import { expect, test } from "bun:test";
import {
  DEFAULT_FEE_DEDUCTION,
  applyDeliveredOtpToState,
  applyPayoutDecisionToState,
  buildAssignmentSnapshot,
  calculateDeliveryBoyEarning,
  computeDeliveryOtpDigest,
  emptyDeliveryBoyState,
  getBoyFinancialSummary,
  projectOrderForDeliveryBoy,
  reconcileDeliveryBoyState,
  ringingDeliveryAssignmentIds,
  ringingPayoutRequestIds,
  validatePayoutRequestInput,
} from "./delivery-boy.ts";

const BOY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_1 = "33333333-3333-4333-8333-333333333333";
const ORDER_2 = "44444444-4444-4444-8444-444444444444";

const SAMPLE_BOY = {
  userId: BOY_ID,
  name: "Rahul Rider",
  phone: "9876543210",
  telegramChatId: null,
  active: true,
  createdAt: "2026-11-20T10:00:00Z",
  updatedAt: "2026-11-20T10:00:00Z",
};

test("salary calculation defaults to delivery_fee minus ₹1 and supports admin overrides", () => {
  expect(DEFAULT_FEE_DEDUCTION).toBe(1);
  expect(calculateDeliveryBoyEarning(5)).toBe(4);
  expect(calculateDeliveryBoyEarning(8)).toBe(7);
  expect(calculateDeliveryBoyEarning(15)).toBe(14);
  expect(calculateDeliveryBoyEarning(0)).toBe(0);

  // Admin changes deduction to ₹2
  expect(
    calculateDeliveryBoyEarning(15, { mode: "deduct_from_fee", deductionAmount: 2, fixedAmount: 0 }),
  ).toBe(13);

  // Admin switches to fixed per-delivery rate
  expect(
    calculateDeliveryBoyEarning(5, { mode: "fixed_per_delivery", deductionAmount: 1, fixedAmount: 10 }),
  ).toBe(10);
});

test("UPI orders hide total price and delivery fee from delivery boy, while COD shows only total price", async () => {
  const digest = await computeDeliveryOtpDigest(ORDER_1, "4321");

  const upiAssignment = buildAssignmentSnapshot({
    order: {
      id: ORDER_1,
      cart_items: [{ id: "p1", name: "Maggi", qty: 2, price: 25, image_url: "img.jpg" }],
      total: 55,
      delivery_fee: 5,
      payment_method: "UPI",
      delivery_address: "Block C, Room 214",
      phone_number: "9999999999",
    },
    boy: SAMPLE_BOY,
    customerName: "Aman",
    otpDigest: digest,
    salaryRule: { mode: "deduct_from_fee", deductionAmount: 1, fixedAmount: 0 },
  });

  const upiView = projectOrderForDeliveryBoy(upiAssignment);
  expect(upiView.isPrepaid).toBe(true);
  expect(upiView.showTotalPrice).toBe(false);
  expect(upiView.collectTotal).toBeNull();
  expect(upiView.showDeliveryFee).toBe(false);
  expect(upiView.items).toHaveLength(1);
  expect(upiView.deliveryAddress).toBe("Block C, Room 214");

  const codAssignment = buildAssignmentSnapshot({
    order: {
      id: ORDER_2,
      cart_items: [{ id: "p1", name: "Chips", qty: 1, price: 20, image_url: "chips.jpg" }],
      total: 28,
      delivery_fee: 8,
      payment_method: "COD",
      delivery_address: "Block A, Room 101",
      phone_number: "8888888888",
    },
    boy: SAMPLE_BOY,
    customerName: "Neha",
    otpDigest: digest,
    salaryRule: { mode: "deduct_from_fee", deductionAmount: 1, fixedAmount: 0 },
  });

  const codView = projectOrderForDeliveryBoy(codAssignment);
  expect(codView.isPrepaid).toBe(false);
  expect(codView.showTotalPrice).toBe(true);
  expect(codView.collectTotal).toBe(28);
  expect(codView.showDeliveryFee).toBe(false);
});

test("reconciliation only credits salary on matching OTP digest and prevents spoofing", async () => {
  const realDigest = await computeDeliveryOtpDigest(ORDER_1, "7890");
  const wrongDigest = await computeDeliveryOtpDigest(ORDER_1, "0000");

  const assignment = buildAssignmentSnapshot({
    order: {
      id: ORDER_1,
      cart_items: [{ id: "p1", name: "Cola", qty: 1, price: 40 }],
      total: 45,
      delivery_fee: 5,
      payment_method: "COD",
      delivery_address: "Block B, 12",
      phone_number: "7777777777",
    },
    boy: SAMPLE_BOY,
    customerName: "Student",
    otpDigest: realDigest,
    salaryRule: { mode: "deduct_from_fee", deductionAmount: 1, fixedAmount: 0 },
  });

  const base = {
    ...emptyDeliveryBoyState(),
    boys: [SAMPLE_BOY],
    assignments: [assignment],
  };

  // Wrong OTP digest or wrong userId cannot deliver or credit wallet
  const badRes = reconcileDeliveryBoyState(base, [
    {
      id: "sug-bad-otp",
      user_id: BOY_ID,
      suggestion_text: JSON.stringify({
        type: "delivery_boy_delivered",
        orderId: ORDER_1,
        boyId: BOY_ID,
        otpDigest: wrongDigest,
        deliveredAt: "2026-11-20T11:00:00Z",
      }),
    },
    {
      id: "sug-wrong-user",
      user_id: OTHER_ID,
      suggestion_text: JSON.stringify({
        type: "delivery_boy_delivered",
        orderId: ORDER_1,
        boyId: BOY_ID,
        otpDigest: realDigest,
        deliveredAt: "2026-11-20T11:00:00Z",
      }),
    },
  ]);
  expect(badRes.state.wallets[BOY_ID] ?? 0).toBe(0);
  expect(badRes.state.assignments[0]?.status).toBe("assigned");

  // Real digest by assigned boy marks delivered & credits ₹4 (5 - 1) idempotently once
  const goodRes = reconcileDeliveryBoyState(base, [
    {
      id: "sug-good-1",
      user_id: BOY_ID,
      suggestion_text: JSON.stringify({
        type: "delivery_boy_delivered",
        orderId: ORDER_1,
        boyId: BOY_ID,
        otpDigest: realDigest,
        deliveredAt: "2026-11-20T11:05:00Z",
      }),
    },
    {
      id: "sug-good-dup",
      user_id: BOY_ID,
      suggestion_text: JSON.stringify({
        type: "delivery_boy_delivered",
        orderId: ORDER_1,
        boyId: BOY_ID,
        otpDigest: realDigest,
        deliveredAt: "2026-11-20T11:06:00Z",
      }),
    },
  ]);
  expect(goodRes.state.assignments[0]?.status).toBe("delivered");
  expect(goodRes.state.wallets[BOY_ID]).toBe(4);
  expect(goodRes.state.totalEarned[BOY_ID]).toBe(4);

  // Direct helper idempotency check
  const replay = applyDeliveredOtpToState(goodRes.state, ORDER_1);
  expect(replay.creditedAmount).toBe(0);
  expect(replay.next.wallets[BOY_ID]).toBe(4);
});

test("payout validation enforces UPI details for UPI and allows Cash/COD directly", () => {
  expect(
    validatePayoutRequestInput({
      method: "UPI",
      amount: 50,
      withdrawableBalance: 100,
      upiId: "bad-upi",
      bankingName: "Rahul",
    }),
  ).toContain("UPI ID");

  expect(
    validatePayoutRequestInput({
      method: "UPI",
      amount: 50,
      withdrawableBalance: 100,
      upiId: "rahul@okicici",
      bankingName: "",
    }),
  ).toContain("banking");

  expect(
    validatePayoutRequestInput({
      method: "UPI",
      amount: 50,
      withdrawableBalance: 100,
      upiId: "rahul@okicici",
      bankingName: "Rahul Kumar",
    }),
  ).toBeNull();

  expect(
    validatePayoutRequestInput({
      method: "COD",
      amount: 50,
      withdrawableBalance: 100,
    }),
  ).toBeNull();

  expect(
    validatePayoutRequestInput({
      method: "COD",
      amount: 120,
      withdrawableBalance: 100,
    }),
  ).toContain("exceeds");
});

test("payout lifecycle reserves balance while pending and updates totals on admin payment", () => {
  const base = {
    ...emptyDeliveryBoyState(),
    boys: [SAMPLE_BOY],
    wallets: { [BOY_ID]: 50 },
    totalEarned: { [BOY_ID]: 50 },
  };

  const withReq = reconcileDeliveryBoyState(base, [
    {
      id: "sug-pay-1",
      user_id: BOY_ID,
      suggestion_text: JSON.stringify({
        type: "delivery_boy_payout_request",
        request: {
          id: "pay-1",
          boyId: BOY_ID,
          boyName: "Rahul Rider",
          phone: "9876543210",
          amount: 30,
          method: "UPI",
          upiId: "rahul@upi",
          bankingName: "Rahul Kumar",
          status: "paid", // Spoof attempt from client must be stripped to pending
          createdAt: "2026-11-20T12:00:00Z",
        },
      }),
    },
  ]).state;

  expect(withReq.payoutRequests[0]?.status).toBe("pending");
  const summaryPending = getBoyFinancialSummary(withReq, BOY_ID);
  expect(summaryPending.walletBalance).toBe(50);
  expect(summaryPending.pendingPayoutTotal).toBe(30);
  expect(summaryPending.withdrawableBalance).toBe(20);

  const { next: afterPaid } = applyPayoutDecisionToState(
    withReq,
    "pay-1",
    "paid",
    "2026-11-20T12:15:00Z",
  );
  const summaryPaid = getBoyFinancialSummary(afterPaid, BOY_ID);
  expect(summaryPaid.walletBalance).toBe(20);
  expect(summaryPaid.pendingPayoutTotal).toBe(0);
  expect(summaryPaid.withdrawableBalance).toBe(20);
  expect(summaryPaid.totalPaidOut).toBe(30);
});

test("ringing filters identify unacknowledged assignments & payout requests within 2 hours", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const recent = "2026-11-20T11:45:00Z";
  const old = "2026-11-20T09:00:00Z";

  const assignments = [
    {
      id: "a1",
      orderId: ORDER_1,
      boyId: BOY_ID,
      boyName: "Rahul",
      customerName: "A",
      phoneNumber: null,
      deliveryAddress: "Hostel",
      deliveryType: "quick",
      deliveryDate: null,
      items: [],
      paymentMethod: "UPI",
      paidWithCoins: false,
      codCollectAmount: null,
      deliveryFee: 5,
      earningAmount: 4,
      otpDigest: "x".repeat(64),
      status: "assigned",
      assignedAt: recent,
      earningCredited: false,
    },
    {
      id: "a2",
      orderId: ORDER_2,
      boyId: BOY_ID,
      boyName: "Rahul",
      customerName: "B",
      phoneNumber: null,
      deliveryAddress: "Hostel",
      deliveryType: "quick",
      deliveryDate: null,
      items: [],
      paymentMethod: "COD",
      paidWithCoins: false,
      codCollectAmount: 50,
      deliveryFee: 8,
      earningAmount: 7,
      otpDigest: "y".repeat(64),
      status: "assigned",
      assignedAt: old,
      earningCredited: false,
    },
  ];

  expect(ringingDeliveryAssignmentIds(assignments, BOY_ID, new Set(), now)).toEqual([ORDER_1]);
  expect(
    ringingDeliveryAssignmentIds(assignments, BOY_ID, new Set([`deliv:${ORDER_1}`]), now),
  ).toEqual([]);

  const payouts = [
    {
      id: "p1",
      boyId: BOY_ID,
      boyName: "Rahul",
      phone: null,
      amount: 40,
      method: "COD",
      status: "pending",
      createdAt: recent,
    },
  ];
  expect(ringingPayoutRequestIds(payouts, new Set(), now)).toEqual(["p1"]);
  expect(ringingPayoutRequestIds(payouts, new Set(["payout:p1"]), now)).toEqual([]);
});
