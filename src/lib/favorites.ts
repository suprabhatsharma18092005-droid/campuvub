import { useSyncExternalStore } from "react";

const FAVORITES_KEY = "campu.favorites.v1";

let ids: string[] = [];
let hydrated = false;
const listeners = new Set<() => void>();
const EMPTY: string[] = [];

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        ids = parsed.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    /* ignore storage errors */
  }
}

function persist() {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* ignore storage errors */
  }
}

function emit() {
  for (const l of listeners) l();
}

export function isFavorite(productId: string): boolean {
  hydrate();
  return ids.includes(productId);
}

export function getFavorites(): string[] {
  hydrate();
  return ids;
}

export function toggleFavorite(productId: string): boolean {
  hydrate();
  const exists = ids.includes(productId);
  ids = exists ? ids.filter((id) => id !== productId) : [productId, ...ids];
  persist();
  emit();
  return !exists;
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  if (typeof window === "undefined") return () => { listeners.delete(listener); };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== FAVORITES_KEY) return;
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

export function useIsFavorite(productId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isFavorite(productId),
    () => false,
  );
}

export function useFavoriteIds(): string[] {
  return useSyncExternalStore(subscribe, getFavorites, () => EMPTY);
}
