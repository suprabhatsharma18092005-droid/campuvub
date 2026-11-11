import { initializeApp, getApps } from "firebase/app";
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";

import { firebaseConfig, vapidKey } from "./firebase-config";
import { getPushTokenWithRetry, migratePushToken } from "./push-policy";

const appId = firebaseConfig.appId;
const SW_VERSION = "4";
const SW_PATH = "/firebase-messaging-sw.js";

function swUrl() {
  return `${SW_PATH}?${new URLSearchParams({ ...firebaseConfig, v: SW_VERSION }).toString()}`;
}

/** Register the current worker, dropping any worker built for an older config. */
async function registerWorker(): Promise<ServiceWorkerRegistration> {
  const url = swUrl();
  const existing = await navigator.serviceWorker.getRegistrations();
  for (const reg of existing) {
    const script = reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? "";
    if (script.includes(SW_PATH) && !script.endsWith(url)) {
      const full = new URL(url, window.location.origin).href;
      if (script !== full) await reg.unregister().catch(() => false);
    }
  }
  const registration = await navigator.serviceWorker.register(url);
  await navigator.serviceWorker.ready;
  return registration;
}

export type PushResult =
  | { status: "registered"; token: string }
  | { status: "not-configured" | "unsupported" | "open-in-new-tab" | "denied" };

function configured() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    appId &&
    vapidKey &&
    firebaseConfig.messagingSenderId,
  );
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (!configured()) return null;
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !(await isSupported())) return null;
  const app = getApps().find((a) => a.name === firebaseConfig.projectId) ?? initializeApp(firebaseConfig, firebaseConfig.projectId);
  return getMessaging(app);
}

/** Must be called from a click handler — browsers ignore silent permission requests. */
export async function enablePush(saveToken: (token: string) => Promise<unknown>): Promise<PushResult> {
  if (!configured()) return { status: "not-configured" };
  if (!("Notification" in window) || !(await isSupported())) return { status: "unsupported" };
  if (window.top !== window.self) return { status: "open-in-new-tab" };

  const permission =
    Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  const registration = await registerWorker();
  const messaging = await getMessagingInstance();
  if (!messaging) return { status: "unsupported" };
  const token = await currentToken(messaging, registration, saveToken);
  return token ? { status: "registered", token } : { status: "denied" };
}

/**
 * Silent refresh: when permission is already granted, (re)fetch the current FCM
 * token without prompting. Returns null when blocked/unsupported — never throws.
 */
export async function refreshPushTokenSilently(saveToken: (token: string) => Promise<unknown>): Promise<string | null> {
  try {
    if (!configured() || typeof window === "undefined") return null;
    if (!("Notification" in window) || Notification.permission !== "granted") return null;
    if (!("serviceWorker" in navigator) || !(await isSupported())) return null;
    if (window.top !== window.self) return null;
    const registration = await registerWorker();
    const messaging = await getMessagingInstance();
    if (!messaging) return null;
    return (await currentToken(messaging, registration, saveToken)) || null;
  } catch (error) {
    console.warn("Push token refresh skipped", error);
    return null;
  }
}

async function currentToken(messaging: Messaging, registration: ServiceWorkerRegistration, saveToken: (token: string) => Promise<unknown>) {
  return migratePushToken({
    storedProject: localStorage.getItem("fcm_project_id"),
    deleteOldToken: async () => {
      try { await deleteToken(messaging); } catch { /* Old token cleanup is optional. */ }
      try {
        const subscription = await registration.pushManager.getSubscription();
        await subscription?.unsubscribe();
      } catch { /* Stale subscriptions must not prevent a fresh token. */ }
    },
    getFreshToken: () => getPushTokenWithRetry({
      getToken: () => getToken(messaging, { vapidKey, serviceWorkerRegistration: registration }),
      unsubscribe: async () => {
        const subscription = await registration.pushManager.getSubscription();
        await subscription?.unsubscribe();
      },
    }),
    saveToken,
    markProject: (project) => localStorage.setItem("fcm_project_id", project),
  });
}

/** Stable browser installation identifier, generated only after a user action/hydration. */
export function pushDeviceId(): string {
  const stored = localStorage.getItem("fcm_device_id");
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem("fcm_device_id", id);
  return id;
}

export type ForegroundMessage = { title: string; body: string; path?: string };

/**
 * Foreground delivery: intercept the push and hand it to the UI (toast) instead
 * of letting a system notification interrupt the user.
 */
export function listenForForegroundPush(handler: (message: ForegroundMessage) => void): () => void {
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;

  void (async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const messaging = await getMessagingInstance();
    if (!messaging || cancelled) return;
    unsubscribe = onMessage(messaging, (payload) => {
      const data = (payload.data ?? {}) as Record<string, string>;
      const title = payload.notification?.title ?? data["title"];
      const body = payload.notification?.body ?? data["body"] ?? "";
      if (!title) return;
      const path = data["path"];
      handler(path ? { title, body, path } : { title, body });
    });
  })();

  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
