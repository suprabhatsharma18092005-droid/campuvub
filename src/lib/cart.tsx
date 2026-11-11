import { getDeliveryMode, subscribeDeliveryMode, type DeliveryMode } from "@/lib/delivery";
import { useQuery } from "@tanstack/react-query";
import { productsQuery } from "@/lib/queries";
import { productInMode } from "@/lib/delivery";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type CartItem = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  qty: number;
  /** Delivery mode the item was added in (missing = quick). */
  mode?: DeliveryMode;
};

export type CartApi = {
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
};

type CartValue = CartApi & {
  items: CartItem[];
  count: number;
  subtotal: number;
  bump: number;
};

type CartState = { items: CartItem[]; bump: number; hydrated: boolean };

const CartContext = createContext<CartValue | null>(null);
const STORAGE_KEY = "campu.cart.v1";

// External store: cart mutations are synchronous and only components that read
// the changed slice re-render — the whole product grid no longer re-renders on
// every Add / + / - tap.
let state: CartState = { items: [], bump: 0, hydrated: false };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function commit(patch: Partial<Pick<CartState, "items" | "bump">>) {
  state = { ...state, ...patch };
  emit();
  persist();
}

function persist() {
  if (!state.hydrated) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
  } catch {
    /* ignore */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const off = subscribeDeliveryMode(listener);
  return () => {
    listeners.delete(listener);
    off();
  };
}

const modeOf = (i: CartItem): DeliveryMode => i.mode ?? "quick";
/** The cart follows the selected delivery mode, so an order never mixes modes. */
const inMode = (i: CartItem) => modeOf(i) === getDeliveryMode();
const same = (i: CartItem, id: string) => i.id === id && inMode(i);

let cachedKey: unknown[] = [];
let cachedView: CartItem[] = [];
function visibleItems(): CartItem[] {
  const m = getDeliveryMode();
  if (cachedKey[0] !== state.items || cachedKey[1] !== m) {
    cachedKey = [state.items, m];
    cachedView = state.items.filter(inMode);
  }
  return cachedView;
}

const cartApi: CartApi = {
  add(item, qty = 1) {
    const found = state.items.find((i) => same(i, item.id));
    const items = found
      ? state.items.map((i) => (same(i, item.id) ? { ...i, qty: i.qty + qty } : i))
      : [...state.items, { ...item, qty, mode: getDeliveryMode() }];
    commit({ items, bump: state.bump + 1 });
  },
  setQty(id, qty) {
    const items =
      qty <= 0
        ? state.items.filter((i) => !same(i, id))
        : state.items.map((i) => (same(i, id) ? { ...i, qty } : i));
    commit({ items, bump: state.bump + 1 });
  },
  remove(id) {
    commit({ items: state.items.filter((i) => !same(i, id)) });
  },
  clear() {
    commit({ items: state.items.filter((i) => !inMode(i)) });
  },
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let items: CartItem[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) items = JSON.parse(raw) as CartItem[];
    } catch {
      /* ignore */
    }
    state = { ...state, items, hydrated: true };
    emit();
  }, []);

  const snapshot = useSyncExternalStore(subscribe, visibleItems, () => state.items);

  const value = useMemo<CartValue>(() => {
    const count = snapshot.reduce((n, i) => n + i.qty, 0);
    const subtotal = snapshot.reduce((n, i) => n + i.qty * Number(i.price), 0);
    return { items: snapshot, count, subtotal, bump: state.bump, ...cartApi };
  }, [snapshot]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  // Resilient fallback: if a hot reload ever leaves a consumer outside the
  // provider, show an empty cart instead of blanking the whole screen.
  const ctx = useContext(CartContext);
  if (!ctx) {
    const items = visibleItems();
    const count = items.reduce((n, i) => n + i.qty, 0);
    const subtotal = items.reduce((n, i) => n + i.qty * Number(i.price), 0);
    return { items, count, subtotal, bump: state.bump, ...cartApi };
  }
  return ctx;
}

/** Stable mutation API — identity never changes, safe inside memoized cards. */
export function useCartApi(): CartApi {
  return cartApi;
}

/** Subscribe to a single product's quantity; only that card re-renders on change. */
export function useCartQty(id: string): number {
  return useSyncExternalStore(
    subscribe,
    () => state.items.find((i) => same(i, id))?.qty ?? 0,
    () => 0,
  );
}

/** Drops cart items whose product is not sold in the selected delivery mode. */
export function useEnforceCartMode() {
  const { data } = useQuery(productsQuery);
  const items = useCart().items;
  const mode = useSyncExternalStore(subscribeDeliveryMode, getDeliveryMode, () => "quick" as DeliveryMode);
  useEffect(() => {
    if (!data) return;
    const ok = new Map(data.map((p) => [p.id, productInMode(p.delivery_types, mode)]));
    const bad = items.filter((i) => !ok.get(i.id));
    if (bad.length) bad.forEach((i) => cartApi.remove(i.id));
  }, [data, items, mode]);
}
