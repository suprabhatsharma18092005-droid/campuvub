import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bike,
  CheckCircle2,
  Clock3,
  History,
  IndianRupee,
  MapPin,
  Package,
  Phone,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import {
  setDeliverySirenEnabled,
  useDeliverySirenEnabled,
} from "@/components/delivery/DeliveryBoySiren";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  computeDeliveryOtpDigest,
  projectOrderForDeliveryBoy,
  roundMoney,
  useDeliveryBoyState,
  validatePayoutRequestInput,
  type DeliveryAssignment,
  type DeliveryPayoutMethod,
} from "@/lib/delivery-boy";
import {
  advanceDeliveryBoyOrderStatus,
  submitDeliveryPayoutRequest,
  verifyDeliveryBoyOtp,
} from "@/lib/delivery-boy.functions";
import { deliveryLabel, formatDeliveryDate } from "@/lib/delivery";
import { rupees } from "@/lib/format";
import { useRoles, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/delivery")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Delivery Partner Dashboard — Campu" },
      {
        name: "description",
        content: "Assigned campus deliveries, OTP completion, earnings wallet, and payouts.",
      },
      { property: "og:title", content: "Delivery Partner Dashboard — Campu" },
      {
        property: "og:description",
        content: "Assigned campus deliveries, OTP completion, earnings wallet, and payouts.",
      },
    ],
  }),
  component: DeliveryBoyDashboard,
});

function DeliveryBoyDashboard() {
  const { session } = useSession();
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const queryClient = useQueryClient();
  const delivery = useDeliveryBoyState();
  const sirenOn = useDeliverySirenEnabled();

  const advanceRemote = useServerFn(advanceDeliveryBoyOrderStatus);
  const verifyOtpRemote = useServerFn(verifyDeliveryBoyOtp);
  const submitPayoutRemote = useServerFn(submitDeliveryPayoutRequest);

  const [otpByOrder, setOtpByOrder] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  // Payout form state
  const [payoutMethod, setPayoutMethod] = useState<DeliveryPayoutMethod>("UPI");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [upiId, setUpiId] = useState("");
  const [bankingName, setBankingName] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);

  const isAdmin = roles?.includes("admin") ?? false;
  const uid = session?.user.id;

  if (delivery.loading || rolesLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="h-44 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!delivery.isActiveBoy && !isAdmin) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-primary">
            <Bike className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold">Delivery Partner Access Only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account ({session?.user.email}) is not registered as an active Delivery Boy yet.
            Ask the Campu Admin to add you from Admin → Delivery.
          </p>
          <Button asChild className="mt-5 h-11 rounded-full bg-brand px-6 text-primary-foreground">
            <Link to="/">Back to Store</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const activeDeliveries = delivery.assignments.filter(
    (a) => a.status === "assigned" || a.status === "out_for_delivery",
  );
  const completedDeliveries = delivery.assignments.filter((a) => a.status === "delivered");
  const { summary } = delivery;
  const salaryRule = delivery.state.salaryRule;
  const ruleText =
    salaryRule.mode === "fixed_per_delivery"
      ? `${rupees(salaryRule.fixedAmount)} fixed per OTP-verified delivery`
      : `Customer delivery charge − ${rupees(salaryRule.deductionAmount)} per OTP-verified delivery`;

  async function handleMarkOutForDelivery(assignment: DeliveryAssignment) {
    if (!uid) return;
    setBusyOrderId(assignment.orderId);
    const updatedAt = new Date().toISOString();
    let persisted = false;
    try {
      const res = await advanceRemote({
        data: { orderId: assignment.orderId, status: "out_for_delivery" },
      });
      persisted = Boolean(res?.persistedRemotely);
    } catch {
      persisted = false;
    }

    if (!persisted) {
      const { error } = await supabase.from("suggestions").insert({
        user_id: uid,
        user_name: delivery.boyProfile?.name ?? "Delivery Partner",
        suggestion_text: JSON.stringify({
          type: "delivery_boy_status",
          orderId: assignment.orderId,
          boyId: uid,
          status: "out_for_delivery",
          updatedAt,
        }),
      });
      if (error) {
        setBusyOrderId(null);
        toast.error(error.message);
        return;
      }
    }

    setBusyOrderId(null);
    toast.success("Marked Out for Delivery!");
    await delivery.refetch();
  }

  async function handleVerifyOtp(assignment: DeliveryAssignment) {
    if (!uid) return;
    const typed = (otpByOrder[assignment.orderId] ?? "").trim();
    if (!/^\d{4}$/.test(typed)) {
      toast.error("Enter the customer's 4-digit delivery OTP.");
      return;
    }

    setBusyOrderId(assignment.orderId);
    const typedDigest = await computeDeliveryOtpDigest(assignment.orderId, typed);
    if (!assignment.otpDigest || typedDigest.toLowerCase() !== assignment.otpDigest.toLowerCase()) {
      setBusyOrderId(null);
      toast.error("Incorrect delivery OTP. Ask the customer to check their order screen.");
      return;
    }

    const deliveredAt = new Date().toISOString();
    let persisted = false;
    let creditedAmount = assignment.earningAmount;

    try {
      const res = await verifyOtpRemote({ data: { orderId: assignment.orderId, otp: typed } });
      persisted = Boolean(res?.persistedRemotely);
      if (typeof res?.creditedAmount === "number" && res.creditedAmount > 0) {
        creditedAmount = res.creditedAmount;
      }
    } catch (err) {
      // If server explicitly rejected OTP, stop; otherwise mirror via suggestions for preview host.
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("incorrect") || msg.toLowerCase().includes("cancelled")) {
        setBusyOrderId(null);
        toast.error(msg);
        return;
      }
      persisted = false;
    }

    if (!persisted) {
      const { error } = await supabase.from("suggestions").insert({
        user_id: uid,
        user_name: delivery.boyProfile?.name ?? "Delivery Partner",
        suggestion_text: JSON.stringify({
          type: "delivery_boy_delivered",
          orderId: assignment.orderId,
          boyId: uid,
          otpDigest: typedDigest,
          deliveredAt,
        }),
      });
      if (error) {
        setBusyOrderId(null);
        toast.error(error.message);
        return;
      }
    }

    setOtpByOrder((prev) => ({ ...prev, [assignment.orderId]: "" }));
    setBusyOrderId(null);
    toast.success(
      creditedAmount > 0
        ? `Delivered! ${rupees(creditedAmount)} added to your earnings.`
        : "Order marked delivered!",
    );
    await delivery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  async function handleSubmitPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !delivery.boyProfile) {
      toast.error("Only registered active Delivery Boys can request payouts.");
      return;
    }

    const parsedAmount = roundMoney(Number(payoutAmount));
    const validationErr = validatePayoutRequestInput({
      method: payoutMethod,
      amount: parsedAmount,
      withdrawableBalance: summary.withdrawableBalance,
      upiId,
      bankingName,
    });
    if (validationErr) {
      toast.error(validationErr);
      return;
    }

    setSubmittingPayout(true);
    const requestId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    let persisted = false;

    try {
      const res = await submitPayoutRemote({
        data: {
          requestId,
          amount: parsedAmount,
          method: payoutMethod,
          upiId: payoutMethod === "UPI" ? upiId.trim() : null,
          bankingName: payoutMethod === "UPI" ? bankingName.trim() : null,
        },
      });
      persisted = Boolean(res?.persistedRemotely);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("exceeds") || msg.toLowerCase().includes("valid upi")) {
        setSubmittingPayout(false);
        toast.error(msg);
        return;
      }
      persisted = false;
    }

    // Always mirror in suggestions when not persisted remotely so Admin sees it immediately via RLS
    if (!persisted) {
      const { error } = await supabase.from("suggestions").insert({
        user_id: uid,
        user_name: delivery.boyProfile.name,
        suggestion_text: JSON.stringify({
          type: "delivery_boy_payout_request",
          request: {
            id: requestId,
            boyId: uid,
            boyName: delivery.boyProfile.name,
            phone: delivery.boyProfile.phone,
            amount: parsedAmount,
            method: payoutMethod,
            upiId: payoutMethod === "UPI" ? upiId.trim() : null,
            bankingName: payoutMethod === "UPI" ? bankingName.trim() : null,
            status: "pending",
            createdAt,
          },
        }),
      });
      if (error) {
        setSubmittingPayout(false);
        toast.error(error.message);
        return;
      }
    }

    setSubmittingPayout(false);
    setPayoutAmount("");
    toast.success(
      payoutMethod === "UPI"
        ? `UPI payout request for ${rupees(parsedAmount)} sent to Admin!`
        : `Cash payout request for ${rupees(parsedAmount)} sent to Admin!`,
    );
    await delivery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
  }

  return (
    <AppShell>
      <div className="min-w-0 max-w-full overflow-x-clip px-4 pt-5 pb-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand text-primary-foreground shadow-card">
              <Bike className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-display text-xl font-extrabold sm:text-2xl">
                Delivery Partner
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {delivery.boyProfile?.name ?? "Admin Preview"} · {ruleText}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDeliverySirenEnabled(!sirenOn)}
            className="h-9 shrink-0 rounded-full text-xs"
          >
            {sirenOn ? <Volume2 className="mr-1.5 h-3.5 w-3.5" /> : <VolumeX className="mr-1.5 h-3.5 w-3.5" />}
            {sirenOn ? "Alerts on" : "Alerts off"}
          </Button>
        </div>

        {!delivery.isActiveBoy && isAdmin && (
          <div className="mt-3 rounded-2xl border border-primary/30 bg-accent/40 p-3 text-xs text-foreground">
            Previewing Delivery Partner portal as Admin. Add yourself in{" "}
            <Link to="/admin" search={{ tab: "delivery" }} className="font-bold text-primary underline">
              Admin → Delivery
            </Link>{" "}
            to assign test orders to your account.
          </div>
        )}

        {/* Earnings KPI Strip */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className="rounded-3xl border border-primary/35 bg-brand p-3.5 text-primary-foreground shadow-card">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/85">
              <Wallet className="h-3.5 w-3.5" /> Available
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">
              {rupees(summary.withdrawableBalance)}
            </p>
            {summary.pendingPayoutTotal > 0 && (
              <p className="mt-0.5 text-[11px] text-primary-foreground/85 tabular-nums">
                {rupees(summary.pendingPayoutTotal)} pending payout
              </p>
            )}
          </div>
          <div className="rounded-3xl border border-border bg-card p-3.5 shadow-card">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <IndianRupee className="h-3.5 w-3.5" /> Total Earned
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-foreground tabular-nums">
              {rupees(summary.totalEarned)}
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-3.5 shadow-card">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Banknote className="h-3.5 w-3.5" /> Paid Out
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-foreground tabular-nums">
              {rupees(summary.totalPaidOut)}
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-card p-3.5 shadow-card">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" /> Completed
            </p>
            <p className="mt-1 font-display text-2xl font-extrabold text-foreground tabular-nums">
              {summary.completedCount}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="active" className="mt-4">
          <TabsList className="grid w-full grid-cols-3 rounded-2xl border border-border/70 bg-card p-1 shadow-card">
            <TabsTrigger value="active" className="rounded-xl text-xs font-bold">
              Active ({activeDeliveries.length})
            </TabsTrigger>
            <TabsTrigger value="completed" className="rounded-xl text-xs font-bold">
              Done ({completedDeliveries.length})
            </TabsTrigger>
            <TabsTrigger value="payout" className="rounded-xl text-xs font-bold">
              Payout &amp; Wallet
            </TabsTrigger>
          </TabsList>

          {/* Active Deliveries */}
          <TabsContent value="active" className="mt-4 space-y-3">
            {activeDeliveries.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card py-12 text-center shadow-card">
                <Package className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 font-display text-base font-bold">No active deliveries</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Verified orders assigned to you by Admin will appear &amp; ring here immediately.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {activeDeliveries.map((assignment) => {
                  const view = projectOrderForDeliveryBoy(assignment);
                  const otp = otpByOrder[assignment.orderId] ?? "";
                  const busy = busyOrderId === assignment.orderId;

                  return (
                    <div
                      key={assignment.id}
                      className="rounded-3xl border border-border bg-card p-4 shadow-card"
                    >
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-display text-sm font-extrabold">
                              #{view.shortCode}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                                assignment.deliveryType === "sunday_tuesday"
                                  ? "bg-warning/20 text-warning-foreground"
                                  : "bg-primary/15 text-primary",
                              )}
                            >
                              {deliveryLabel(assignment.deliveryType, assignment.deliveryDate)}
                              {assignment.deliveryType === "sunday_tuesday" &&
                              assignment.deliveryDate
                                ? ` · ${formatDeliveryDate(assignment.deliveryDate)}`
                                : ""}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Assigned{" "}
                            {new Date(assignment.assignedAt).toLocaleTimeString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold",
                            assignment.status === "out_for_delivery"
                              ? "bg-brand text-primary-foreground"
                              : "bg-warning/20 text-warning-foreground",
                          )}
                        >
                          {assignment.status === "out_for_delivery"
                            ? "Out for Delivery"
                            : "Ready for Pickup"}
                        </span>
                      </div>

                      {/* Delivery Address */}
                      <div className="mt-3 rounded-2xl border border-border/80 bg-muted/40 p-3">
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                              Delivery Address
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-foreground">
                              {view.deliveryAddress}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {view.customerName}
                            </p>
                          </div>
                          {view.phoneNumber && (
                            <a
                              href={`tel:+91${view.phoneNumber.replace(/\D/g, "")}`}
                              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-bold text-primary"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              Call
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Products List: Image, Name, Price */}
                      <ul className="mt-3 space-y-2">
                        {view.items.map((item, idx) => (
                          <li
                            key={`${item.id ?? item.name}-${idx}`}
                            className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-background/60 p-2"
                          >
                            {item.image_url ? (
                              <CatalogImage
                                source={item.image_url}
                                alt={item.name}
                                className="h-12 w-12 shrink-0 rounded-xl border border-border object-cover"
                              />
                            ) : (
                              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-muted text-sm">
                                🛍️
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {item.name}
                              </p>
                              <p className="text-xs text-muted-foreground tabular-nums">
                                Qty: {item.qty}
                              </p>
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                              <p className="text-sm font-bold text-foreground">
                                {rupees(item.price)}
                              </p>
                              {item.qty > 1 && (
                                <p className="text-[11px] text-muted-foreground">
                                  × {item.qty}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>

                      {/* Payment Box — STRICT PRIVACY:
                          UPI / Prepaid: NO total price & NO delivery fee shown.
                          COD: ONLY total price to collect, NO delivery fee shown. */}
                      {view.showTotalPrice && view.collectTotal !== null ? (
                        <div className="mt-3 flex items-center justify-between rounded-2xl border-2 border-warning/50 bg-warning/15 px-3.5 py-2.5">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-warning-foreground">
                              Cash on Delivery
                            </p>
                            <p className="text-xs text-muted-foreground">Collect total cash</p>
                          </div>
                          <span className="font-display text-2xl font-extrabold text-foreground tabular-nums">
                            {rupees(view.collectTotal)}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center justify-between rounded-2xl border border-success/35 bg-success/10 px-3.5 py-2.5">
                          <div>
                            <p className="text-xs font-bold text-success">{view.paymentLabel}</p>
                            <p className="text-[11px] text-muted-foreground">
                              Payment already verified — do not collect cash
                            </p>
                          </div>
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                        </div>
                      )}

                      {/* Status Advance Button */}
                      {assignment.status === "assigned" && (
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleMarkOutForDelivery(assignment)}
                          className="mt-3 h-11 w-full rounded-full bg-brand font-bold text-primary-foreground"
                        >
                          <Bike className="mr-1.5 h-4 w-4" />
                          {busy ? "Updating…" : "Mark Out for Delivery"}
                        </Button>
                      )}

                      {/* 4-digit OTP Verification */}
                      <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                            Customer Delivery OTP
                          </p>
                          <span className="text-[11px] font-bold text-primary tabular-nums">
                            Earn +{rupees(assignment.earningAmount)}
                          </span>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <Input
                            value={otp}
                            onChange={(e) =>
                              setOtpByOrder((prev) => ({
                                ...prev,
                                [assignment.orderId]: e.target.value.replace(/\D/g, "").slice(0, 4),
                              }))
                            }
                            inputMode="numeric"
                            placeholder="4-digit OTP"
                            className="h-11 flex-1 rounded-xl bg-card text-center font-display text-lg tracking-[0.3em]"
                          />
                          <Button
                            type="button"
                            disabled={otp.length !== 4 || busy}
                            onClick={() => void handleVerifyOtp(assignment)}
                            className="h-11 rounded-full bg-success px-4 font-bold text-success-foreground hover:opacity-90"
                          >
                            {busy ? "Verifying…" : "Deliver"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Completed Deliveries */}
          <TabsContent value="completed" className="mt-4 space-y-3">
            {completedDeliveries.length === 0 ? (
              <div className="rounded-3xl border border-border bg-card py-12 text-center shadow-card">
                <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 font-display text-base font-bold">No completed deliveries yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Completed OTP-verified deliveries and their earnings will appear here.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {completedDeliveries.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-bold">
                        #{a.orderId.slice(0, 8).toUpperCase()} · {a.deliveryAddress}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.items.length} item{a.items.length === 1 ? "" : "s"} ·{" "}
                        {new Date(a.deliveredAt ?? a.assignedAt).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-display text-base font-extrabold text-success tabular-nums">
                        +{rupees(a.earningAmount)}
                      </p>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">
                        OTP Verified
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Payout & Wallet */}
          <TabsContent value="payout" className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-12 md:items-start">
              {/* Request Payout Form */}
              <form
                onSubmit={handleSubmitPayout}
                className="rounded-3xl border border-border bg-card p-4 shadow-card md:col-span-6"
              >
                <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                  <Banknote className="h-5 w-5 text-primary" />
                  Request Payout
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Available to withdraw:{" "}
                  <strong className="text-primary tabular-nums">
                    {rupees(summary.withdrawableBalance)}
                  </strong>
                </p>

                {/* Method Selector */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutMethod("UPI")}
                    className={cn(
                      "min-h-11 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                      payoutMethod === "UPI"
                        ? "border-primary bg-accent/60"
                        : "border-border bg-background hover:bg-muted/40",
                    )}
                  >
                    <p className="text-sm font-bold text-foreground">UPI Transfer</p>
                    <p className="text-[11px] text-muted-foreground">UPI ID &amp; Banking Name</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutMethod("COD")}
                    className={cn(
                      "min-h-11 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                      payoutMethod === "COD"
                        ? "border-primary bg-accent/60"
                        : "border-border bg-background hover:bg-muted/40",
                    )}
                  >
                    <p className="text-sm font-bold text-foreground">Cash on Delivery</p>
                    <p className="text-[11px] text-muted-foreground">Direct Cash Handover</p>
                  </button>
                </div>

                {/* Amount */}
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <label htmlFor="payout-amt" className="text-xs font-semibold">
                      Payout Amount (₹)
                    </label>
                    {summary.withdrawableBalance > 0 && (
                      <button
                        type="button"
                        onClick={() => setPayoutAmount(String(summary.withdrawableBalance))}
                        className="text-xs font-bold text-primary hover:underline"
                      >
                        Use Full ({rupees(summary.withdrawableBalance)})
                      </button>
                    )}
                  </div>
                  <Input
                    id="payout-amt"
                    type="number"
                    min="1"
                    step="0.5"
                    inputMode="decimal"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="Enter amount in ₹"
                    className="h-11 rounded-xl"
                  />
                </div>

                {/* Conditional UPI fields */}
                {payoutMethod === "UPI" && (
                  <div className="mt-3 space-y-2.5 rounded-2xl border border-border/80 bg-muted/30 p-3">
                    <div>
                      <label htmlFor="payout-upi" className="mb-1 block text-xs font-semibold">
                        UPI Address (UPI ID)
                      </label>
                      <Input
                        id="payout-upi"
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        placeholder="e.g. yourname@okaxis"
                        className="h-11 rounded-xl bg-card"
                      />
                    </div>
                    <div>
                      <label htmlFor="payout-bank" className="mb-1 block text-xs font-semibold">
                        Banking Name (Account Holder Name)
                      </label>
                      <Input
                        id="payout-bank"
                        value={bankingName}
                        onChange={(e) => setBankingName(e.target.value)}
                        placeholder="Name registered with bank/UPI"
                        className="h-11 rounded-xl bg-card"
                      />
                    </div>
                  </div>
                )}

                {payoutMethod === "COD" && (
                  <p className="mt-3 rounded-2xl border border-border/80 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
                    Admin will be notified right away to hand over your payout in cash.
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={submittingPayout || summary.withdrawableBalance <= 0}
                  className="mt-4 h-12 w-full rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-float"
                >
                  {submittingPayout
                    ? "Sending Request…"
                    : payoutMethod === "UPI"
                      ? "Request UPI Payout"
                      : "Request Cash Payout"}
                </Button>
              </form>

              {/* Payout Requests & Ledger */}
              <div className="space-y-4 md:col-span-6">
                <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
                  <h3 className="flex items-center gap-2 font-display text-base font-bold">
                    <Clock3 className="h-4 w-4 text-primary" />
                    My Payout Requests
                  </h3>
                  {delivery.payoutRequests.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No payout requests submitted yet.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border text-xs">
                      {delivery.payoutRequests.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">
                              {r.method === "UPI"
                                ? `UPI · ${r.upiId} (${r.bankingName})`
                                : "Cash on Delivery (Cash)"}
                            </p>
                            <p className="text-muted-foreground">
                              {new Date(r.createdAt).toLocaleString("en-IN", {
                                timeZone: "Asia/Kolkata",
                              })}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-display text-sm font-extrabold tabular-nums">
                              {rupees(r.amount)}
                            </p>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                r.status === "paid"
                                  ? "bg-success/15 text-success"
                                  : r.status === "rejected"
                                    ? "bg-destructive/15 text-destructive"
                                    : "bg-warning/20 text-warning-foreground",
                              )}
                            >
                              {r.status}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
                  <h3 className="flex items-center gap-2 font-display text-base font-bold">
                    <History className="h-4 w-4 text-primary" />
                    Salary &amp; Payout Ledger
                  </h3>
                  {delivery.transactions.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Complete your first OTP-verified delivery to earn salary.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border text-xs">
                      {delivery.transactions.slice(0, 25).map((tx) => {
                        const positive = tx.amount > 0;
                        return (
                          <li key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                                  positive
                                    ? "bg-success/15 text-success"
                                    : "bg-accent text-primary",
                                )}
                              >
                                {positive ? (
                                  <ArrowDownLeft className="h-3.5 w-3.5" />
                                ) : (
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                )}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">{tx.note}</p>
                                <p className="text-muted-foreground">
                                  {new Date(tx.createdAt).toLocaleString("en-IN", {
                                    timeZone: "Asia/Kolkata",
                                  })}
                                </p>
                              </div>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 font-display text-sm font-extrabold tabular-nums",
                                positive ? "text-success" : "text-foreground",
                              )}
                            >
                              {positive ? `+${rupees(tx.amount)}` : `-${rupees(Math.abs(tx.amount))}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
