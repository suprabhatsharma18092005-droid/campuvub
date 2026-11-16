/**
 * Non-blocking Coin Notification Queue (.server.ts).
 *
 * Enqueues coin payment requests and approval/rejection updates immediately so
 * payment submission NEVER blocks or fails on push/Telegram latency.
 * Processes queued jobs asynchronously with exponential retry and optional
 * persistence in `app_settings["coin_notify_queue_v1"]` when service-role access
 * is available.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { COIN_NOTIFY_QUEUE_KEY, parseCoinNotifyQueue, type CoinNotificationJob } from "@/lib/coins";

const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [0, 3_000, 10_000, 30_000] as const;

type QueuedRuntimeJob = CoinNotificationJob & {
  authHeader?: string | null;
  adminVerified?: boolean;
};

const runtimeQueue = new Map<string, QueuedRuntimeJob>();
let flushPromise: Promise<{ processed: number; delivered: number }> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function hasLiveAdminDb(): boolean {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

function hasTelegramConfig(): { token: string; chatId: string } | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_ADMIN_CHAT_ID"]?.trim();
  if (!token || !chatId) return null;
  return { token, chatId };
}

async function sendTelegramCoinAlert(job: Extract<QueuedRuntimeJob, { kind: "coin_request" }>): Promise<boolean> {
  const tg = hasTelegramConfig();
  if (!tg) return false;
  const text = [
    `🪙 New Coin Recharge Request!`,
    `💰 ${job.coins} Coins (₹${job.amount})`,
    `👤 ${job.customerName}`,
    `🧾 UTR: ${job.utrNumber}`,
    `Review in Admin → Coins`,
  ].join("\n");

  const res = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: tg.chatId, text }),
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 160);
    throw new Error(`Telegram responded ${res.status}: ${body}`);
  }
  return true;
}

async function persistQueueSnapshot(client?: SupabaseClient<Database>): Promise<void> {
  try {
    let targetClient = client;
    if (!targetClient && hasLiveAdminDb()) {
      targetClient = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    }
    if (!targetClient) return;

    const { data: existingRow } = await targetClient
      .from("app_settings")
      .select("value")
      .eq("key", COIN_NOTIFY_QUEUE_KEY)
      .maybeSingle();

    const existing = parseCoinNotifyQueue(existingRow?.value);
    const mergedMap = new Map<string, CoinNotificationJob>();
    for (const item of existing) {
      mergedMap.set(item.id, item);
    }
    for (const [id, job] of runtimeQueue.entries()) {
      const { authHeader: _auth, adminVerified: _adm, ...serializable } = job;
      void _auth;
      void _adm;
      mergedMap.set(id, serializable);
    }

    const sorted = Array.from(mergedMap.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 80);

    await targetClient
      .from("app_settings")
      .upsert({ key: COIN_NOTIFY_QUEUE_KEY, value: JSON.stringify(sorted) }, { onConflict: "key" });
  } catch {
    // Queue persistence is best-effort and must never crash payment or approval flows.
  }
}

async function hydratePendingJobsFromDb(client?: SupabaseClient<Database>): Promise<void> {
  try {
    let targetClient = client;
    if (!targetClient && hasLiveAdminDb()) {
      targetClient = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    }
    if (!targetClient) return;
    const { data } = await targetClient
      .from("app_settings")
      .select("value")
      .eq("key", COIN_NOTIFY_QUEUE_KEY)
      .maybeSingle();
    const persisted = parseCoinNotifyQueue(data?.value);
    for (const job of persisted) {
      if (job.status === "pending" && !runtimeQueue.has(job.id)) {
        runtimeQueue.set(
          job.id,
          job.kind === "coin_status" ? { ...job, adminVerified: true } : { ...job },
        );
      }
    }
  } catch {
    // Non-fatal
  }
}

async function deliverSingleJob(job: QueuedRuntimeJob): Promise<{ ok: boolean; error?: string }> {
  const { canSendLocally, forwardPushEvent } = await import("./push-events.server");
  const delivery = await import("./push-delivery.server");
  const customPushHost = process.env["PUSH_EVENT_HOST_URL"]?.trim();
  const tgConfigured = Boolean(hasTelegramConfig());

  const errors: string[] = [];
  let attemptedRemote = false;

  if (canSendLocally()) {
    attemptedRemote = true;
    try {
      if (job.kind === "coin_request") {
        await delivery.sendCoinRequestAlert({
          requestId: job.requestId,
          customerName: job.customerName,
          utrNumber: job.utrNumber,
          coins: job.coins,
          amount: job.amount,
        });
      } else if (job.adminVerified) {
        await delivery.sendCoinStatusAlert({
          userId: job.userId,
          coins: job.coins,
          status: job.decision,
        });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Local push delivery failed");
    }
  } else if (customPushHost && job.authHeader) {
    attemptedRemote = true;
    try {
      const eventPayload =
        job.kind === "coin_request"
          ? ({
              type: "coin_request",
              requestId: job.requestId,
              coins: job.coins,
              amount: job.amount,
              utrNumber: job.utrNumber,
              customerName: job.customerName,
            } as const)
          : ({
              type: "coin_status",
              userId: job.userId,
              coins: job.coins,
              status: job.decision,
            } as const);
      const res = await forwardPushEvent(eventPayload, job.authHeader, { base: customPushHost });
      if (res.error) errors.push(res.error);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Push host hand-off failed");
    }
  }

  if (job.kind === "coin_request" && tgConfigured) {
    attemptedRemote = true;
    try {
      await sendTelegramCoinAlert(job);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Telegram alert failed");
    }
  }

  // When neither FCM secrets nor Telegram env vars exist on this host,
  // in-app realtime + AdminCoinNotifier + OrderSiren deliver the notification cleanly.
  if (!attemptedRemote || errors.length === 0) {
    return { ok: true };
  }

  return { ok: false, error: errors.join(" | ").slice(0, 200) };
}

function scheduleRetry(delayMs: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushCoinNotificationQueue();
  }, delayMs);
}

/**
 * Adds a coin notification job to the non-blocking queue and schedules
 * background delivery immediately without awaiting network I/O.
 */
export function enqueueCoinNotification(
  input:
    | {
        kind: "coin_request";
        requestId: string;
        userId: string;
        customerName: string;
        coins: number;
        amount: number;
        utrNumber: string;
        authHeader?: string | null;
      }
    | {
        kind: "coin_status";
        requestId: string;
        userId: string;
        coins: number;
        decision: "approved" | "rejected";
        authHeader?: string | null;
        adminVerified?: boolean;
      },
): string {
  const jobId = `${input.kind}:${input.requestId}`;
  const existing = runtimeQueue.get(jobId);
  if (existing && (existing.status === "delivered" || existing.status === "pending")) {
    // Still trigger an async flush if pending so it doesn't stall
    if (existing.status === "pending") scheduleRetry(0);
    return jobId;
  }

  const nowIso = new Date().toISOString();
  const job: QueuedRuntimeJob =
    input.kind === "coin_request"
      ? {
          id: jobId,
          kind: "coin_request",
          requestId: input.requestId,
          userId: input.userId,
          customerName: input.customerName,
          coins: input.coins,
          amount: input.amount,
          utrNumber: input.utrNumber,
          status: "pending",
          attempts: 0,
          createdAt: nowIso,
          lastAttemptAt: null,
          deliveredAt: null,
          lastError: null,
          authHeader: input.authHeader ?? null,
        }
      : {
          id: jobId,
          kind: "coin_status",
          requestId: input.requestId,
          userId: input.userId,
          coins: input.coins,
          decision: input.decision,
          status: "pending",
          attempts: 0,
          createdAt: nowIso,
          lastAttemptAt: null,
          deliveredAt: null,
          lastError: null,
          authHeader: input.authHeader ?? null,
          adminVerified: Boolean(input.adminVerified),
        };

  runtimeQueue.set(jobId, job);
  scheduleRetry(0);
  return jobId;
}

/**
 * Processes all pending coin notification jobs safely with retries.
 * Can be awaited by dedicated background trigger endpoints or run via timer.
 */
export async function flushCoinNotificationQueue(options?: {
  persistClient?: SupabaseClient<Database>;
}): Promise<{ processed: number; delivered: number }> {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    await hydratePendingJobsFromDb(options?.persistClient);

    let processed = 0;
    let delivered = 0;
    let earliestRetryMs: number | null = null;

    const pendingJobs = Array.from(runtimeQueue.values()).filter((j) => j.status === "pending");
    for (const job of pendingJobs) {
      processed += 1;
      const attemptNum = job.attempts + 1;
      const nowIso = new Date().toISOString();

      const res = await deliverSingleJob(job);
      if (res.ok) {
        delivered += 1;
        runtimeQueue.set(job.id, {
          ...job,
          status: "delivered",
          attempts: attemptNum,
          lastAttemptAt: nowIso,
          deliveredAt: nowIso,
          lastError: null,
        });
      } else if (attemptNum >= MAX_ATTEMPTS) {
        runtimeQueue.set(job.id, {
          ...job,
          status: "failed",
          attempts: attemptNum,
          lastAttemptAt: nowIso,
          lastError: res.error ?? "Max delivery attempts reached",
        });
      } else {
        const retryDelay = RETRY_DELAYS_MS[attemptNum] ?? 30_000;
        earliestRetryMs = earliestRetryMs === null ? retryDelay : Math.min(earliestRetryMs, retryDelay);
        runtimeQueue.set(job.id, {
          ...job,
          status: "pending",
          attempts: attemptNum,
          lastAttemptAt: nowIso,
          lastError: res.error ?? "Delivery retry scheduled",
        });
      }
    }

    if (processed > 0) {
      await persistQueueSnapshot(options?.persistClient);
    }
    if (earliestRetryMs !== null) {
      scheduleRetry(earliestRetryMs);
    }

    return { processed, delivered };
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}
