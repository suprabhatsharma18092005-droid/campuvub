import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Bike,
  Check,
  Crown,
  IndianRupee,
  Lock,
  LockOpen,
  Megaphone,
  Package,
  Plus,
  Settings2,
  Trash2,
  TriangleAlert,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { deliveryLabel, formatDeliveryDate } from "@/lib/delivery";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { AdminSettings } from "@/components/AdminSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { isSuperAdminEmail } from "@/lib/admin-access";
import { rupees, STATUS_LABELS } from "@/lib/format";
import { notifyBroadcast, updateOrderWithPush } from "@/lib/push.functions";
import { brandsQuery, categoriesQuery, productsQuery, settingsQuery, subcategoriesQuery } from "@/lib/queries";
import { type OrderReplacement } from "@/lib/replacements";
import { CatalogHierarchyManager } from "@/components/admin/CatalogHierarchyManager";
import { AdminProfitStats, adminAccountingQuery } from "@/components/admin/AdminProfitStats";
import { CoinRequests, coinAdminQuery, loadAndSyncAdminCoins } from "@/components/admin/CoinRequests";
import { DeliveryBoysManager } from "@/components/admin/DeliveryBoysManager";
import { OrderReplacementManager } from "@/components/admin/OrderReplacementManager";
import { OrderSiren } from "@/components/admin/OrderSiren";
import { VipRequests, vipAdminQuery } from "@/components/admin/VipRequests";
import {
  deliveryBoyAdminQuery,
  loadAndSyncDeliveryBoyAdmin,
} from "@/components/delivery/DeliveryBoySiren";
import {
  ADMIN_ACCOUNTING_KEY,
  emptyAdminAccounting,
  parseAdminAccounting,
  recordProductCostChange,
  roundSignedMoney,
  syncAccountingWithOrders,
  type AdminAccountingV1,
} from "@/lib/admin-accounting";
import {
  STORE_CLOSED_KEY,
  formatStoreClockTime,
  getStoreReopenTime,
  isStoreClosed,
} from "@/lib/store-status";
import { COIN_LEDGER_SETTING_KEY, applyOrderCoinRefundToLedger, type CoinOrderUsage } from "@/lib/coins";
import {
  DELIVERY_BOY_STATE_KEY,
  applyDeliveredOtpToState,
  buildAssignmentSnapshot,
  computeDeliveryOtpDigest,
  type DeliveryAssignment,
  type DeliveryBoyProfile,
} from "@/lib/delivery-boy";
import { assignOrderDeliveryBoy } from "@/lib/delivery-boy.functions";
import { useRoles, useSession } from "@/lib/session";
import { QR_BUCKET } from "@/lib/upi";
import { catalogReference, removeCatalogImage, uploadCatalogImage } from "@/lib/catalog-media";
import { cn } from "@/lib/utils";

// Unused icon imports cleanup note: keep Lucide icons used in tabs/orders
void IndianRupee;
void TriangleAlert;

const ADMIN_TABS = new Set(["dashboard", "queue", "orders", "delivery", "stock", "vip", "coins", "blast", "settings"]);

export const Route = createFileRoute("/_authenticated/admin")({
  validateSearch: z.object({ tab: z.string().optional() }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Admin Dashboard — Campu" },
      {
        name: "description",
        content: "Live order radar, payment verification and inventory control.",
      },
      { property: "og:title", content: "Admin Dashboard — Campu" },
      {
        property: "og:description",
        content: "Live order radar, payment verification and inventory.",
      },
    ],
  }),
  component: Admin,
});

type OrderRow = {
  id: string;
  student_id: string;
  cart_items: unknown;
  total: number | string;
  subtotal: number | string;
  delivery_fee: number | string;
  status: string;
  payment_method: string;
  utr_number: string | null;
  delivery_address: string | null;
  phone_number: string | null;
  delivery_otp: string | null;
  refund_status: string;
  refund_proof_url: string | null;
  created_at: string;
  accepted_at: string | null;
  cancelled_at: string | null;
  delivery_type?: string | null;
  delivery_date?: string | null;
};

type Item = { id?: string; name: string; qty: number; price: number; image_url?: string | null };

const NEXT_ACTION: Record<string, { label: string; status: string } | undefined> = {
  pending: { label: "Accept order", status: "accepted" },
  payment_review: { label: "Verify & accept", status: "accepted" },
  accepted: { label: "Out for delivery", status: "out_for_delivery" },
};

function Admin() {
  const { session } = useSession();
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { tab: searchTab } = useSearch({ from: "/_authenticated/admin" });
  const initialTab = searchTab && ADMIN_TABS.has(searchTab) ? searchTab : "dashboard";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [orderDeliveryFilter, setOrderDeliveryFilter] = useState<"all" | "quick" | "sunday_tuesday">("all");
  const updateOrder = useServerFn(updateOrderWithPush);
  const assignDeliveryBoyRemote = useServerFn(assignOrderDeliveryBoy);
  const [sound, setSound] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [togglingStore, setTogglingStore] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const isStaff = roles?.includes("admin") ?? false;

  useEffect(() => {
    if (searchTab && ADMIN_TABS.has(searchTab)) {
      setActiveTab(searchTab);
    }
  }, [searchTab]);

  const vipRequests = useQuery({
    ...vipAdminQuery,
    enabled: Boolean(isStaff),
    refetchInterval: 20_000,
  });

  const coinAdmin = useQuery({
    ...coinAdminQuery,
    enabled: Boolean(isStaff),
    refetchInterval: 6_000,
  });

  const deliveryAdmin = useQuery({
    ...deliveryBoyAdminQuery,
    enabled: Boolean(isStaff),
    refetchInterval: 8_000,
  });

  const accountingAdmin = useQuery({
    ...adminAccountingQuery,
    enabled: Boolean(isStaff),
  });

  const orders = useQuery({
    queryKey: ["admin-orders"],
    enabled: Boolean(isStaff),
    // Catch-up safety net if a realtime event is missed (sleep, network drop).
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<OrderRow[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const products = useQuery({ ...productsQuery, enabled: Boolean(isStaff) });
  const appSettings = useQuery({ ...settingsQuery, enabled: Boolean(isStaff) });

  const replacementSuggestions = useQuery({
    queryKey: ["admin-replacement-suggestions"],
    enabled: Boolean(isStaff),
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suggestions")
        .select("suggestion_text, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return {} as Record<string, OrderReplacement>;
      const map: Record<string, OrderReplacement> = {};
      for (const row of data ?? []) {
        try {
          const parsed = JSON.parse(row.suggestion_text) as {
            type?: string;
            orderId?: string;
            record?: OrderReplacement;
          };
          if (
            parsed?.type === "order_replacement_response" &&
            parsed.orderId &&
            parsed.record
          ) {
            const existing = map[parsed.orderId];
            if (
              !existing ||
              new Date(parsed.record.updatedAt).getTime() >
                new Date(existing.updatedAt).getTime()
            ) {
              map[parsed.orderId] = parsed.record;
            }
          }
        } catch {
          // Non-JSON suggestion row
        }
      }
      return map;
    },
  });

  const customers = useQuery({
    queryKey: ["admin-profiles"],
    enabled: Boolean(isStaff),
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, phone_number");
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((p) => [p.id, p.full_name ?? "Student"]),
      ) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (!isStaff) return;
    const channel = supabase
      .channel("admin-radar")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as { id: string };
        if (!seen.current.has(row.id)) {
          seen.current.add(row.id);
          toast.success("New order received!");
        }
        void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "suggestions" }, (payload) => {
        const text = (payload.new as { suggestion_text?: string } | undefined)?.suggestion_text;
        if (text?.includes('"coin_purchase_request"')) {
          toast.info("🪙 New Campu Coins request received!", {
            action: {
              label: "Review",
              onClick: () => setActiveTab("coins"),
            },
          });
        } else if (text?.includes('"delivery_boy_payout_request"')) {
          toast.info("💸 New Delivery Boy payout request received!", {
            action: {
              label: "Review",
              onClick: () => setActiveTab("delivery"),
            },
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["admin-replacement-suggestions"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-coins"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "vip_subscriptions" }, (payload) => {
        if (payload.eventType === "INSERT") {
          toast.info("👑 New VIP Pass Request received!", {
            action: {
              label: "Review",
              onClick: () => setActiveTab("vip"),
            },
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["admin-vip"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, queryClient, sound]);

  async function updateStatus(id: string, status: string) {
    setBusyOrderId(id);
    let refundedCoins = 0;
    try {
      await updateOrder({ data: { orderId: id, status } });
      if (status === "cancelled") {
        const latestCoins = await loadAndSyncAdminCoins();
        const { next, refundedCoins: refAmt } = applyOrderCoinRefundToLedger(latestCoins.ledger, id);
        if (refAmt > 0) {
          await supabase
            .from("app_settings")
            .upsert(
              { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(next) },
              { onConflict: "key" },
            );
          refundedCoins = refAmt;
        }
        const latestDelivery = await loadAndSyncDeliveryBoyAdmin();
        if (latestDelivery.state.assignments.some((a) => a.orderId === id && a.status !== "cancelled")) {
          const nextDelivery = {
            ...latestDelivery.state,
            assignments: latestDelivery.state.assignments.map((a) =>
              a.orderId === id ? { ...a, status: "cancelled" as const } : a,
            ),
            updatedAt: new Date().toISOString(),
          };
          await supabase
            .from("app_settings")
            .upsert(
              { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(nextDelivery) },
              { onConflict: "key" },
            );
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update order");
      return;
    } finally {
      setBusyOrderId(null);
    }
    toast.success(
      refundedCoins > 0
        ? `Order cancelled & ${refundedCoins} coins refunded`
        : `Order marked ${STATUS_LABELS[status]}`,
    );
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-coins"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  /** Assigns a payment-verified/accepted order to a Delivery Boy and dispatches Push + Telegram alerts. */
  async function assignOrderToBoy(order: OrderRow, boyId: string) {
    if (order.status === "payment_review" || order.status === "pending") {
      toast.error("Verify & accept payment first before assigning to a Delivery Boy.");
      return;
    }
    setBusyOrderId(order.id);
    let remoteResult: { telegramSent?: boolean; telegramReason?: string } | null = null;
    let usedFallback = false;
    try {
      remoteResult = await assignDeliveryBoyRemote({ data: { orderId: order.id, boyId } });
    } catch {
      usedFallback = true;
      // Direct Admin RLS fallback when server env vars are absent on preview host
      try {
        const latest = await loadAndSyncDeliveryBoyAdmin();
        const boy = latest.state.boys.find((b) => b.userId === boyId && b.active);
        if (!boy) throw new Error("Selected Delivery Boy is not active.");
        const otpDigest = await computeDeliveryOtpDigest(order.id, order.delivery_otp ?? "");
        const existing = latest.state.assignments.find((a) => a.orderId === order.id);
        const assignment = buildAssignmentSnapshot({
          order,
          boy,
          customerName: (customers.data ?? {})[order.student_id] ?? "Student",
          otpDigest,
          salaryRule: latest.state.salaryRule,
          coinUsage: coinUsages[order.id] ?? null,
          existingId: existing?.id,
        });
        if (existing?.status === "out_for_delivery" && order.status === "out_for_delivery") {
          assignment.status = "out_for_delivery";
          assignment.outForDeliveryAt = existing.outForDeliveryAt ?? new Date().toISOString();
        }
        const nextState = {
          ...latest.state,
          assignments: [
            assignment,
            ...latest.state.assignments.filter((a) => a.orderId !== order.id),
          ].slice(0, 200),
          updatedAt: new Date().toISOString(),
        };
        const { error } = await supabase
          .from("app_settings")
          .upsert(
            { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(nextState) },
            { onConflict: "key" },
          );
        if (error) throw new Error(error.message);
      } catch (fallbackErr) {
        setBusyOrderId(null);
        toast.error(
          fallbackErr instanceof Error ? fallbackErr.message : "Could not assign Delivery Boy",
        );
        return;
      }
    }
    setBusyOrderId(null);
    const chosenBoy = (deliveryAdmin.data?.state.boys ?? []).find((b) => b.userId === boyId);
    const boyName = chosenBoy?.name ?? "Delivery Boy";
    if (!usedFallback && remoteResult?.telegramSent) {
      toast.success(`Assigned to ${boyName} — Push & Telegram sent!`);
    } else if (!usedFallback && chosenBoy?.telegramChatId && remoteResult?.telegramReason) {
      toast.warning(
        `Assigned to ${boyName} (In-app siren active; Telegram: ${remoteResult.telegramReason})`,
        { duration: 7000 },
      );
    } else if (usedFallback && chosenBoy?.telegramChatId) {
      toast.warning(
        `Assigned to ${boyName} (Saved via fallback — republish host to dispatch Telegram alerts)`,
        { duration: 6000 },
      );
    } else {
      toast.success(`Assigned to ${boyName} — in-app alert sent!`);
    }
    void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  /** Marks delivered after OTP match and deducts the sold quantities from stock. */
  async function deliverWithOtp(order: OrderRow, typed: string) {
    if (!order.delivery_otp || typed.trim() !== order.delivery_otp) {
      toast.error("Delivery code does not match. Ask the student to read it again.");
      return false;
    }
    try {
      await updateOrder({ data: { orderId: order.id, status: "delivered", otp: typed.trim() } });
      // Credit assigned Delivery Boy earning idempotently if Admin completed the OTP handover
      const latestDelivery = await loadAndSyncDeliveryBoyAdmin();
      const { next, creditedAmount } = applyDeliveredOtpToState(latestDelivery.state, order.id);
      if (next !== latestDelivery.state) {
        await supabase
          .from("app_settings")
          .upsert(
            { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(next) },
            { onConflict: "key" },
          );
        if (creditedAmount > 0) {
          toast.info(`Delivery Boy credited ${rupees(creditedAmount)}`);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not deliver order");
      return false;
    }
    toast.success("Delivered — stock updated");
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    return true;
  }

  async function toggleStock(id: string, inStock: boolean) {
    const { error } = await supabase.from("products").update({ in_stock: inStock }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function toggleStoreShutter(nextClosed: boolean) {
    setTogglingStore(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: STORE_CLOSED_KEY, value: String(nextClosed) }, { onConflict: "key" });
    setTogglingStore(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const reopenTime = formatStoreClockTime(getStoreReopenTime(appSettings.data));
    toast.success(
      nextClosed
        ? `Store CLOSED! Shutter lock is live (opens at ${reopenTime} IST).`
        : "Store is now OPEN for orders!",
    );
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  if (rolesLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!isStaff) {
    return (
      <AppShell>
        <div className="p-10 text-center">
          <h1 className="font-display text-xl font-bold">Staff only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This dashboard is only available to the Campu administrator. Signed in as {session?.user.email}.
          </p>
        </div>
      </AppShell>
    );
  }

  const all = orders.data ?? [];
  const names = customers.data ?? {};
  const isOrderQuick = (o: OrderRow) => (o.delivery_type ?? "quick") === "quick";
  const isOrderSpecial = (o: OrderRow) => o.delivery_type === "sunday_tuesday";
  const modeFilteredOrders =
    orderDeliveryFilter === "all"
      ? all
      : all.filter((o) => (orderDeliveryFilter === "sunday_tuesday" ? isOrderSpecial(o) : isOrderQuick(o)));
  const coinUsages = coinAdmin.data?.ledger.orderUsages ?? {};
  const isFullCoinOrder = (o: OrderRow) => {
    const usage = coinUsages[o.id];
    return Boolean(usage && usage.coinsUsed > 0 && usage.payableAmount === 0);
  };
  const queue = all.filter((o) => o.status === "payment_review" && !isFullCoinOrder(o));
  const pending = modeFilteredOrders.filter(
    (o) =>
      o.status === "pending" ||
      (o.status === "payment_review" && !isFullCoinOrder(o)),
  );
  const active = modeFilteredOrders.filter(
    (o) =>
      o.status === "accepted" ||
      o.status === "out_for_delivery" ||
      (o.status === "payment_review" && isFullCoinOrder(o)),
  );
  const completed = modeFilteredOrders.filter((o) => o.status === "delivered");
  const cancelled = modeFilteredOrders.filter((o) => o.status === "cancelled");
  const pendingVipCount = (vipRequests.data ?? []).filter((r) => r.status === "pending").length;
  const pendingCoinCount = (coinAdmin.data?.ledger.requests ?? []).filter((r) => r.status === "pending").length;
  const deliveryBoys = deliveryAdmin.data?.state.boys ?? [];
  const activeDeliveryBoys = deliveryBoys.filter((b) => b.active);
  const assignmentsByOrder = Object.fromEntries(
    (deliveryAdmin.data?.state.assignments ?? []).map((a) => [a.orderId, a]),
  ) as Record<string, DeliveryAssignment>;
  const pendingPayoutCount = (deliveryAdmin.data?.state.payoutRequests ?? []).filter(
    (r) => r.status === "pending",
  ).length;

  function onTabChange(nextTab: string) {
    setActiveTab(nextTab);
    void navigate({
      to: "/admin",
      search: nextTab === "dashboard" ? {} : { tab: nextTab },
      replace: true,
    });
  }

  const storeClosed = isStoreClosed(appSettings.data);

  return (
    <AppShell>
      <div className="min-w-0 max-w-full overflow-x-clip px-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="font-display text-2xl font-bold">Admin</h1>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-accent px-2.5 py-0.5 text-[11px] font-bold text-primary">
              <Crown className="h-3 w-3" />{" "}
              {isSuperAdminEmail(session?.user.email) ? "Super Admin" : "Admin"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={togglingStore}
              onClick={() => void toggleStoreShutter(!storeClosed)}
              className={cn(
                "shrink-0 rounded-full text-xs font-bold",
                storeClosed
                  ? "bg-destructive text-destructive-foreground hover:opacity-90"
                  : "bg-success text-success-foreground hover:opacity-90",
              )}
            >
              {storeClosed ? (
                <>
                  <Lock className="mr-1 h-3.5 w-3.5" />
                  {togglingStore ? "Opening…" : "Store Closed"}
                </>
              ) : (
                <>
                  <LockOpen className="mr-1 h-3.5 w-3.5" />
                  {togglingStore ? "Closing…" : "Store Open"}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSound((s) => !s)}
              className="shrink-0 rounded-full text-xs"
            >
              {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              {sound ? "Alerts on" : "Alerts off"}
            </Button>
          </div>
        </div>

        <OrderSiren
          orders={all}
          coinRequests={coinAdmin.data?.ledger.requests ?? []}
          payoutRequests={deliveryAdmin.data?.state.payoutRequests ?? []}
          enabled={sound}
        />

        <Tabs value={activeTab} onValueChange={onTabChange} className="mt-4 min-w-0 max-w-full">
          <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-card p-1.5 shadow-card md:flex-wrap">
            <TabsTrigger value="dashboard">Stats</TabsTrigger>
            <TabsTrigger value="queue">
              Payments {queue.length > 0 && `(${queue.length})`}
            </TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="delivery" className="relative gap-1.5">
              <Bike className="h-3.5 w-3.5" />
              <span>Delivery</span>
              {pendingPayoutCount > 0 && (
                <span className="relative inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary-foreground" />
                  {pendingPayoutCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="stock">Inventory</TabsTrigger>
            <TabsTrigger value="vip" className="relative gap-1.5">
              <span>VIP</span>
              {pendingVipCount > 0 && (
                <span className="relative inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary-foreground" />
                  {pendingVipCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="coins" className="relative gap-1.5">
              <span>Coins</span>
              {pendingCoinCount > 0 && (
                <span className="relative inline-flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-extrabold text-primary-foreground">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary-foreground" />
                  {pendingCoinCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="blast">Blast</TabsTrigger>
            <TabsTrigger value="settings"><Settings2 className="mr-1 h-4 w-4" /> Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4">
            <AdminProfitStats
              orders={all}
              products={products.data ?? []}
              assignmentsByOrder={assignmentsByOrder}
              accounting={accountingAdmin.data ?? emptyAdminAccounting()}
              onJumpToInventory={() => onTabChange("stock")}
            />
          </TabsContent>

          <TabsContent value="queue" className="mt-4 space-y-3">
            {queue.length === 0 && (
              <Empty icon={Bell} text="No payments waiting for verification." />
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {queue.map((o) => {
              const coinUsage = coinUsages[o.id];
              const isFullCoins = coinUsage && coinUsage.payableAmount === 0;
              return (
              <div
                key={o.id}
                className="rounded-3xl border-2 border-warning/50 bg-warning/10 p-4 shadow-card"
              >
                <OrderCard order={o} name={names[o.student_id]} coinUsage={coinUsage} />
                <div className="mt-3 rounded-2xl bg-card p-3">
                  {isFullCoins ? (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                        Paid 100% with Campu Coins
                      </p>
                      <p className="font-display text-base font-extrabold text-foreground">
                        {coinUsage.coinsUsed} Coins deducted · ₹0 UPI needed
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        UTR / Reference {coinUsage ? `(UPI Payable: ${rupees(coinUsage.payableAmount)})` : ""}
                      </p>
                      <p className="font-display text-xl font-extrabold tracking-widest">
                        {o.utr_number}
                      </p>
                    </>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    disabled={busyOrderId === o.id}
                    onClick={() => void updateStatus(o.id, "accepted")}
                    className="h-11 flex-1 rounded-full bg-success text-success-foreground hover:opacity-90"
                  >
                    <Check className="mr-1.5 h-4 w-4" />{" "}
                    {busyOrderId === o.id ? "Updating…" : "Verify & Accept"}
                  </Button>
                  <Button
                    disabled={busyOrderId === o.id}
                    onClick={() => void updateStatus(o.id, "cancelled")}
                    variant="outline"
                    className="h-11 flex-1 rounded-full border-destructive text-destructive"
                  >
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
                <p className="mt-2 text-center text-[11px] text-muted-foreground">
                  Verify payment first — then assign to a Delivery Boy in Orders → Active.
                </p>
              </div>
              );
            })}
            </div>
          </TabsContent>

      <TabsContent value="orders" className="mt-4 space-y-3">
            <div className="flex items-center gap-1.5 rounded-2xl border border-border/70 bg-card p-1.5 shadow-card">
              {(
                [
                  ["all", `All (${all.length})`],
                  ["quick", `Quick (${all.filter(isOrderQuick).length})`],
                  ["sunday_tuesday", `Sun/Tue Special (${all.filter(isOrderSpecial).length})`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrderDeliveryFilter(value)}
                  className={cn(
                    "flex-1 rounded-xl px-2.5 py-2 text-xs font-bold transition-colors",
                    orderDeliveryFilter === value
                      ? "bg-brand text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Tabs defaultValue="active">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
                <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
                <TabsTrigger value="done">Done ({completed.length})</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled ({cancelled.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="mt-4 space-y-3">
                {pending.length === 0 && <Empty icon={Package} text="No pending orders right now." />}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pending.map((o) => (
                  <ActiveOrder
                    key={o.id}
                    order={o}
                    name={names[o.student_id]}
                    coinUsage={coinUsages[o.id]}
                    products={products.data ?? []}
                    settings={appSettings.data}
                    fallbackReplacement={replacementSuggestions.data?.[o.id]}
                    activeBoys={activeDeliveryBoys}
                    assignment={assignmentsByOrder[o.id]}
                    onAssignBoy={assignOrderToBoy}
                    onManageBoys={() => onTabChange("delivery")}
                    updating={busyOrderId === o.id}
                    onAdvance={updateStatus}
                    onDeliver={deliverWithOtp}
                  />
                ))}
                </div>
              </TabsContent>

              <TabsContent value="active" className="mt-4 space-y-3">
                {active.length === 0 && <Empty icon={Package} text="No active orders right now." />}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {active.map((o) => (
                  <ActiveOrder
                    key={o.id}
                    order={o}
                    name={names[o.student_id]}
                    coinUsage={coinUsages[o.id]}
                    products={products.data ?? []}
                    settings={appSettings.data}
                    fallbackReplacement={replacementSuggestions.data?.[o.id]}
                    activeBoys={activeDeliveryBoys}
                    assignment={assignmentsByOrder[o.id]}
                    onAssignBoy={assignOrderToBoy}
                    onManageBoys={() => onTabChange("delivery")}
                    updating={busyOrderId === o.id}
                    onAdvance={updateStatus}
                    onDeliver={deliverWithOtp}
                  />
                ))}
                </div>
              </TabsContent>

              <TabsContent value="done" className="mt-4 space-y-3">
                {completed.length === 0 && <Empty icon={Check} text="No completed orders yet." />}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {completed.map((o) => (
                  <div key={o.id} className="rounded-3xl border border-border bg-card p-4 shadow-card">
                    <OrderCard order={o} name={names[o.student_id]} coinUsage={coinUsages[o.id]} />
                  </div>
                ))}
                </div>
              </TabsContent>

              <TabsContent value="cancelled" className="mt-4 space-y-3">
                {cancelled.length === 0 && <Empty icon={X} text="No cancelled orders." />}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {cancelled.map((o) => (
                  <CancelledOrder key={o.id} order={o} name={names[o.student_id]} coinUsage={coinUsages[o.id]} />
                ))}
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="delivery" className="mt-4 min-w-0 max-w-full">
            <DeliveryBoysManager />
          </TabsContent>

          <TabsContent value="stock" className="mt-4 min-w-0 max-w-full">
            <Inventory
              products={products.data ?? []}
              orders={all}
              assignmentsByOrder={assignmentsByOrder}
              accounting={accountingAdmin.data ?? emptyAdminAccounting()}
              onToggle={toggleStock}
            />
          </TabsContent>

          <TabsContent value="vip" className="mt-4">
            <VipRequests />
          </TabsContent>

          <TabsContent value="coins" className="mt-4">
            <CoinRequests />
          </TabsContent>

          <TabsContent value="blast" className="mt-4">
            <BroadcastForm />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <AdminSettings />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function OrderCard({
  order,
  name,
  coinUsage,
}: {
  order: OrderRow;
  name: string | undefined;
  coinUsage?: CoinOrderUsage | undefined;
}) {
  const items = (order.cart_items as Item[]) ?? [];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            #{order.id.slice(0, 8)} ·{" "}
            <span className={cn(order.payment_method === "UPI" ? "text-primary" : "text-warning-foreground")}>
              {coinUsage?.payableAmount === 0 ? "Campu Coins" : order.payment_method}
            </span>
          </p>
          <p className="mt-1">
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", order.delivery_type === "sunday_tuesday" ? "bg-warning/20 text-warning-foreground" : "bg-primary/15 text-primary")}>
              {deliveryLabel(order.delivery_type, order.delivery_date)}
              {order.delivery_type === "sunday_tuesday" && order.delivery_date ? ` · ${formatDeliveryDate(order.delivery_date)}` : ""}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-medium">{name ?? "Student"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {order.delivery_address} · +91 {order.phone_number}
          </p>
        </div>
        <div className="text-right">
          <span className="font-display font-bold">{rupees(order.total)}</span>
          {coinUsage && coinUsage.coinsUsed > 0 && (
            <p className="text-[11px] font-semibold text-primary tabular-nums">
              Coins -{coinUsage.coinsUsed} · Due {rupees(coinUsage.payableAmount)}
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center gap-2.5">
            {i.image_url ? (
              <CatalogImage source={i.image_url} alt={i.name} className="h-10 w-10 rounded-xl border border-border object-cover" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-xs">🛍️</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
            <span className="text-right text-xs text-muted-foreground">
              {rupees(Number(i.price))} × {i.qty}
              <span className="block text-sm font-semibold text-foreground">{rupees(Number(i.price) * i.qty)}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        {STATUS_LABELS[order.status]} · {new Date(order.created_at).toLocaleString()}
      </p>
    </div>
  );
}

function ActiveOrder({
  order,
  name,
  coinUsage,
  products,
  settings,
  fallbackReplacement,
  activeBoys,
  assignment,
  onAssignBoy,
  onManageBoys,
  updating,
  onAdvance,
  onDeliver,
}: {
  order: OrderRow;
  name: string | undefined;
  coinUsage?: CoinOrderUsage | undefined;
  products: ProductRow[];
  settings: Record<string, string> | undefined;
  fallbackReplacement?: OrderReplacement | null | undefined;
  activeBoys: DeliveryBoyProfile[];
  assignment?: DeliveryAssignment | undefined;
  onAssignBoy: (order: OrderRow, boyId: string) => Promise<void>;
  onManageBoys: () => void;
  updating: boolean;
  onAdvance: (id: string, status: string) => Promise<void>;
  onDeliver: (order: OrderRow, otp: string) => Promise<boolean>;
}) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedBoyId, setSelectedBoyId] = useState(assignment?.boyId ?? "");
  const isFullCoins = Boolean(
    coinUsage && coinUsage.coinsUsed > 0 && coinUsage.payableAmount === 0,
  );
  const effectiveStatus =
    isFullCoins && order.status === "payment_review" ? "accepted" : order.status;
  const next = NEXT_ACTION[effectiveStatus];
  const isVerifiedForDelivery =
    effectiveStatus === "accepted" || effectiveStatus === "out_for_delivery";

  useEffect(() => {
    if (assignment?.boyId) setSelectedBoyId(assignment.boyId);
  }, [assignment?.boyId]);

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <OrderCard
        order={
          effectiveStatus !== order.status
            ? { ...order, status: effectiveStatus }
            : order
        }
        name={name}
        coinUsage={coinUsage}
      />

      {effectiveStatus === "payment_review" && order.utr_number && coinUsage?.payableAmount !== 0 && (
        <div className="mt-3 rounded-2xl bg-muted/50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Submitted UTR
          </p>
          <p className="font-mono text-sm font-extrabold tracking-wider">{order.utr_number}</p>
        </div>
      )}

      {!isVerifiedForDelivery && (
        <p className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          {effectiveStatus === "payment_review"
            ? "Verify payment first before assigning this order to a Delivery Boy."
            : "Accept this order first to assign a Delivery Boy."}
        </p>
      )}

      {isVerifiedForDelivery && (
        <div className="mt-3 rounded-2xl border border-primary/25 bg-accent/25 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
              <Bike className="h-3.5 w-3.5" />
              Delivery Boy
            </p>
            {assignment && (
              <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold text-success">
                {assignment.boyName} · {assignment.status.replace(/_/g, " ")}
              </span>
            )}
          </div>

          {activeBoys.length === 0 ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>No active delivery boys yet.</span>
              <button
                type="button"
                onClick={onManageBoys}
                className="shrink-0 font-bold text-primary hover:underline"
              >
                Add boy →
              </button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <Select value={selectedBoyId} onValueChange={setSelectedBoyId}>
                <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl bg-card text-xs [&>span]:truncate">
                  <SelectValue placeholder="Choose Delivery Boy…" />
                </SelectTrigger>
                <SelectContent>
                  {activeBoys.map((boy) => (
                    <SelectItem key={boy.userId} value={boy.userId}>
                      {boy.name}
                      {boy.phone ? ` · ${boy.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={!selectedBoyId || updating || busy}
                onClick={() => void onAssignBoy(order, selectedBoyId)}
                className="h-10 shrink-0 rounded-full bg-brand px-3.5 text-xs font-bold text-primary-foreground"
              >
                {assignment ? "Reassign" : "Assign"}
              </Button>
            </div>
          )}
        </div>
      )}

      <OrderReplacementManager
        order={order}
        products={products}
        settings={settings}
        fallbackResponse={fallbackReplacement}
      />

      {order.status === "out_for_delivery" && (
      <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Delivery code from student
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="4-digit code"
            className="h-11 flex-1 rounded-xl text-center font-display text-lg tracking-[0.3em]"
          />
          <Button
            disabled={otp.length !== 4 || busy || updating}
            onClick={async () => {
              setBusy(true);
              const ok = await onDeliver(order, otp);
              setBusy(false);
              if (ok) setOtp("");
            }}
            className="h-11 rounded-full bg-success text-success-foreground hover:opacity-90"
          >
            {busy ? "Verifying…" : "Mark delivered"}
          </Button>
        </div>
      </div>
      )}

      <div className="mt-3 flex gap-2">
        {next && (
          <Button
            disabled={updating || busy}
            onClick={() => void onAdvance(order.id, next.status)}
            className="h-10 flex-1 rounded-full bg-brand text-primary-foreground hover:opacity-95"
          >
            {updating ? "Updating…" : next.label}
          </Button>
        )}
        <Button
          disabled={updating || busy}
          onClick={() => void onAdvance(order.id, "cancelled")}
          variant="ghost"
          className="h-10 rounded-full text-destructive"
        >
          {effectiveStatus === "payment_review" ? "Reject" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

function CancelledOrder({
  order,
  name,
  coinUsage,
}: {
  order: OrderRow;
  name: string | undefined;
  coinUsage?: CoinOrderUsage | undefined;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const isUpi = order.payment_method === "UPI";
  const payableUpi = coinUsage ? coinUsage.payableAmount : Number(order.total);
  const wasAccepted =
    Boolean(order.accepted_at) ||
    order.refund_status === "pending" ||
    order.refund_status === "refunded";
  const needsRefund = isUpi && wasAccepted && payableUpi > 0;
  const refunded = order.refund_status === "refunded";

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image of the refund confirmation.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Refund screenshot must be smaller than 5 MB.");
      return;
    }
    setBusy(true);
    const path = `refunds/${order.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "")}`;
    const { error: upErr } = await supabase.storage.from(QR_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (upErr) {
      setBusy(false);
      toast.error(upErr.message);
      return;
    }
    const { error } = await supabase
      .from("orders")
      .update({
        refund_status: "refunded",
        refund_proof_url: path,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Refund marked as processed");
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <OrderCard order={order} name={name} coinUsage={coinUsage} />
      {coinUsage && coinUsage.coinsUsed > 0 && (
        <p className="mt-3 rounded-2xl border border-primary/30 bg-accent px-3 py-2 text-xs font-semibold text-primary">
          {coinUsage.coinsUsed} Campu Coins automatically refunded to student's wallet.
        </p>
      )}
      {isUpi && !needsRefund && payableUpi > 0 && (
        <p className="mt-3 rounded-2xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          UPI payment was rejected before acceptance — no refund required.
        </p>
      )}
      {needsRefund && (
        <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-3">
          {refunded ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <Check className="h-4 w-4" /> Refund processed
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Order was accepted then cancelled. Refund {rupees(payableUpi)} by UPI, then upload the payment screenshot.
              </p>
              <label className="mt-2 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-primary-foreground">
                <Upload className="h-4 w-4" />
                {busy ? "Uploading…" : "Process refund"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  in_stock: boolean;
  image_url?: string | null;
  image_path?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  brand_id?: string | null;
  stock_quantity: number;
  delivery_types?: string[] | null;
};

const NONE = "none";

function Inventory({
  products,
  orders,
  assignmentsByOrder,
  accounting,
  onToggle,
}: {
  products: ProductRow[];
  orders: OrderRow[];
  assignmentsByOrder: Record<string, DeliveryAssignment>;
  accounting: AdminAccountingV1;
  onToggle: (id: string, inStock: boolean) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery);
  const allSubcategories = useQuery(subcategoriesQuery).data ?? [];
  const allBrands = useQuery(brandsQuery).data ?? [];
  const [section, setSection] = useState<"products" | "categories">("products");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category_id: "",
    subcategory_id: "",
    brand_id: "",
    originalPrice: "",
    price: "",
    stock: "10",
  });
  const subcategoryOptions = allSubcategories.filter((s) => s.category_id === form.category_id);
  const brandOptions = allBrands.filter((b) => b.subcategory_id === form.subcategory_id);
  const [deliveryTypes, setDeliveryTypes] = useState<string[]>(["quick"]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function closeEditor() {
    setAdding(false);
    setEditing(null);
    setPhoto(null);
  }

  function openAdd() {
    setEditing(null);
    setPhoto(null);
    setForm({
      name: "",
      description: "",
      category_id: categories.data?.[0]?.id ?? "",
      subcategory_id: "",
      brand_id: "",
      originalPrice: "",
      price: "",
      stock: "10",
    });
    setDeliveryTypes(["quick"]);
    setAdding(true);
  }

  function toggleInlineEdit(product: ProductRow) {
    if (editing?.id === product.id) {
      closeEditor();
      return;
    }
    setAdding(false);
    setEditing(product);
    setPhoto(null);
    const savedCost = accounting.productCosts[product.id]?.originalPrice;
    setForm({
      name: product.name,
      description: product.description ?? "",
      category_id: product.category_id ?? "",
      subcategory_id: product.subcategory_id ?? "",
      brand_id: product.brand_id ?? "",
      originalPrice: savedCost !== undefined ? String(savedCost) : "",
      price: String(product.price),
      stock: String(product.stock_quantity),
    });
    setDeliveryTypes(product.delivery_types?.length ? product.delivery_types : ["quick"]);
  }

  async function persistProductCost(productId: string, originalPriceVal: number | null) {
    const { data: latestRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ADMIN_ACCOUNTING_KEY)
      .maybeSingle();
    const latest = parseAdminAccounting(latestRow?.value);

    // 1. Lock historical delivered order snapshots at the PREVIOUS cost BEFORE recording
    //    the new original price so past sales at the older price point never show a loss.
    const { next: lockedBeforeChange } = syncAccountingWithOrders({
      base: latest,
      orders,
      assignmentsByOrder,
      products,
      forceRecalculateCosts: false,
    });

    // 2. Append the new original price to timestamped cost history (effective from now onward).
    const nextState = recordProductCostChange(
      lockedBeforeChange,
      productId,
      originalPriceVal,
      new Date().toISOString(),
    );

    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: ADMIN_ACCOUNTING_KEY, value: JSON.stringify(nextState) },
        { onConflict: "key" },
      );
    if (error) throw error;
    void queryClient.invalidateQueries({ queryKey: ["admin-accounting"] });
  }

  async function saveProduct() {
    const price = Number(form.price);
    const stock = Number(form.stock);
    const hasOriginalInput = form.originalPrice.trim().length > 0;
    const originalPrice = hasOriginalInput ? Number(form.originalPrice) : null;
    if (
      !form.name.trim() ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isInteger(stock) ||
      stock < 0 ||
      (originalPrice !== null && (!Number.isFinite(originalPrice) || originalPrice < 0))
    ) {
      toast.error(
        "Enter a product name, valid Display & Original price, and whole-number stock quantity.",
      );
      return;
    }
    if (deliveryTypes.length === 0) {
      toast.error("Choose at least one delivery option.");
      return;
    }
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      if (photo) uploadedPath = await uploadCatalogImage(photo, "products");
      const values = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        brand_id: form.brand_id || null,
        price,
        stock_quantity: stock,
        in_stock: stock > 0,
        delivery_types: deliveryTypes,
        ...(uploadedPath ? { image_path: uploadedPath, image_url: catalogReference(uploadedPath) } : {}),
      };
      let savedProductId: string | null = editing?.id ?? null;
      if (editing) {
        const { error } = await supabase.from("products").update(values).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("products")
          .insert(values)
          .select("id")
          .single();
        if (error) throw error;
        savedProductId = inserted?.id ?? null;
      }
      if (savedProductId) {
        await persistProductCost(savedProductId, originalPrice);
      }
      if (uploadedPath && editing?.image_path) await removeCatalogImage(editing.image_path).catch(() => undefined);
      toast.success(editing ? "Product updated" : "Product added");
      closeEditor();
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      if (uploadedPath) await removeCatalogImage(uploadedPath).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const product = products.find((item) => item.id === id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (product?.image_path) await removeCatalogImage(product.image_path).catch(() => undefined);
    if (editing?.id === id) closeEditor();
    toast.success("Product removed");
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  function renderProductEditor() {
    return (
      <div className="w-full min-w-0 max-w-full space-y-2.5 overflow-hidden rounded-2xl border border-primary/25 bg-background/80 p-3.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate font-display text-base font-bold">
            {editing ? `Edit: ${editing.name}` : "Add product"}
          </h3>
          <Button type="button" size="sm" variant="ghost" onClick={closeEditor} className="h-8 shrink-0 rounded-full px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <label className="block text-xs font-medium" htmlFor="product-name">Product Name</label>
        <Input
          id="product-name"
          value={form.name}
          onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
          className="h-11 w-full min-w-0 rounded-xl bg-card"
        />
        <label className="block text-xs font-medium" htmlFor="product-description">Description</label>
        <Textarea
          id="product-description"
          value={form.description}
          onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
          className="min-h-20 w-full min-w-0 rounded-xl bg-card"
        />
        <fieldset className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-3">
          <legend className="px-1 text-xs font-medium">Delivery option (choose at least one)</legend>
          {([["quick", "Quick Delivery"], ["sunday_tuesday", "Sunday/Tuesday Delivery"]] as const).map(([value, label]) => (
            <label key={value} className="flex min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{label}</span>
              <Switch
                className="shrink-0"
                checked={deliveryTypes.includes(value)}
                onCheckedChange={(on) =>
                  setDeliveryTypes((cur) => (on ? Array.from(new Set([...cur, value])) : cur.filter((v) => v !== value)))
                }
              />
            </label>
          ))}
        </fieldset>
        <label className="block text-xs font-medium">Category</label>
        {(categories.data ?? []).length === 0 ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
            <span className="min-w-0">Add a category first</span>
            <Button type="button" size="sm" variant="outline" className="shrink-0 rounded-full" onClick={() => setSection("categories")}>
              Add category
            </Button>
          </div>
        ) : (
          <>
            <Select value={form.category_id} onValueChange={(category_id) => setForm((current) => ({ ...current, category_id, subcategory_id: "", brand_id: "" }))}>
              <SelectTrigger className="h-11 w-full min-w-0 rounded-xl bg-card [&>span]:truncate" aria-label="Category">
                <SelectValue placeholder="Choose category" />
              </SelectTrigger>
              <SelectContent>{(categories.data ?? []).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium">Subcategory <span className="text-muted-foreground">(optional)</span></label>
                <Select
                  value={form.subcategory_id || NONE}
                  disabled={subcategoryOptions.length === 0}
                  onValueChange={(value) => setForm((current) => ({ ...current, subcategory_id: value === NONE ? "" : value, brand_id: "" }))}
                >
                  <SelectTrigger className="h-11 w-full min-w-0 rounded-xl bg-card [&>span]:truncate" aria-label="Subcategory">
                    <SelectValue placeholder={subcategoryOptions.length ? "None" : "No subcategories"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {subcategoryOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_active ? "" : " (hidden)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-medium">Brand <span className="text-muted-foreground">(optional)</span></label>
                <Select
                  value={form.brand_id || NONE}
                  disabled={brandOptions.length === 0}
                  onValueChange={(value) => setForm((current) => ({ ...current, brand_id: value === NONE ? "" : value }))}
                >
                  <SelectTrigger className="h-11 w-full min-w-0 rounded-xl bg-card [&>span]:truncate" aria-label="Brand">
                    <SelectValue placeholder={brandOptions.length ? "None" : "No brands"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {brandOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.is_active ? "" : " (hidden)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" htmlFor="product-original-price">
              Original Price (Shop Cost ₹)
            </label>
            <Input
              id="product-original-price"
              value={form.originalPrice}
              onChange={(e) => setForm((current) => ({ ...current, originalPrice: e.target.value }))}
              placeholder="Cost from shop"
              inputMode="decimal"
              className="h-11 w-full min-w-0 rounded-xl bg-card"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" htmlFor="product-price">
              Display Price (₹)
            </label>
            <Input
              id="product-price"
              value={form.price}
              onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))}
              placeholder="Selling price"
              inputMode="decimal"
              className="h-11 w-full min-w-0 rounded-xl bg-card"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium" htmlFor="product-stock">Stock Quantity</label>
            <Input
              id="product-stock"
              value={form.stock}
              onChange={(e) => setForm((current) => ({ ...current, stock: e.target.value }))}
              inputMode="numeric"
              className="h-11 w-full min-w-0 rounded-xl bg-card"
            />
          </div>
        </div>
        {form.originalPrice.trim() !== "" && form.price.trim() !== "" && Number.isFinite(Number(form.price)) && Number.isFinite(Number(form.originalPrice)) && (
          <p className="rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-muted-foreground tabular-nums">
            Profit per unit:{" "}
            <strong
              className={
                roundSignedMoney(Number(form.price) - Number(form.originalPrice)) >= 0
                  ? "text-success"
                  : "text-destructive"
              }
            >
              {roundSignedMoney(Number(form.price) - Number(form.originalPrice)) >= 0 ? "+" : "-"}
              {rupees(Math.abs(roundSignedMoney(Number(form.price) - Number(form.originalPrice))))}
            </strong>
          </p>
        )}
        <label className="flex w-full min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border border-input bg-card px-3 py-3 text-sm font-medium">
          <Upload className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {photo?.name ?? (editing?.image_path || editing?.image_url ? "Replace product photo" : "Upload product photo")}
          </span>
          <input type="file" accept="image/*" className="sr-only" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
        </label>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            disabled={saving}
            onClick={() => void saveProduct()}
            className="h-11 min-w-0 flex-1 rounded-full bg-brand text-primary-foreground"
          >
            {saving ? "Saving…" : editing ? "Update product" : "Save product"}
          </Button>
          <Button variant="ghost" className="h-11 shrink-0 rounded-full" onClick={closeEditor}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border/70 bg-card p-1.5 shadow-card">
        <button
          type="button"
          onClick={() => setSection("products")}
          className={cn(
            "min-w-0 truncate rounded-xl px-3 py-2 text-xs font-bold transition-colors",
            section === "products"
              ? "bg-brand text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Products ({products.length})
        </button>
        <button
          type="button"
          onClick={() => setSection("categories")}
          className={cn(
            "min-w-0 truncate rounded-xl px-3 py-2 text-xs font-bold transition-colors",
            section === "categories"
              ? "bg-brand text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Categories ({categories.data?.length ?? 0})
        </button>
      </div>

      {section === "categories" ? (
        <CatalogHierarchyManager products={products} />
      ) : (
        <>
          {adding ? (
            <div className="w-full min-w-0 overflow-hidden rounded-3xl border border-border bg-card p-3 shadow-card">
              {renderProductEditor()}
            </div>
          ) : (
            <Button
              onClick={openAdd}
              className="h-11 w-full rounded-full bg-brand text-primary-foreground"
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add product
            </Button>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          {products.map((p) => {
            const isEditingThis = editing?.id === p.id;
            const origPrice = accounting.productCosts[p.id]?.originalPrice;
            const unitProfit =
              origPrice !== undefined ? roundSignedMoney(Number(p.price) - origPrice) : null;
            return (
              <div
                key={p.id}
                className={cn(
                  "w-full min-w-0 overflow-hidden rounded-3xl border bg-card p-3 shadow-card transition-colors",
                  isEditingThis ? "border-primary/50 md:col-span-2" : "border-border",
                )}
              >
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  {p.image_path || p.image_url ? (
                    <CatalogImage source={p.image_path ? catalogReference(p.image_path) : p.image_url} alt={p.name} className="h-11 w-11 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-muted">🛍️</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      Display: <strong className="text-foreground">{rupees(p.price)}</strong>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      variant={isEditingThis ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleInlineEdit(p)}
                      className={cn("h-8 shrink-0 rounded-full px-2.5 text-xs sm:px-3", isEditingThis && "bg-brand text-primary-foreground")}
                    >
                      {isEditingThis ? "Close" : "Edit"}
                    </Button>
                    <Switch className="shrink-0" checked={p.in_stock} onCheckedChange={(v) => void onToggle(p.id, v)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove(p.id)}
                      aria-label={`Delete ${p.name}`}
                      className="h-8 w-8 shrink-0 rounded-full text-destructive sm:h-9 sm:w-9"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5 rounded-2xl border border-border/70 bg-muted/35 px-2.5 py-2 text-[11px] tabular-nums">
                  <div className="min-w-0">
                    <span className="block text-[10px] text-muted-foreground">Original Cost</span>
                    <strong className="truncate text-foreground">
                      {origPrice !== undefined ? rupees(origPrice) : "Not set"}
                    </strong>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-[10px] text-muted-foreground">Profit/unit</span>
                    {unitProfit === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <strong className={unitProfit >= 0 ? "text-success" : "text-destructive"}>
                        {unitProfit >= 0 ? "+" : "-"}
                        {rupees(Math.abs(unitProfit))}
                      </strong>
                    )}
                  </div>
                  <div className="min-w-0 text-right">
                    <span className="block text-[10px] text-muted-foreground">Stock</span>
                    <strong className={(p.stock_quantity ?? 0) < 5 ? "text-warning-foreground" : "text-foreground"}>
                      {p.stock_quantity} left
                    </strong>
                  </div>
                </div>

                {isEditingThis && <div className="mt-3 min-w-0 overflow-hidden border-t border-border/70 pt-3">{renderProductEditor()}</div>}
              </div>
            );
          })}
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Bell; text: string }) {
  return (
    <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Icon className="h-6 w-6" />
      {text}
    </div>
  );
}

function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const sendBroadcastPush = useServerFn(notifyBroadcast);

  async function send() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const result = await sendBroadcastPush({ data: { title: title.trim(), body: body.trim() } });
      setTitle("");
      setBody("");
      toast.success(result.sent > 0 ? `Announcement saved; push sent to ${result.sent} device(s)` : "Announcement saved; no device push was sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send announcement");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Megaphone className="h-5 w-5 text-primary" /> Broadcast center
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Announce flash sales and offers. Students see it instantly in the app.
      </p>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        placeholder="Title — e.g. Flat 20% off snacks"
        className="mt-3 h-11 rounded-xl"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={300}
        placeholder="Message body"
        className="mt-2 min-h-24 rounded-xl"
      />
      <Button
        onClick={send}
        disabled={busy || !title.trim() || !body.trim()}
        className="mt-3 h-11 w-full rounded-full bg-brand text-primary-foreground hover:opacity-95"
      >
        Send to all
      </Button>
    </div>
  );
}
