import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  ChevronDown,
  History,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  ADMIN_ACCOUNTING_KEY,
  aggregateAllDailyHistory,
  computeOrderAccounting,
  emptyAdminAccounting,
  formatIstDateLabel,
  parseAdminAccounting,
  syncAccountingWithOrders,
  toIstDateKey,
  type AccountingOrderInput,
  type AdminAccountingV1,
  type DailyProfitSummary,
} from "@/lib/admin-accounting";
import type { DeliveryAssignment } from "@/lib/delivery-boy";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

export const adminAccountingQuery = {
  queryKey: ["admin-accounting"],
  queryFn: async (): Promise<AdminAccountingV1> => {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ADMIN_ACCOUNTING_KEY)
      .maybeSingle();
    if (error) return emptyAdminAccounting();
    return parseAdminAccounting(data?.value);
  },
};

function signedRupees(n: number): string {
  const num = Number(n) || 0;
  if (num < 0) return `-${rupees(Math.abs(num))}`;
  return rupees(num);
}

type DaySummaryMetrics = Omit<DailyProfitSummary, "dateKey" | "updatedAt">;

const EMPTY_DAY_SUMMARY: DaySummaryMetrics = {
  deliveredOrders: 0,
  pendingOrders: 0,
  totalOrdersPlaced: 0,
  cancelledOrders: 0,
  displaySales: 0,
  originalCostTotal: 0,
  productProfit: 0,
  deliveryCollected: 0,
  deliveryPaidToBoy: 0,
  deliveryKept: 0,
  grandTotalSales: 0,
  netProfit: 0,
  missingCostItems: 0,
};

function DaySummaryBox({
  title,
  subtitle,
  summary,
  profitLabel,
  headerAction,
}: {
  title: string;
  subtitle: string;
  summary: DaySummaryMetrics;
  profitLabel: string;
  headerAction?: React.ReactNode;
}) {
  const hasBoyPayout = summary.deliveryPaidToBoy > 0;
  const deliveryAddedToProfit = hasBoyPayout
    ? summary.deliveryKept
    : summary.deliveryCollected;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-tight text-foreground sm:text-lg">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>

      {/* Core Figures */}
      <div className="divide-y divide-border/70 px-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-3 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Total Sales</p>
            <p className="text-xs text-muted-foreground">
              Display price · delivered orders
            </p>
          </div>
          <p className="shrink-0 font-display text-lg font-bold text-foreground tabular-nums">
            {rupees(summary.displaySales)}
          </p>
        </div>

        <div className="flex items-baseline justify-between gap-3 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Actual Cost</p>
            <p className="text-xs text-muted-foreground">
              Original / hidden shop price
            </p>
          </div>
          <p className="shrink-0 font-display text-lg font-bold text-foreground tabular-nums">
            {rupees(summary.originalCostTotal)}
          </p>
        </div>

        <div className="py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Total Orders</p>
            <p className="shrink-0 font-display text-lg font-bold text-foreground tabular-nums">
              {summary.totalOrdersPlaced}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-border/50 pt-2.5 text-xs tabular-nums">
            <div>
              <span className="text-muted-foreground">Delivered</span>
              <p className="mt-0.5 font-display text-sm font-bold text-success">
                {summary.deliveredOrders}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Pending</span>
              <p className="mt-0.5 font-display text-sm font-bold text-amber-600 dark:text-amber-400">
                {summary.pendingOrders}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Cancelled</span>
              <p className="mt-0.5 font-display text-sm font-bold text-destructive">
                {summary.cancelledOrders}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Delivery Charge Collected
            </p>
            <p className="text-xs text-muted-foreground">
              {hasBoyPayout
                ? `Boy paid ${rupees(summary.deliveryPaidToBoy)} · Kept ${signedRupees(summary.deliveryKept)}`
                : "Collected on delivered orders"}
            </p>
          </div>
          <p className="shrink-0 font-display text-lg font-bold text-foreground tabular-nums">
            {rupees(summary.deliveryCollected)}
          </p>
        </div>
      </div>

      {/* Profit Calculation Breakdown */}
      <div className="border-t border-border bg-muted/30 px-4 py-3.5 sm:px-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Profit Calculation
        </p>
        <div className="mt-2.5 space-y-2 text-sm tabular-nums">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Total Sales (Display)</span>
            <span className="font-semibold text-foreground">
              {rupees(summary.displaySales)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">− Actual Cost (Original)</span>
            <span className="font-semibold text-foreground">
              −{rupees(summary.originalCostTotal)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2">
            <span className="font-medium text-foreground">
              Saved from Sales (Margin)
            </span>
            <span
              className={cn(
                "font-bold",
                summary.productProfit >= 0 ? "text-foreground" : "text-destructive",
              )}
            >
              {signedRupees(summary.productProfit)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {hasBoyPayout
                ? "+ Delivery Charge Saved (after boy payout)"
                : "+ Delivery Charge Collected"}
            </span>
            <span
              className={cn(
                "font-semibold",
                deliveryAddedToProfit >= 0 ? "text-foreground" : "text-destructive",
              )}
            >
              {deliveryAddedToProfit >= 0
                ? `+${rupees(deliveryAddedToProfit)}`
                : signedRupees(deliveryAddedToProfit)}
            </span>
          </div>
        </div>
      </div>

      {/* Final Profit Answer */}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-foreground sm:text-base">
            {profitLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            Saved from sales + delivery charge
          </p>
        </div>
        <p
          className={cn(
            "shrink-0 font-display text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl",
            summary.netProfit >= 0 ? "text-success" : "text-destructive",
          )}
        >
          {signedRupees(summary.netProfit)}
        </p>
      </div>
    </section>
  );
}

export function AdminProfitStats({
  orders,
  products,
  assignmentsByOrder,
  accounting,
  onJumpToInventory,
}: {
  orders: AccountingOrderInput[];
  products: Array<{ id: string; name: string; stock_quantity?: number }>;
  assignmentsByOrder: Record<string, DeliveryAssignment | undefined>;
  accounting: AdminAccountingV1;
  onJumpToInventory: () => void;
}) {
  const queryClient = useQueryClient();
  const todayKey = toIstDateKey(new Date());
  const yesterdayKey = toIstDateKey(new Date(Date.now() - 86_400_000));

  const [viewMode, setViewMode] = useState<"daily" | "history">("daily");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>("");
  const [syncing, setSyncing] = useState(false);
  const lastSyncedSigRef = useRef<string>("");

  const synced = useMemo(
    () =>
      syncAccountingWithOrders({
        base: accounting,
        orders,
        assignmentsByOrder,
        products,
      }),
    [accounting, orders, assignmentsByOrder, products],
  );

  // Persist daily history & order cost snapshots automatically whenever orders or payouts change.
  useEffect(() => {
    if (!synced.changed || syncing) return;
    const sig = `${Object.keys(synced.next.orderCostSnapshots).length}:${synced.next.dailyHistory[todayKey]?.netProfit ?? 0}:${synced.next.dailyHistory[todayKey]?.totalOrdersPlaced ?? 0}:${synced.next.updatedAt}`;
    if (lastSyncedSigRef.current === sig) return;
    lastSyncedSigRef.current = sig;

    const timer = window.setTimeout(() => {
      void supabase
        .from("app_settings")
        .upsert(
          { key: ADMIN_ACCOUNTING_KEY, value: JSON.stringify(synced.next) },
          { onConflict: "key" },
        )
        .then(({ error }) => {
          if (!error) {
            void queryClient.invalidateQueries({ queryKey: ["admin-accounting"] });
          }
        });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [synced, syncing, todayKey, queryClient]);

  const effectiveAccounting = synced.next;

  async function saveSnapshot(forceRecalculateCosts = false) {
    setSyncing(true);
    try {
      const { data: latestRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", ADMIN_ACCOUNTING_KEY)
        .maybeSingle();
      const latestBase = parseAdminAccounting(latestRow?.value);
      const { next } = syncAccountingWithOrders({
        base: latestBase,
        orders,
        assignmentsByOrder,
        products,
        forceRecalculateCosts,
      });
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: ADMIN_ACCOUNTING_KEY, value: JSON.stringify(next) },
          { onConflict: "key" },
        );
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["admin-accounting"] });
      toast.success(
        forceRecalculateCosts
          ? "Costs synced from current Inventory Original Prices!"
          : "Profit & sales history saved!",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save accounting history");
    } finally {
      setSyncing(false);
    }
  }

  const todaySummary: DaySummaryMetrics =
    effectiveAccounting.dailyHistory[todayKey] ?? EMPTY_DAY_SUMMARY;

  const sortedHistoryDays = useMemo(
    () =>
      Object.values(effectiveAccounting.dailyHistory).sort((a, b) =>
        b.dateKey.localeCompare(a.dateKey),
      ),
    [effectiveAccounting.dailyHistory],
  );

  // Previous days first when opening History, falling back to today if only today exists
  const pastDays = useMemo(
    () => sortedHistoryDays.filter((d) => d.dateKey !== todayKey),
    [sortedHistoryDays, todayKey],
  );

  const activeHistoryKey = useMemo(() => {
    if (selectedHistoryDate) return selectedHistoryDate;
    if (pastDays[0]) return pastDays[0].dateKey;
    return yesterdayKey;
  }, [selectedHistoryDate, pastDays, yesterdayKey]);

  const activeHistorySummary: DaySummaryMetrics =
    effectiveAccounting.dailyHistory[activeHistoryKey] ?? EMPTY_DAY_SUMMARY;

  const allTimeSummary = useMemo(
    () => aggregateAllDailyHistory(effectiveAccounting.dailyHistory),
    [effectiveAccounting.dailyHistory],
  );

  const productIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of products) {
      if (p.name) map[p.name.trim().toLowerCase()] = p.id;
    }
    return map;
  }, [products]);

  const activeDateKey = viewMode === "daily" ? todayKey : activeHistoryKey;

  const dayOrderBreakdown = useMemo(() => {
    const delivered = orders.filter(
      (o) => o.status === "delivered" && toIstDateKey(o.created_at) === activeDateKey,
    );
    return delivered.map((o) =>
      computeOrderAccounting({
        order: o,
        productCosts: effectiveAccounting.productCosts,
        existingSnapshot: effectiveAccounting.orderCostSnapshots[o.id],
        assignment: assignmentsByOrder[o.id],
        productIdByName,
      }),
    );
  }, [
    orders,
    activeDateKey,
    effectiveAccounting.productCosts,
    effectiveAccounting.orderCostSnapshots,
    assignmentsByOrder,
    productIdByName,
  ]);

  const lowStock = useMemo(
    () =>
      products.filter(
        (p) => typeof p.stock_quantity === "number" && p.stock_quantity < 5,
      ),
    [products],
  );

  return (
    <div className="space-y-4">
      {/* Top 2-grid switch: Daily | History */}
      <div
        role="tablist"
        aria-label="Stats view"
        className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-muted/40 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "daily"}
          onClick={() => setViewMode("daily")}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
            viewMode === "daily"
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Calendar className="h-4 w-4 shrink-0" />
          <span>Daily (Today)</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "history"}
          onClick={() => setViewMode("history")}
          className={cn(
            "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors",
            viewMode === "history"
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <History className="h-4 w-4 shrink-0" />
          <span>History</span>
        </button>
      </div>

      {/* DAILY VIEW */}
      {viewMode === "daily" && (
        <>
          <DaySummaryBox
            title="Today's Report"
            subtitle={formatIstDateLabel(todayKey)}
            summary={todaySummary}
            profitLabel="Today's Total Profit"
            headerAction={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={() => void saveSnapshot(true)}
                className="h-9 shrink-0 whitespace-nowrap rounded-xl text-xs font-semibold"
              >
                <RefreshCw
                  className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")}
                />
                {syncing ? "Syncing…" : "Sync Costs"}
              </Button>
            }
          />

          {todaySummary.missingCostItems > 0 && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs">
              <p className="flex items-center gap-2 text-foreground">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <b>{todaySummary.missingCostItems}</b> delivered item(s) are missing
                  an Original Price.
                </span>
              </p>
              <button
                type="button"
                onClick={onJumpToInventory}
                className="shrink-0 whitespace-nowrap font-bold text-primary hover:underline"
              >
                Set in Inventory →
              </button>
            </div>
          )}

          {dayOrderBreakdown.length > 0 && (
            <details className="group overflow-hidden rounded-2xl border border-border bg-card">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/30">
                <span>
                  Delivered Orders Today ({dayOrderBreakdown.length})
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground">
                      <th className="px-4 py-2.5">Order</th>
                      <th className="px-3 py-2.5 text-right">Sales</th>
                      <th className="px-3 py-2.5 text-right">Cost</th>
                      <th className="px-3 py-2.5 text-right">Delivery</th>
                      <th className="px-4 py-2.5 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {dayOrderBreakdown.map((snap) => (
                      <tr key={snap.orderId} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          <span className="font-mono font-semibold">
                            #{snap.orderId.slice(0, 6)}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {new Date(snap.createdAt).toLocaleTimeString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">
                          {rupees(snap.displaySales)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">
                          {rupees(snap.originalCostTotal)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted-foreground">
                          {rupees(snap.deliveryCollected)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2.5 text-right font-bold",
                            snap.netProfit >= 0 ? "text-success" : "text-destructive",
                          )}
                        >
                          {signedRupees(snap.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {lowStock.length > 0 && (
            <div className="rounded-2xl border border-border bg-card px-4 py-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <TriangleAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  Low stock ({lowStock.length})
                </p>
                <button
                  type="button"
                  onClick={onJumpToInventory}
                  className="font-semibold text-primary hover:underline"
                >
                  Restock →
                </button>
              </div>
              <p className="mt-1.5 text-muted-foreground">
                {lowStock
                  .slice(0, 6)
                  .map((p) => `${p.name} (${p.stock_quantity ?? 0})`)
                  .join(" · ")}
                {lowStock.length > 6 ? ` · +${lowStock.length - 6} more` : ""}
              </p>
            </div>
          )}
        </>
      )}

      {/* HISTORY VIEW */}
      {viewMode === "history" && (
        <>
          {/* Date Picker + Quick Yesterday Jump */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">Select Date</p>
              <p className="text-[11px] text-muted-foreground">
                View any past day&apos;s complete sales &amp; profit report
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={activeHistoryKey === yesterdayKey ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedHistoryDate(yesterdayKey)}
                className="h-9 rounded-xl text-xs font-semibold"
              >
                Yesterday
              </Button>
              <Input
                type="date"
                aria-label="Pick history date"
                max={todayKey}
                value={activeHistoryKey}
                onChange={(e) => {
                  if (e.target.value) setSelectedHistoryDate(e.target.value);
                }}
                className="h-9 w-auto rounded-xl text-xs tabular-nums"
              />
            </div>
          </div>

          {/* Exact Same Single-Box Layout for Selected Past Date */}
          <DaySummaryBox
            title={
              activeHistoryKey === todayKey
                ? "Today's Report"
                : activeHistoryKey === yesterdayKey
                  ? "Yesterday's Report"
                  : formatIstDateLabel(activeHistoryKey)
            }
            subtitle={
              activeHistoryKey === todayKey || activeHistoryKey === yesterdayKey
                ? formatIstDateLabel(activeHistoryKey)
                : `Saved daily report (${activeHistoryKey})`
            }
            summary={activeHistorySummary}
            profitLabel="Day's Total Profit"
          />

          {/* Compact All-Time Totals Strip */}
          {sortedHistoryDays.length > 0 && (
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 text-xs tabular-nums sm:grid-cols-4 sm:px-5">
              <div>
                <p className="text-muted-foreground">All-Time Sales</p>
                <p className="mt-0.5 font-display text-base font-bold text-foreground">
                  {rupees(allTimeSummary.displaySales)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">All-Time Cost</p>
                <p className="mt-0.5 font-display text-base font-bold text-foreground">
                  {rupees(allTimeSummary.originalCostTotal)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">All-Time Delivered</p>
                <p className="mt-0.5 font-display text-base font-bold text-foreground">
                  {allTimeSummary.deliveredOrders} / {allTimeSummary.totalOrdersPlaced}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">All-Time Net Profit</p>
                <p
                  className={cn(
                    "mt-0.5 font-display text-base font-extrabold",
                    allTimeSummary.netProfit >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {signedRupees(allTimeSummary.netProfit)}
                </p>
              </div>
            </div>
          )}

          {/* Saved Daily History List */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
              <h3 className="font-display text-sm font-bold text-foreground">
                Saved Days ({sortedHistoryDays.length})
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Tap a day to view full report
              </span>
            </div>

            {sortedHistoryDays.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No saved daily history yet. Reports are saved automatically as orders come in.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-[11px] font-semibold text-muted-foreground">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-3 py-2.5 text-right">Orders (D/P/C)</th>
                      <th className="px-3 py-2.5 text-right">Sales</th>
                      <th className="px-3 py-2.5 text-right">Cost</th>
                      <th className="px-3 py-2.5 text-right">Delivery</th>
                      <th className="px-4 py-2.5 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {sortedHistoryDays.map((day) => {
                      const isSelected = activeHistoryKey === day.dateKey;
                      return (
                        <tr
                          key={day.dateKey}
                          onClick={() => setSelectedHistoryDate(day.dateKey)}
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-muted/30",
                            isSelected && "bg-accent/40",
                          )}
                        >
                          <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                            {day.dateKey === todayKey
                              ? `Today (${day.dateKey})`
                              : formatIstDateLabel(day.dateKey)}
                          </td>
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <span className="font-semibold text-success">
                              {day.deliveredOrders}
                            </span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                              {day.pendingOrders}
                            </span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="font-semibold text-destructive">
                              {day.cancelledOrders}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-foreground">
                            {rupees(day.displaySales)}
                          </td>
                          <td className="px-3 py-3 text-right text-muted-foreground">
                            {rupees(day.originalCostTotal)}
                          </td>
                          <td className="px-3 py-3 text-right text-muted-foreground">
                            {rupees(day.deliveryCollected)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right font-display font-bold",
                              day.netProfit >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {signedRupees(day.netProfit)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
