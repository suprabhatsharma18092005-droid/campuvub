import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Coins, History, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  COIN_LEDGER_SETTING_KEY,
  emptyCoinLedger,
  parseCoinLedger,
  reconcileCoinLedger,
  roundCoinValue,
  validateCoinPurchaseInput,
  type CoinLedgerV1,
} from "@/lib/coins";
import {
  flushAdminCoinNotificationQueue,
  notifyCoinStatusDecision,
  reviewCoinPurchaseRequest,
} from "@/lib/coins.functions";
import { rupees } from "@/lib/format";

export type AdminCoinData = {
  ledger: CoinLedgerV1;
  profiles: Record<string, { name: string; phone: string | null }>;
  autoAcceptedOrderIds: string[];
};

export async function loadAndSyncAdminCoins(): Promise<AdminCoinData> {
  const [settingRes, sugRes, ordRes, profRes] = await Promise.all([
    supabase.from("app_settings").select("value").eq("key", COIN_LEDGER_SETTING_KEY).maybeSingle(),
    supabase
      .from("suggestions")
      .select("id, user_id, suggestion_text")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("orders").select("id, status").order("created_at", { ascending: false }).limit(500),
    supabase.from("profiles").select("id, full_name, phone_number"),
  ]);

  const base = settingRes.error ? emptyCoinLedger() : parseCoinLedger(settingRes.data?.value);
  const orderStatuses = Object.fromEntries(
    (ordRes.data ?? []).map((o) => [o.id, o.status]),
  ) as Record<string, string>;

  const { ledger, changed } = reconcileCoinLedger(base, sugRes.data ?? [], orderStatuses);

  if (changed) {
    // Admin has RLS INSERT/UPDATE on app_settings, so sync any pending suggestions/order spends/refunds cleanly.
    await supabase
      .from("app_settings")
      .upsert(
        { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(ledger) },
        { onConflict: "key" },
      );
  }

  // Fallback auto-acceptance for hosts without SUPABASE_SERVICE_ROLE_KEY:
  // if a 100% Campu Coins order is still in payment_review, promote it to accepted immediately.
  const fullCoinReviewIds = (ordRes.data ?? [])
    .filter((o) => {
      if (o.status !== "payment_review") return false;
      const usage = ledger.orderUsages[o.id];
      return Boolean(usage && usage.coinsUsed > 0 && usage.payableAmount === 0);
    })
    .map((o) => o.id);

  const autoAcceptedOrderIds: string[] = [];
  if (fullCoinReviewIds.length > 0) {
    const acceptedAt = new Date().toISOString();
    const { data: promoted } = await supabase
      .from("orders")
      .update({ status: "accepted", accepted_at: acceptedAt })
      .in("id", fullCoinReviewIds)
      .eq("status", "payment_review")
      .select("id");
    for (const row of promoted ?? []) {
      autoAcceptedOrderIds.push(row.id);
    }
  }

  const profiles = Object.fromEntries(
    (profRes.data ?? []).map((p) => [
      p.id,
      { name: p.full_name?.trim() || "Student", phone: p.phone_number ?? null },
    ]),
  );

  return { ledger, profiles, autoAcceptedOrderIds };
}

export const coinAdminQuery = {
  queryKey: ["admin-coins"],
  queryFn: loadAndSyncAdminCoins,
};

export function CoinRequests() {
  const queryClient = useQueryClient();
  const q = useQuery(coinAdminQuery);
  const reviewTopup = useServerFn(reviewCoinPurchaseRequest);
  const notifyDecision = useServerFn(notifyCoinStatusDecision);
  const flushQueue = useServerFn(flushAdminCoinNotificationQueue);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-coins-live-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggestions" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["admin-coins"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  async function handleReview(requestId: string, decision: "approved" | "rejected") {
    if (decision === "rejected" && !confirm("Reject this coin recharge request?")) return;
    setBusyId(requestId);
    try {
      await reviewTopup({ data: { requestId, decision } });
    } catch {
      // Direct admin RLS fallback if server fn route encounters transient error
      const latest = await loadAndSyncAdminCoins();
      const target = latest.ledger.requests.find((r) => r.id === requestId);
      if (!target || target.status !== "pending") {
        setBusyId(null);
        toast.error("Coin request already processed or missing.");
        return;
      }
      const errMsg = validateCoinPurchaseInput(target.coins, target.amount);
      if (decision === "approved" && errMsg) {
        setBusyId(null);
        toast.error(errMsg);
        return;
      }
      const nowIso = new Date().toISOString();
      const nextBalances = { ...latest.ledger.balances };
      const nextTransactions = [...latest.ledger.transactions];
      if (decision === "approved") {
        nextBalances[target.userId] = roundCoinValue(
          roundCoinValue(nextBalances[target.userId] ?? 0) + target.coins,
        );
        nextTransactions.unshift({
          id: `topup:${target.id}`,
          userId: target.userId,
          type: "topup_approved",
          coins: target.coins,
          amountInr: target.amount,
          note: `Purchased ${target.coins} coins (UTR ${target.utrNumber})`,
          requestId: target.id,
          utrNumber: target.utrNumber,
          createdAt: nowIso,
        });
      }
      const nextLedger: CoinLedgerV1 = {
        ...latest.ledger,
        balances: nextBalances,
        requests: latest.ledger.requests.map((r) =>
          r.id === target.id ? { ...r, status: decision, reviewedAt: nowIso } : r,
        ),
        transactions: nextTransactions.slice(0, 500),
        updatedAt: nowIso,
      };
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(nextLedger) },
          { onConflict: "key" },
        );
      if (error) {
        setBusyId(null);
        toast.error(error.message);
        return;
      }
      void notifyDecision({
        data: {
          requestId: target.id,
          userId: target.userId,
          coins: target.coins,
          decision,
        },
      }).catch(() => undefined);
    }

    void flushQueue().catch(() => undefined);
    setBusyId(null);
    toast.success(
      decision === "approved"
        ? "Coins credited to student's wallet!"
        : "Coin purchase request rejected.",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-coins"] }),
      queryClient.invalidateQueries({ queryKey: ["app_settings"] }),
    ]);
  }

  const ledger = q.data?.ledger ?? emptyCoinLedger();
  const profiles = q.data?.profiles ?? {};
  const pending = ledger.requests.filter((r) => r.status === "pending");
  const walletEntries = Object.entries(ledger.balances)
    .filter(([, bal]) => bal > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <Coins className="h-5 w-5 text-primary" />
          Pending Coin Recharges ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No pending coin payments right now.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {pending.map((r) => {
              const p = profiles[r.userId];
              const displayName = p?.name ?? r.userName;
              const phone = p?.phone ?? r.phone;
              return (
                <div
                  key={r.id}
                  className="royal-card rounded-2xl border border-primary/40 bg-card p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {displayName}
                        {phone ? ` · ${phone}` : ""}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
                        {r.coins} Coins · Pay verified:{" "}
                        <b className="text-foreground">{rupees(r.amount)}</b>
                      </p>
                      <p className="mt-1 font-mono text-sm font-bold tracking-wider text-foreground">
                        UTR: {r.utrNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 font-display text-lg font-extrabold text-primary tabular-nums">
                      +{r.coins}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={busyId === r.id}
                      onClick={() => void handleReview(r.id, "approved")}
                      className="flex-1 rounded-full bg-success text-success-foreground hover:opacity-90"
                    >
                      <Check className="mr-1.5 h-4 w-4" />
                      {busyId === r.id ? "Crediting…" : `Approve +${r.coins} Coins`}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busyId === r.id}
                      onClick={() => void handleReview(r.id, "rejected")}
                      className="flex-1 rounded-full border-destructive text-destructive"
                    >
                      <X className="mr-1.5 h-4 w-4" /> Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-2 font-display text-base font-bold">
          <Users className="h-4 w-4 text-primary" />
          Student Coin Wallets ({walletEntries.length})
        </h3>
        <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
          {walletEntries.length === 0 ? (
            <li className="px-4 py-3 text-muted-foreground">No active coin balances yet.</li>
          ) : (
            walletEntries.map(([uid, bal]) => (
              <li key={uid} className="flex items-center justify-between px-4 py-2.5">
                <span className="font-medium">
                  {profiles[uid]?.name ?? `Student #${uid.slice(0, 6)}`}
                </span>
                <span className="font-display font-bold text-primary tabular-nums">
                  {bal} Coins ({rupees(bal)})
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {ledger.transactions.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 font-display text-base font-bold">
            <History className="h-4 w-4 text-primary" />
            Recent Coin Transactions
          </h3>
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card text-xs">
            {ledger.transactions.slice(0, 20).map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {profiles[tx.userId]?.name ?? "Student"} · {tx.note}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(tx.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </p>
                </div>
                <span
                  className={
                    tx.coins > 0
                      ? "shrink-0 font-display text-sm font-extrabold text-success tabular-nums"
                      : "shrink-0 font-display text-sm font-extrabold text-foreground tabular-nums"
                  }
                >
                  {tx.coins > 0 ? `+${tx.coins}` : tx.coins}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
