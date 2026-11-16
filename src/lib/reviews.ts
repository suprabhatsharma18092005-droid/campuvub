import { useSyncExternalStore } from "react";

export type ProductReview = {
  id: string;
  orderId: string;
  productId: string;
  rating: number;
  comment: string;
  userName: string;
  createdAt: string;
};

export type ProductReviewAggregate = {
  count: number;
  sum: number;
  recent?: { rating: number; comment: string; userName: string; createdAt: string }[];
};

export const REVIEWS_SETTING_KEY = "product_reviews_summary";
const LOCAL_REVIEWS_KEY = "campu.reviews.v1";

let localReviews: ProductReview[] = [];
let hydrated = false;
const listeners = new Set<() => void>();
const EMPTY: ProductReview[] = [];

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(LOCAL_REVIEWS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        localReviews = parsed.filter(
          (r): r is ProductReview =>
            Boolean(r) &&
            typeof r.id === "string" &&
            typeof r.orderId === "string" &&
            typeof r.productId === "string" &&
            typeof r.rating === "number",
        );
      }
    }
  } catch {
    /* ignore storage errors */
  }
}

function persist() {
  try {
    window.localStorage.setItem(LOCAL_REVIEWS_KEY, JSON.stringify(localReviews));
  } catch {
    /* ignore storage errors */
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getLocalReviews(): ProductReview[] {
  hydrate();
  return localReviews;
}

export function saveLocalReview(review: ProductReview) {
  hydrate();
  const idx = localReviews.findIndex(
    (r) => r.orderId === review.orderId && r.productId === review.productId,
  );
  if (idx >= 0) {
    const next = [...localReviews];
    next[idx] = review;
    localReviews = next;
  } else {
    localReviews = [review, ...localReviews];
  }
  persist();
  emit();
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  if (typeof window === "undefined") return () => { listeners.delete(listener); };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== LOCAL_REVIEWS_KEY) return;
    hydrated = false;
    hydrate();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useLocalReviews(): ProductReview[] {
  return useSyncExternalStore(subscribe, getLocalReviews, () => EMPTY);
}

let lastGlobalRaw: string | undefined;
let lastGlobalMap: Record<string, ProductReviewAggregate> = {};

export function parseGlobalReviewsSummary(raw?: string): Record<string, ProductReviewAggregate> {
  if (!raw) return {};
  if (raw === lastGlobalRaw) return lastGlobalMap;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      lastGlobalRaw = raw;
      lastGlobalMap = parsed as Record<string, ProductReviewAggregate>;
      return lastGlobalMap;
    }
  } catch {
    /* ignore malformed JSON */
  }
  return {};
}

export function getProductReviewStats(
  productId: string,
  globalRaw?: string,
  locals: ProductReview[] = getLocalReviews(),
): {
  avg: number;
  count: number;
  recent: { rating: number; comment: string; userName: string; createdAt: string }[];
} {
  const globalMap = parseGlobalReviewsSummary(globalRaw);
  const g = globalMap[productId];
  const localForProduct = locals.filter((r) => r.productId === productId);

  // Merge avoiding double-counting entries already listed in global.recent
  const globalRecentKeys = new Set(
    (g?.recent ?? []).map((r) => `${r.userName}|${r.createdAt.slice(0, 16)}`),
  );
  const extraLocal = localForProduct.filter(
    (r) => !globalRecentKeys.has(`${r.userName}|${r.createdAt.slice(0, 16)}`),
  );

  const count = (g?.count ?? 0) + extraLocal.length;
  const sum = (g?.sum ?? 0) + extraLocal.reduce((acc, r) => acc + r.rating, 0);
  const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

  const recent = [
    ...extraLocal.map((r) => ({
      rating: r.rating,
      comment: r.comment,
      userName: r.userName,
      createdAt: r.createdAt,
    })),
    ...(g?.recent ?? []),
  ].slice(0, 10);

  return { avg, count, recent };
}
