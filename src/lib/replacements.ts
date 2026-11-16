export const REPLACEMENT_SETTING_PREFIX = "order_replacement_";

export function replacementSettingKey(orderId: string): string {
  return `${REPLACEMENT_SETTING_PREFIX}${orderId}`;
}

export type ReplacementItem = {
  id: string;
  name: string;
  qty: number;
  price: number;
  image_url: string | null;
};

export type OrderReplacementStatus =
  | "awaiting_student"
  | "student_confirmed"
  | "extra_payment_submitted"
  | "applied"
  | "cancelled";

export type OrderReplacement = {
  orderId: string;
  status: OrderReplacementStatus;
  unavailableItem: ReplacementItem;
  suggestedItems: ReplacementItem[];
  adminNote?: string;
  chosenItems?: ReplacementItem[];
  priceDifference?: number;
  extraPaymentMethod?: "UPI" | "COD";
  extraUtr?: string | null;
  partialRefundStatus?: "none" | "pending" | "refunded";
  partialRefundProofPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function parseOrderReplacement(raw?: string | null): OrderReplacement | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OrderReplacement>;
    if (
      !parsed ||
      typeof parsed.orderId !== "string" ||
      typeof parsed.status !== "string" ||
      !parsed.unavailableItem
    ) {
      return null;
    }
    return parsed as OrderReplacement;
  } catch {
    return null;
  }
}

export function getReplacementItemTotal(items: ReplacementItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price) * item.qty, 0);
}

export function computeCartWithReplacement(
  cartItems: ReplacementItem[],
  unavailableItem: ReplacementItem,
  chosenItems: ReplacementItem[],
): { items: ReplacementItem[]; subtotal: number } {
  const nextItems: ReplacementItem[] = [];
  let remainingToRemove = unavailableItem.qty;

  for (const item of cartItems) {
    const matches =
      (item.id && unavailableItem.id && item.id === unavailableItem.id) ||
      item.name === unavailableItem.name;
    if (matches && remainingToRemove > 0) {
      if (item.qty > remainingToRemove) {
        nextItems.push({ ...item, qty: item.qty - remainingToRemove });
        remainingToRemove = 0;
      } else {
        remainingToRemove -= item.qty;
      }
      continue;
    }
    nextItems.push({ ...item });
  }

  for (const picked of chosenItems) {
    if (picked.qty <= 0) continue;
    const existing = nextItems.find((i) => i.id === picked.id);
    if (existing) {
      existing.qty += picked.qty;
    } else {
      nextItems.push({ ...picked });
    }
  }

  const subtotal = nextItems.reduce((sum, i) => sum + Number(i.price) * i.qty, 0);
  return { items: nextItems, subtotal };
}

const LOCAL_REPLACEMENT_PREFIX = "campu.replacement.v1.";

export function readLocalReplacement(orderId: string): OrderReplacement | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${LOCAL_REPLACEMENT_PREFIX}${orderId}`);
    if (!raw) return null;
    return JSON.parse(raw) as OrderReplacement;
  } catch {
    return null;
  }
}

export function writeLocalReplacement(record: OrderReplacement) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${LOCAL_REPLACEMENT_PREFIX}${record.orderId}`,
      JSON.stringify(record),
    );
  } catch {
    /* ignore storage errors */
  }
}
