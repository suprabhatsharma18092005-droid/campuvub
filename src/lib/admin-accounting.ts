import type { DeliveryAssignment } from "@/lib/delivery-boy";

export const ADMIN_ACCOUNTING_KEY = "admin_accounting_v1";

export function roundSignedMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function roundPositiveMoney(value: number): number {
  const n = roundSignedMoney(value);
  return n > 0 ? n : 0;
}

/** Formats an ISO timestamp into YYYY-MM-DD in Asia/Kolkata (IST). */
export function toIstDateKey(isoOrDate: string | Date = new Date()): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) {
    return toIstDateKey(new Date());
  }
  // en-CA formats reliably as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatIstDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  const dt = new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dt);
}

export type ProductCostEntry = {
  originalPrice: number;
  updatedAt: string;
};

export type OrderCostItemSnapshot = {
  productId?: string;
  name: string;
  qty: number;
  displayUnitPrice: number;
  originalUnitPrice: number | null;
};

export type OrderCostSnapshot = {
  orderId: string;
  dateKey: string;
  createdAt: string;
  items: OrderCostItemSnapshot[];
  displaySales: number;
  originalCostTotal: number;
  productProfit: number;
  deliveryCollected: number;
  deliveryPaidToBoy: number;
  deliveryKept: number;
  orderGrandTotal: number;
  netProfit: number;
  missingCostItems: number;
  updatedAt: string;
};

export type DailyProfitSummary = {
  dateKey: string;
  deliveredOrders: number;
  pendingOrders: number;
  totalOrdersPlaced: number;
  cancelledOrders: number;
  displaySales: number;
  originalCostTotal: number;
  productProfit: number;
  deliveryCollected: number;
  deliveryPaidToBoy: number;
  deliveryKept: number;
  grandTotalSales: number;
  netProfit: number;
  missingCostItems: number;
  updatedAt: string;
};

export type AdminAccountingV1 = {
  version: 1;
  productCosts: Record<string, ProductCostEntry>;
  orderCostSnapshots: Record<string, OrderCostSnapshot>;
  dailyHistory: Record<string, DailyProfitSummary>;
  updatedAt: string;
};

export function emptyAdminAccounting(): AdminAccountingV1 {
  return {
    version: 1,
    productCosts: {},
    orderCostSnapshots: {},
    dailyHistory: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseAdminAccounting(raw?: string | null): AdminAccountingV1 {
  if (!raw) return emptyAdminAccounting();
  try {
    const parsed = JSON.parse(raw) as Partial<AdminAccountingV1>;
    if (!parsed || typeof parsed !== "object") return emptyAdminAccounting();

    const productCosts: Record<string, ProductCostEntry> = {};
    if (parsed.productCosts && typeof parsed.productCosts === "object") {
      for (const [id, entry] of Object.entries(parsed.productCosts)) {
        if (!entry || typeof entry !== "object") continue;
        const price = Number((entry as Partial<ProductCostEntry>).originalPrice);
        if (Number.isFinite(price) && price >= 0) {
          productCosts[id] = {
            originalPrice: roundPositiveMoney(price),
            updatedAt:
              typeof (entry as Partial<ProductCostEntry>).updatedAt === "string"
                ? (entry as ProductCostEntry).updatedAt
                : new Date(0).toISOString(),
          };
        }
      }
    }

    const orderCostSnapshots: Record<string, OrderCostSnapshot> =
      parsed.orderCostSnapshots && typeof parsed.orderCostSnapshots === "object"
        ? (parsed.orderCostSnapshots as Record<string, OrderCostSnapshot>)
        : {};

    const dailyHistory: Record<string, DailyProfitSummary> = {};
    if (parsed.dailyHistory && typeof parsed.dailyHistory === "object") {
      for (const [key, rawDay] of Object.entries(
        parsed.dailyHistory as Record<string, Partial<DailyProfitSummary>>,
      )) {
        if (!rawDay || typeof rawDay !== "object") continue;
        const delivered = Number(rawDay.deliveredOrders) || 0;
        const cancelled = Number(rawDay.cancelledOrders) || 0;
        const totalPlaced = Number(rawDay.totalOrdersPlaced) || delivered + cancelled;
        const pending =
          typeof rawDay.pendingOrders === "number" && Number.isFinite(rawDay.pendingOrders)
            ? Math.max(0, rawDay.pendingOrders)
            : Math.max(0, totalPlaced - delivered - cancelled);
        dailyHistory[key] = {
          dateKey: typeof rawDay.dateKey === "string" ? rawDay.dateKey : key,
          deliveredOrders: delivered,
          pendingOrders: pending,
          totalOrdersPlaced: totalPlaced,
          cancelledOrders: cancelled,
          displaySales: roundSignedMoney(Number(rawDay.displaySales) || 0),
          originalCostTotal: roundSignedMoney(Number(rawDay.originalCostTotal) || 0),
          productProfit: roundSignedMoney(Number(rawDay.productProfit) || 0),
          deliveryCollected: roundSignedMoney(Number(rawDay.deliveryCollected) || 0),
          deliveryPaidToBoy: roundSignedMoney(Number(rawDay.deliveryPaidToBoy) || 0),
          deliveryKept: roundSignedMoney(Number(rawDay.deliveryKept) || 0),
          grandTotalSales: roundSignedMoney(Number(rawDay.grandTotalSales) || 0),
          netProfit: roundSignedMoney(Number(rawDay.netProfit) || 0),
          missingCostItems: Number(rawDay.missingCostItems) || 0,
          updatedAt:
            typeof rawDay.updatedAt === "string" ? rawDay.updatedAt : new Date(0).toISOString(),
        };
      }
    }

    return {
      version: 1,
      productCosts,
      orderCostSnapshots,
      dailyHistory,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyAdminAccounting();
  }
}

export type AccountingOrderInput = {
  id: string;
  cart_items: unknown;
  subtotal: number | string;
  delivery_fee: number | string;
  total: number | string;
  status: string;
  created_at: string;
  cancelled_at?: string | null;
};

export function computeOrderAccounting(params: {
  order: AccountingOrderInput;
  productCosts: Record<string, ProductCostEntry>;
  existingSnapshot?: OrderCostSnapshot | null | undefined;
  assignment?: DeliveryAssignment | null | undefined;
  productIdByName?: Record<string, string> | undefined;
  forceRecalculateCosts?: boolean | undefined;
}): OrderCostSnapshot {
  const { order, productCosts, existingSnapshot, assignment, productIdByName, forceRecalculateCosts } =
    params;
  const dateKey = toIstDateKey(order.created_at);
  const rawItems = Array.isArray(order.cart_items) ? order.cart_items : [];

  let displaySales = 0;
  let originalCostTotal = 0;
  let missingCostItems = 0;
  const items: OrderCostItemSnapshot[] = [];

  rawItems.forEach((raw, idx) => {
    const item = raw as { id?: string; name?: string; qty?: number; price?: number };
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const displayUnitPrice = roundPositiveMoney(Number(item.price) || 0);
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Item";
    const resolvedId =
      typeof item.id === "string" && item.id
        ? item.id
        : productIdByName?.[name.toLowerCase()];

    // Preserve previously recorded historical unit cost unless missing or explicitly recalculated.
    const prevSnapItem = existingSnapshot?.items?.[idx];
    const hasSavedSnapCost =
      !forceRecalculateCosts &&
      prevSnapItem &&
      prevSnapItem.name === name &&
      prevSnapItem.originalUnitPrice !== null &&
      Number.isFinite(prevSnapItem.originalUnitPrice);

    let originalUnitPrice: number | null = null;
    if (hasSavedSnapCost) {
      originalUnitPrice = roundPositiveMoney(prevSnapItem.originalUnitPrice as number);
    } else if (resolvedId && productCosts[resolvedId]) {
      originalUnitPrice = roundPositiveMoney(productCosts[resolvedId].originalPrice);
    }

    displaySales = roundSignedMoney(displaySales + displayUnitPrice * qty);
    if (originalUnitPrice !== null) {
      originalCostTotal = roundSignedMoney(originalCostTotal + originalUnitPrice * qty);
    } else {
      missingCostItems += qty;
    }

    items.push({
      ...(resolvedId ? { productId: resolvedId } : {}),
      name,
      qty,
      displayUnitPrice,
      originalUnitPrice,
    });
  });

  // Fallback if cart_items happened to be empty
  if (rawItems.length === 0) {
    displaySales = roundPositiveMoney(Number(order.subtotal) || 0);
  }

  const productProfit = roundSignedMoney(displaySales - originalCostTotal);
  const deliveryCollected = roundPositiveMoney(Number(order.delivery_fee) || 0);
  const deliveryPaidToBoy =
    assignment && (assignment.status === "delivered" || assignment.earningCredited)
      ? roundPositiveMoney(assignment.earningAmount)
      : 0;
  const deliveryKept = roundSignedMoney(deliveryCollected - deliveryPaidToBoy);
  const orderGrandTotal = roundPositiveMoney(Number(order.total) || displaySales + deliveryCollected);
  const netProfit = roundSignedMoney(productProfit + deliveryKept);

  return {
    orderId: order.id,
    dateKey,
    createdAt: order.created_at,
    items,
    displaySales,
    originalCostTotal,
    productProfit,
    deliveryCollected,
    deliveryPaidToBoy,
    deliveryKept,
    orderGrandTotal,
    netProfit,
    missingCostItems,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reconciles live delivered orders + assignments into persistent per-order snapshots and
 * per-day IST summaries (`dailyHistory`), preserving past days beyond live order query limits.
 */
export function syncAccountingWithOrders(params: {
  base: AdminAccountingV1;
  orders: AccountingOrderInput[];
  assignmentsByOrder: Record<string, DeliveryAssignment | undefined>;
  products?: Array<{ id: string; name: string }> | undefined;
  forceRecalculateCosts?: boolean | undefined;
}): { next: AdminAccountingV1; changed: boolean } {
  const { base, orders, assignmentsByOrder, products = [], forceRecalculateCosts } = params;
  const productIdByName: Record<string, string> = {};
  for (const p of products) {
    if (p.name) productIdByName[p.name.trim().toLowerCase()] = p.id;
  }

  const nextOrderSnapshots: Record<string, OrderCostSnapshot> = { ...base.orderCostSnapshots };
  let changed = false;

  // Group live orders by IST dateKey
  const ordersByDay = new Map<string, AccountingOrderInput[]>();
  const deliveredSnapshotsByDay = new Map<string, OrderCostSnapshot[]>();

  for (const ord of orders) {
    const dateKey = toIstDateKey(ord.created_at);
    const list = ordersByDay.get(dateKey) ?? [];
    list.push(ord);
    ordersByDay.set(dateKey, list);

    if (ord.status === "delivered") {
      const prevSnap = base.orderCostSnapshots[ord.id];
      const nextSnap = computeOrderAccounting({
        order: ord,
        productCosts: base.productCosts,
        existingSnapshot: prevSnap,
        assignment: assignmentsByOrder[ord.id],
        productIdByName,
        forceRecalculateCosts,
      });

      const snapDiffers =
        !prevSnap ||
        prevSnap.displaySales !== nextSnap.displaySales ||
        prevSnap.originalCostTotal !== nextSnap.originalCostTotal ||
        prevSnap.deliveryCollected !== nextSnap.deliveryCollected ||
        prevSnap.deliveryPaidToBoy !== nextSnap.deliveryPaidToBoy ||
        prevSnap.missingCostItems !== nextSnap.missingCostItems ||
        prevSnap.netProfit !== nextSnap.netProfit;

      if (snapDiffers) {
        nextOrderSnapshots[ord.id] = nextSnap;
        changed = true;
      }

      const daySnaps = deliveredSnapshotsByDay.get(dateKey) ?? [];
      daySnaps.push(nextSnap);
      deliveredSnapshotsByDay.set(dateKey, daySnaps);
    } else if (nextOrderSnapshots[ord.id]) {
      // Order was no longer delivered (edge case) -> remove stale snapshot
      delete nextOrderSnapshots[ord.id];
      changed = true;
    }
  }

  const nextDailyHistory: Record<string, DailyProfitSummary> = { ...base.dailyHistory };
  const nowIso = new Date().toISOString();

  for (const [dateKey, dayOrders] of ordersByDay.entries()) {
    const daySnaps = deliveredSnapshotsByDay.get(dateKey) ?? [];
    const cancelledCount = dayOrders.filter((o) => o.status === "cancelled").length;
    const pendingCount = dayOrders.filter(
      (o) => o.status !== "delivered" && o.status !== "cancelled",
    ).length;
    const summary: DailyProfitSummary = {
      dateKey,
      deliveredOrders: daySnaps.length,
      pendingOrders: pendingCount,
      totalOrdersPlaced: dayOrders.length,
      cancelledOrders: cancelledCount,
      displaySales: roundSignedMoney(daySnaps.reduce((s, r) => s + r.displaySales, 0)),
      originalCostTotal: roundSignedMoney(daySnaps.reduce((s, r) => s + r.originalCostTotal, 0)),
      productProfit: roundSignedMoney(daySnaps.reduce((s, r) => s + r.productProfit, 0)),
      deliveryCollected: roundSignedMoney(daySnaps.reduce((s, r) => s + r.deliveryCollected, 0)),
      deliveryPaidToBoy: roundSignedMoney(daySnaps.reduce((s, r) => s + r.deliveryPaidToBoy, 0)),
      deliveryKept: roundSignedMoney(daySnaps.reduce((s, r) => s + r.deliveryKept, 0)),
      grandTotalSales: roundSignedMoney(daySnaps.reduce((s, r) => s + r.orderGrandTotal, 0)),
      netProfit: roundSignedMoney(daySnaps.reduce((s, r) => s + r.netProfit, 0)),
      missingCostItems: daySnaps.reduce((s, r) => s + r.missingCostItems, 0),
      updatedAt: nowIso,
    };

    const prevDay = base.dailyHistory[dateKey];
    const dayDiffers =
      !prevDay ||
      prevDay.deliveredOrders !== summary.deliveredOrders ||
      prevDay.pendingOrders !== summary.pendingOrders ||
      prevDay.totalOrdersPlaced !== summary.totalOrdersPlaced ||
      prevDay.cancelledOrders !== summary.cancelledOrders ||
      prevDay.displaySales !== summary.displaySales ||
      prevDay.originalCostTotal !== summary.originalCostTotal ||
      prevDay.deliveryCollected !== summary.deliveryCollected ||
      prevDay.deliveryPaidToBoy !== summary.deliveryPaidToBoy ||
      prevDay.missingCostItems !== summary.missingCostItems ||
      prevDay.netProfit !== summary.netProfit;

    if (dayDiffers) {
      nextDailyHistory[dateKey] = summary;
      changed = true;
    }
  }

  // Keep most recent 400 order snapshots & 365 daily summaries cleanly bounded
  const boundedOrders = Object.fromEntries(
    Object.entries(nextOrderSnapshots)
      .sort((a, b) => new Date(b[1].createdAt).getTime() - new Date(a[1].createdAt).getTime())
      .slice(0, 400),
  );
  const boundedDays = Object.fromEntries(
    Object.entries(nextDailyHistory)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 365),
  );

  if (!changed) {
    return { next: base, changed: false };
  }

  return {
    changed: true,
    next: {
      version: 1,
      productCosts: base.productCosts,
      orderCostSnapshots: boundedOrders,
      dailyHistory: boundedDays,
      updatedAt: nowIso,
    },
  };
}

export function aggregateAllDailyHistory(
  dailyHistory: Record<string, DailyProfitSummary>,
): Omit<DailyProfitSummary, "dateKey" | "updatedAt"> {
  const days = Object.values(dailyHistory);
  return {
    deliveredOrders: days.reduce((s, d) => s + d.deliveredOrders, 0),
    pendingOrders: days.reduce((s, d) => s + (d.pendingOrders ?? 0), 0),
    totalOrdersPlaced: days.reduce((s, d) => s + d.totalOrdersPlaced, 0),
    cancelledOrders: days.reduce((s, d) => s + d.cancelledOrders, 0),
    displaySales: roundSignedMoney(days.reduce((s, d) => s + d.displaySales, 0)),
    originalCostTotal: roundSignedMoney(days.reduce((s, d) => s + d.originalCostTotal, 0)),
    productProfit: roundSignedMoney(days.reduce((s, d) => s + d.productProfit, 0)),
    deliveryCollected: roundSignedMoney(days.reduce((s, d) => s + d.deliveryCollected, 0)),
    deliveryPaidToBoy: roundSignedMoney(days.reduce((s, d) => s + d.deliveryPaidToBoy, 0)),
    deliveryKept: roundSignedMoney(days.reduce((s, d) => s + d.deliveryKept, 0)),
    grandTotalSales: roundSignedMoney(days.reduce((s, d) => s + d.grandTotalSales, 0)),
    netProfit: roundSignedMoney(days.reduce((s, d) => s + d.netProfit, 0)),
    missingCostItems: days.reduce((s, d) => s + d.missingCostItems, 0),
  };
}
