import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { PushBanner } from "@/components/PushBanner";
import { coinAdminQuery } from "@/components/admin/CoinRequests";
import {
  playCoinNotificationSound,
  showBackgroundCoinBrowserNotification,
  useCoinWallet,
} from "@/lib/coins";
import { flushAdminCoinNotificationQueue } from "@/lib/coins.functions";
import { rupees } from "@/lib/format";

const ADMIN_SEEN_COIN_ALERTS_KEY = "campu-admin-seen-coin-alerts-v1";
const RECENT_ALERT_WINDOW_MS = 10 * 60 * 1000;

function loadSeenSet(storageKey: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSeenSet(storageKey: string, seen: Set<string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...seen].slice(-300)));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Mounted once in AppShell for Admin users:
 * - Keeps `admin-coins` synced every 6s + on window focus/app_settings realtime updates
 * - Flushes any queued coin notification jobs cleanly in background
 * - Triggers `/notification.mp3` chime + glassmorphism `PushBanner` + OS notification
 *   whenever a new student coin purchase request arrives (even when Admin is on Home/Orders/Profile!)
 */
export function AdminCoinNotifier() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const flushQueue = useServerFn(flushAdminCoinNotificationQueue);
  const seenRef = useRef<Set<string> | null>(null);
  const initializedRef = useRef(false);

  const q = useQuery({
    ...coinAdminQuery,
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = loadSeenSet(ADMIN_SEEN_COIN_ALERTS_KEY);
    }
    const requests = q.data?.ledger.requests;
    if (!requests) return;

    const pending = requests.filter((r) => r.status === "pending");
    const now = Date.now();
    const seen = seenRef.current;

    const toAlert = pending.filter((r) => {
      if (seen.has(r.id)) return false;
      const ageMs = now - new Date(r.createdAt).getTime();
      // On first mount, only chime/banner for recent requests (last 10 min);
      // after first mount, chime/banner for every newly detected pending request.
      return !initializedRef.current ? ageMs <= RECENT_ALERT_WINDOW_MS : true;
    });

    // Mark all currently loaded pending requests as seen so banners never repeat
    for (const r of pending) {
      seen.add(r.id);
    }
    saveSeenSet(ADMIN_SEEN_COIN_ALERTS_KEY, seen);
    initializedRef.current = true;

    if (toAlert.length > 0) {
      playCoinNotificationSound();
      for (const req of toAlert.slice(0, 2)) {
        const title = `🪙 New Coin Recharge! (${req.coins} Coins · ${rupees(req.amount)})`;
        const body = `${req.userName} submitted UTR ${req.utrNumber}. Tap to verify & credit.`;
        showBackgroundCoinBrowserNotification(title, body, "/admin?tab=coins");
        toast.custom(
          (id) => (
            <PushBanner
              title={title}
              body={body}
              onClick={() => {
                toast.dismiss(id);
                void navigate({ to: "/admin", search: { tab: "coins" } });
              }}
            />
          ),
          { duration: 6500, position: "top-center" },
        );
      }
      // Also flush any queued background notification jobs (FCM / Telegram)
      void flushQueue().catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    }
  }, [q.data, navigate, flushQueue, queryClient]);

  return null;
}

/**
 * Mounted once in AppShell for signed-in students:
 * Watches their coin recharge requests and triggers `/notification.mp3` +
 * `PushBanner` + background browser notification the instant Admin approves or rejects.
 */
export function StudentCoinStatusNotifier({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const wallet = useCoinWallet();
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);
  const storageKey = `campu-coin-status-notified-${userId}`;

  useEffect(() => {
    prevStatusRef.current = new Map();
    seededRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (wallet.loading) return;

    const notified = loadSeenSet(storageKey);
    const prevMap = prevStatusRef.current;

    if (!seededRef.current) {
      for (const req of wallet.requests) {
        prevMap.set(req.id, req.status);
        // Catch transitions that happened shortly before this session opened if unread
        if (
          (req.status === "approved" || req.status === "rejected") &&
          !notified.has(`${req.id}:${req.status}`) &&
          req.reviewedAt &&
          Date.now() - new Date(req.reviewedAt).getTime() <= RECENT_ALERT_WINDOW_MS
        ) {
          notified.add(`${req.id}:${req.status}`);
          saveSeenSet(storageKey, notified);
          emitStudentCoinBanner(req.coins, req.status, () => {
            void navigate({ to: "/coins" });
          });
        }
      }
      seededRef.current = true;
      return;
    }

    for (const req of wallet.requests) {
      const prevStatus = prevMap.get(req.id);
      if (
        prevStatus &&
        prevStatus !== req.status &&
        (req.status === "approved" || req.status === "rejected") &&
        !notified.has(`${req.id}:${req.status}`)
      ) {
        notified.add(`${req.id}:${req.status}`);
        saveSeenSet(storageKey, notified);
        emitStudentCoinBanner(req.coins, req.status, () => {
          void navigate({ to: "/coins" });
        });
      }
      prevMap.set(req.id, req.status);
    }
  }, [wallet.loading, wallet.requests, navigate, storageKey]);

  return null;
}

function emitStudentCoinBanner(
  coins: number,
  status: "approved" | "rejected",
  onTap: () => void,
) {
  playCoinNotificationSound();
  const title =
    status === "approved" ? `🪙 +${coins} Campu Coins Added!` : "Coin Recharge Rejected";
  const body =
    status === "approved"
      ? `${coins} coins (${rupees(coins)}) are now ready to spend at checkout.`
      : `Your ₹${coins} coin payment could not be verified.`;

  showBackgroundCoinBrowserNotification(title, body, "/coins");
  toast.custom(
    (id) => (
      <PushBanner
        title={title}
        body={body}
        onClick={() => {
          toast.dismiss(id);
          onTap();
        }}
      />
    ),
    { duration: 6000, position: "top-center" },
  );
}
