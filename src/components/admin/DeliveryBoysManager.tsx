import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Banknote,
  Bike,
  Check,
  Copy,
  History,
  IndianRupee,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deliveryBoyAdminQuery,
  loadAndSyncDeliveryBoyAdmin,
} from "@/components/delivery/DeliveryBoySiren";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FEE_DEDUCTION,
  DELIVERY_BOY_STATE_KEY,
  applyPayoutDecisionToState,
  calculateDeliveryBoyEarning,
  emptyDeliveryBoyState,
  getBoyFinancialSummary,
  roundMoney,
  type DeliveryBoyProfile,
  type DeliveryBoyStateV1,
  type DeliverySalaryRule,
} from "@/lib/delivery-boy";
import {
  lookupProfileByEmailForDelivery,
  reviewDeliveryPayoutRequest,
  testDeliveryBoyTelegram,
} from "@/lib/delivery-boy.functions";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DeliveryBoysManager() {
  const queryClient = useQueryClient();
  const q = useQuery(deliveryBoyAdminQuery);
  const reviewPayout = useServerFn(reviewDeliveryPayoutRequest);
  const lookupByEmail = useServerFn(lookupProfileByEmailForDelivery);
  const testTelegramFn = useServerFn(testDeliveryBoyTelegram);

  const state = q.data?.state ?? emptyDeliveryBoyState();
  const profiles = q.data?.profiles ?? [];

  // Salary rule editor state
  const [ruleMode, setRuleMode] = useState<DeliverySalaryRule["mode"]>(state.salaryRule.mode);
  const [deductionText, setDeductionText] = useState(String(state.salaryRule.deductionAmount));
  const [fixedText, setFixedText] = useState(String(state.salaryRule.fixedAmount));
  const [savingRule, setSavingRule] = useState(false);

  // Add Delivery Boy form state
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [lookingUpEmail, setLookingUpEmail] = useState(false);
  const [boyName, setBoyName] = useState("");
  const [boyPhone, setBoyPhone] = useState("");
  const [boyTelegramChat, setBoyTelegramChat] = useState("");
  const [savingBoy, setSavingBoy] = useState(false);
  const [busyPayoutId, setBusyPayoutId] = useState<string | null>(null);
  const [editingChatBoyId, setEditingChatBoyId] = useState<string | null>(null);
  const [editingChatValue, setEditingChatValue] = useState("");
  const [testingChatBoyId, setTestingChatBoyId] = useState<string | null>(null);

  const savedRuleMode = q.data?.state.salaryRule.mode;
  const savedDeduction = q.data?.state.salaryRule.deductionAmount;
  const savedFixed = q.data?.state.salaryRule.fixedAmount;

  useEffect(() => {
    if (savedRuleMode === undefined || savedDeduction === undefined || savedFixed === undefined) return;
    setRuleMode(savedRuleMode);
    setDeductionText(String(savedDeduction));
    setFixedText(String(savedFixed));
  }, [savedRuleMode, savedDeduction, savedFixed]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-delivery-live-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "suggestions" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  async function persistState(next: DeliveryBoyStateV1) {
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(next) },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] }),
      queryClient.invalidateQueries({ queryKey: ["app_settings"] }),
    ]);
  }

  async function handleSaveRule() {
    const deduction = Number(deductionText);
    const fixed = Number(fixedText);
    if (ruleMode === "deduct_from_fee" && (!Number.isFinite(deduction) || deduction < 0)) {
      toast.error("Enter a valid non-negative deduction amount (e.g. 1).");
      return;
    }
    if (ruleMode === "fixed_per_delivery" && (!Number.isFinite(fixed) || fixed < 0)) {
      toast.error("Enter a valid non-negative fixed payout per delivery.");
      return;
    }
    setSavingRule(true);
    try {
      const latest = await loadAndSyncDeliveryBoyAdmin();
      const next: DeliveryBoyStateV1 = {
        ...latest.state,
        salaryRule: {
          mode: ruleMode,
          deductionAmount: roundMoney(
            Number.isFinite(deduction) ? deduction : DEFAULT_FEE_DEDUCTION,
          ),
          fixedAmount: roundMoney(Number.isFinite(fixed) ? fixed : 0),
        },
        updatedAt: new Date().toISOString(),
      };
      await persistState(next);
      toast.success("Delivery Boy salary rule saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save salary rule");
    } finally {
      setSavingRule(false);
    }
  }

  async function handleEmailLookup() {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    setLookingUpEmail(true);
    try {
      const res = await lookupByEmail({ data: { email: trimmed } });
      if (res.found) {
        setSelectedProfileId(res.userId);
        const prof = profiles.find((p) => p.id === res.userId);
        setBoyName(prof?.full_name?.trim() || res.fullName || trimmed.split("@")[0] || "Delivery Partner");
        setBoyPhone(prof?.phone_number ?? "");
        toast.success(`Found account: ${prof?.full_name || res.email}`);
      } else {
        toast.info(res.message);
      }
    } catch {
      toast.info("Select the user directly from the Registered User dropdown below.");
    } finally {
      setLookingUpEmail(false);
    }
  }

  async function handleAddBoy() {
    const uid = selectedProfileId.trim();
    if (!uid) {
      toast.error("Select a registered user account for the Delivery Boy.");
      return;
    }
    const chosenProfile = profiles.find((p) => p.id === uid);
    const name = boyName.trim() || chosenProfile?.full_name?.trim() || "Delivery Partner";
    const phone = boyPhone.trim() || chosenProfile?.phone_number || null;
    const telegramChatId = boyTelegramChat.trim() || null;

    setSavingBoy(true);
    try {
      const latest = await loadAndSyncDeliveryBoyAdmin();
      const nowIso = new Date().toISOString();
      const existing = latest.state.boys.find((b) => b.userId === uid);
      const updatedBoy: DeliveryBoyProfile = existing
        ? {
            ...existing,
            name,
            phone,
            telegramChatId,
            active: true,
            updatedAt: nowIso,
          }
        : {
            userId: uid,
            name,
            phone,
            telegramChatId,
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

      const next: DeliveryBoyStateV1 = {
        ...latest.state,
        boys: [updatedBoy, ...latest.state.boys.filter((b) => b.userId !== uid)],
        updatedAt: nowIso,
      };
      await persistState(next);
      setSelectedProfileId("");
      setEmailInput("");
      setBoyName("");
      setBoyPhone("");
      setBoyTelegramChat("");
      toast.success(existing ? `${name} updated as active Delivery Boy` : `${name} added as Delivery Boy`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save Delivery Boy");
    } finally {
      setSavingBoy(false);
    }
  }

  async function toggleBoyActive(boy: DeliveryBoyProfile, active: boolean) {
    try {
      const latest = await loadAndSyncDeliveryBoyAdmin();
      const nowIso = new Date().toISOString();
      const next: DeliveryBoyStateV1 = {
        ...latest.state,
        boys: latest.state.boys.map((b) =>
          b.userId === boy.userId ? { ...b, active, updatedAt: nowIso } : b,
        ),
        updatedAt: nowIso,
      };
      await persistState(next);
      toast.success(`${boy.name} marked ${active ? "active" : "paused"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
    }
  }

  async function saveBoyTelegramChat(boy: DeliveryBoyProfile) {
    try {
      const latest = await loadAndSyncDeliveryBoyAdmin();
      const nowIso = new Date().toISOString();
      const next: DeliveryBoyStateV1 = {
        ...latest.state,
        boys: latest.state.boys.map((b) =>
          b.userId === boy.userId
            ? { ...b, telegramChatId: editingChatValue.trim() || null, updatedAt: nowIso }
            : b,
        ),
        updatedAt: nowIso,
      };
      await persistState(next);
      setEditingChatBoyId(null);
      setEditingChatValue("");
      toast.success("Telegram chat ID saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save chat ID");
    }
  }

  async function handleTestTelegram(boy: DeliveryBoyProfile) {
    const chatId = boy.telegramChatId?.trim();
    if (!chatId) {
      toast.error("Set the Delivery Boy's numeric Telegram Chat ID first.");
      return;
    }
    setTestingChatBoyId(boy.userId);
    try {
      const res = await testTelegramFn({ data: { chatId, boyName: boy.name } });
      if (res.ok) {
        toast.success(`Test alert sent to ${boy.name}'s Telegram (${res.chatId ?? chatId})!`);
      } else {
        toast.error(res.error || "Could not send test Telegram alert.", { duration: 7000 });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Telegram test failed");
    } finally {
      setTestingChatBoyId(null);
    }
  }

  async function removeBoy(boy: DeliveryBoyProfile) {
    try {
      const latest = await loadAndSyncDeliveryBoyAdmin();
      const nowIso = new Date().toISOString();
      const next: DeliveryBoyStateV1 = {
        ...latest.state,
        boys: latest.state.boys.filter((b) => b.userId !== boy.userId),
        updatedAt: nowIso,
      };
      await persistState(next);
      toast.success(`${boy.name} removed from Delivery Boys`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove Delivery Boy");
    }
  }

  async function handlePayoutDecision(requestId: string, decision: "paid" | "rejected") {
    setBusyPayoutId(requestId);
    try {
      await reviewPayout({ data: { requestId, decision } });
    } catch {
      // Direct Admin RLS fallback when server function env vars are unavailable
      try {
        const latest = await loadAndSyncDeliveryBoyAdmin();
        const { next } = applyPayoutDecisionToState(latest.state, requestId, decision);
        await persistState(next);
      } catch (fallbackErr) {
        setBusyPayoutId(null);
        toast.error(
          fallbackErr instanceof Error ? fallbackErr.message : "Could not process payout request",
        );
        return;
      }
    }
    setBusyPayoutId(null);
    toast.success(
      decision === "paid"
        ? "Payout marked as paid & wallet updated!"
        : "Payout request rejected.",
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-delivery-boy"] }),
      queryClient.invalidateQueries({ queryKey: ["app_settings"] }),
    ]);
  }

  const pendingPayouts = state.payoutRequests.filter((r) => r.status === "pending");
  const pastPayouts = state.payoutRequests.filter((r) => r.status !== "pending");
  const previewRule: DeliverySalaryRule = {
    mode: ruleMode,
    deductionAmount: Math.max(0, Number(deductionText) || 0),
    fixedAmount: Math.max(0, Number(fixedText) || 0),
  };

  const availableProfiles = profiles.filter((p) => !state.boys.some((b) => b.userId === p.id));

  return (
    <div className="min-w-0 max-w-full space-y-5 pb-6">
      {/* 1. Pending Payout Requests */}
      <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold">
            <Banknote className="h-5 w-5 text-primary" />
            Delivery Boy Payout Requests ({pendingPayouts.length})
          </h3>
          {pendingPayouts.length > 0 && (
            <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-[11px] font-bold text-destructive">
              Action needed
            </span>
          )}
        </div>

        {pendingPayouts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No pending payout requests right now.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {pendingPayouts.map((req) => (
              <div
                key={req.id}
                className="rounded-2xl border-2 border-primary/40 bg-accent/25 p-3.5 shadow-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {req.boyName}
                      {req.phone ? ` · ${req.phone}` : ""}
                    </p>
                    <span
                      className={cn(
                        "mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                        req.method === "UPI"
                          ? "bg-primary/15 text-primary"
                          : "bg-warning/20 text-warning-foreground",
                      )}
                    >
                      {req.method === "UPI" ? "UPI Transfer" : "Cash on Delivery (Cash Handover)"}
                    </span>
                  </div>
                  <span className="shrink-0 font-display text-xl font-extrabold text-primary tabular-nums">
                    {rupees(req.amount)}
                  </span>
                </div>

                {req.method === "UPI" ? (
                  <div className="mt-3 rounded-xl border border-border bg-card p-2.5 text-xs">
                    <p className="text-muted-foreground">
                      Banking Name:{" "}
                      <strong className="text-foreground">{req.bankingName || "—"}</strong>
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-muted-foreground">
                        UPI ID:{" "}
                        <strong className="font-mono text-foreground">{req.upiId || "—"}</strong>
                      </p>
                      {req.upiId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                          onClick={() => {
                            void navigator.clipboard?.writeText(req.upiId ?? "");
                            toast.success("UPI ID copied");
                          }}
                        >
                          <Copy className="mr-1 h-3 w-3" /> Copy
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2.5 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                    Hand over <strong className="text-foreground">{rupees(req.amount)}</strong> in
                    cash and mark paid below.
                  </p>
                )}

                <p className="mt-2 text-[11px] text-muted-foreground">
                  Requested{" "}
                  {new Date(req.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>

                <div className="mt-3 flex gap-2">
                  <Button
                    disabled={busyPayoutId === req.id}
                    onClick={() => void handlePayoutDecision(req.id, "paid")}
                    className="h-11 flex-1 rounded-full bg-success text-success-foreground hover:opacity-90"
                  >
                    <Check className="mr-1.5 h-4 w-4" />
                    {busyPayoutId === req.id ? "Updating…" : "Mark Paid"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busyPayoutId === req.id}
                    onClick={() => void handlePayoutDecision(req.id, "rejected")}
                    className="h-11 flex-1 rounded-full border-destructive text-destructive"
                  >
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Delivery Boy Salary / Deduction Rule */}
      <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <IndianRupee className="h-5 w-5 text-primary" />
          Delivery Boy Salary Rule
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Credited automatically after each OTP-verified delivery. Default is customer delivery
          charge minus ₹1.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setRuleMode("deduct_from_fee")}
            className={cn(
              "rounded-2xl border p-3 text-left transition-colors",
              ruleMode === "deduct_from_fee"
                ? "border-primary bg-accent/50"
                : "border-border bg-background hover:bg-muted/40",
            )}
          >
            <p className="text-sm font-bold text-foreground">Delivery Charge − Deduction</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Default: ₹1 less than customer’s delivery fee
            </p>
          </button>
          <button
            type="button"
            onClick={() => setRuleMode("fixed_per_delivery")}
            className={cn(
              "rounded-2xl border p-3 text-left transition-colors",
              ruleMode === "fixed_per_delivery"
                ? "border-primary bg-accent/50"
                : "border-border bg-background hover:bg-muted/40",
            )}
          >
            <p className="text-sm font-bold text-foreground">Fixed Per Delivery</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Exact fixed ₹ amount per completed order
            </p>
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          {ruleMode === "deduct_from_fee" ? (
            <div className="min-w-0 flex-1">
              <label htmlFor="boy-deduction" className="mb-1 block text-xs font-semibold">
                Amount to deduct from delivery fee (₹)
              </label>
              <Input
                id="boy-deduction"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={deductionText}
                onChange={(e) => setDeductionText(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <label htmlFor="boy-fixed" className="mb-1 block text-xs font-semibold">
                Fixed earning per delivery (₹)
              </label>
              <Input
                id="boy-fixed"
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={fixedText}
                onChange={(e) => setFixedText(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          )}
          <Button
            type="button"
            disabled={savingRule}
            onClick={() => void handleSaveRule()}
            className="h-11 shrink-0 rounded-full bg-brand px-5 font-bold text-primary-foreground"
          >
            <Save className="mr-1.5 h-4 w-4" />
            {savingRule ? "Saving…" : "Save Rule"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[5, 8, 10, 15].map((fee) => (
            <span
              key={fee}
              className="rounded-full border border-border bg-muted/50 px-3 py-1 font-medium text-foreground tabular-nums"
            >
              Fee ₹{fee} → Boy gets{" "}
              <strong className="text-primary">
                {rupees(calculateDeliveryBoyEarning(fee, previewRule))}
              </strong>
            </span>
          ))}
        </div>
      </section>

      {/* 3. Add Delivery Boy */}
      <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <Plus className="h-5 w-5 text-primary" />
          Add Delivery Boy
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Link a registered Campu user account so they can open their Delivery Dashboard, get live
          ringing alerts &amp; complete orders with OTP.
        </p>

        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            <Input
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="Find by user email (optional)"
              type="email"
              className="h-11 min-w-0 flex-1 rounded-xl"
            />
            <Button
              type="button"
              variant="outline"
              disabled={lookingUpEmail || !emailInput.trim()}
              onClick={() => void handleEmailLookup()}
              className="h-11 shrink-0 rounded-xl px-3.5"
            >
              <Search className="mr-1.5 h-4 w-4" />
              {lookingUpEmail ? "Finding…" : "Find"}
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold">Select registered account</label>
            <Select
              value={selectedProfileId}
              onValueChange={(uid) => {
                setSelectedProfileId(uid);
                const p = profiles.find((row) => row.id === uid);
                if (p) {
                  setBoyName(p.full_name?.trim() || "Delivery Partner");
                  setBoyPhone(p.phone_number ?? "");
                }
              }}
            >
              <SelectTrigger className="h-11 w-full rounded-xl [&>span]:truncate">
                <SelectValue placeholder="Choose a registered user…" />
              </SelectTrigger>
              <SelectContent>
                {availableProfiles.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    All registered profiles are already listed
                  </SelectItem>
                ) : (
                  availableProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name?.trim() || `User #${p.id.slice(0, 6)}`}
                      {p.phone_number ? ` · ${p.phone_number}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div>
              <label htmlFor="boy-name" className="mb-1 block text-xs font-semibold">
                Rider Name
              </label>
              <Input
                id="boy-name"
                value={boyName}
                onChange={(e) => setBoyName(e.target.value)}
                placeholder="e.g. Rahul"
                className="h-11 rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="boy-phone" className="mb-1 block text-xs font-semibold">
                Phone Number
              </label>
              <Input
                id="boy-phone"
                value={boyPhone}
                onChange={(e) => setBoyPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile"
                inputMode="numeric"
                className="h-11 rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="boy-tg" className="mb-1 block text-xs font-semibold">
                Telegram Chat ID <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="boy-tg"
                value={boyTelegramChat}
                onChange={(e) => setBoyTelegramChat(e.target.value)}
                placeholder="Numeric Chat ID (e.g. 123456789)"
                className="h-11 rounded-xl"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Rider must send <code>/start</code> to the bot first.
              </p>
            </div>
          </div>

          <Button
            type="button"
            disabled={savingBoy || !selectedProfileId || selectedProfileId === "__none__"}
            onClick={() => void handleAddBoy()}
            className="h-11 w-full rounded-full bg-brand font-bold text-primary-foreground"
          >
            <UserCheck className="mr-1.5 h-4 w-4" />
            {savingBoy ? "Adding…" : "Add Delivery Boy"}
          </Button>
        </div>
      </section>

      {/* 4. Delivery Boy Roster & Balances */}
      <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold">
          <Bike className="h-5 w-5 text-primary" />
          Delivery Boys ({state.boys.length})
        </h3>
        {state.boys.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No delivery boys added yet. Add one above, then assign verified orders from the Orders
            tab.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {state.boys.map((boy) => {
              const summary = getBoyFinancialSummary(state, boy.userId);
              const isEditingChat = editingChatBoyId === boy.userId;
              return (
                <div
                  key={boy.userId}
                  className="rounded-2xl border border-border bg-background/70 p-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-bold text-foreground">
                        {boy.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {boy.phone ? `+91 ${boy.phone}` : `ID: ${boy.userId.slice(0, 8)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          boy.active
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {boy.active ? "Active" : "Paused"}
                      </span>
                      <Switch
                        checked={boy.active}
                        onCheckedChange={(checked) => void toggleBoyActive(boy, checked)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${boy.name}`}
                        onClick={() => void removeBoy(boy)}
                        className="h-8 w-8 rounded-full text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl border border-border/70 bg-card p-2">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Balance
                      </p>
                      <p className="font-display text-sm font-extrabold text-primary tabular-nums">
                        {rupees(summary.walletBalance)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-card p-2">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Earned
                      </p>
                      <p className="font-display text-sm font-extrabold text-foreground tabular-nums">
                        {rupees(summary.totalEarned)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-card p-2">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                        Deliveries
                      </p>
                      <p className="font-display text-sm font-extrabold text-foreground tabular-nums">
                        {summary.completedCount}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                    {isEditingChat ? (
                      <div className="flex w-full gap-1.5">
                        <Input
                          value={editingChatValue}
                          onChange={(e) => setEditingChatValue(e.target.value)}
                          placeholder="Telegram Chat ID"
                          className="h-8 flex-1 rounded-lg text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveBoyTelegramChat(boy)}
                          className="h-8 rounded-lg bg-brand px-2.5 text-xs text-primary-foreground"
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingChatBoyId(null)}
                          className="h-8 rounded-lg px-2 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="flex min-w-0 items-center gap-1 truncate text-muted-foreground">
                          <Send className="h-3 w-3 shrink-0" />
                          Telegram: {boy.telegramChatId ? boy.telegramChatId : "Store default"}
                        </span>
                        <div className="flex shrink-0 items-center gap-2.5">
                          {boy.telegramChatId && (
                            <button
                              type="button"
                              disabled={testingChatBoyId === boy.userId}
                              onClick={() => void handleTestTelegram(boy)}
                              className="font-bold text-success hover:underline disabled:opacity-50"
                            >
                              {testingChatBoyId === boy.userId ? "Sending…" : "Test"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingChatBoyId(boy.userId);
                              setEditingChatValue(boy.telegramChatId ?? "");
                            }}
                            className="font-bold text-primary hover:underline"
                          >
                            Edit Chat ID
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. Recent Payout History */}
      {pastPayouts.length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-4 shadow-card">
          <h3 className="flex items-center gap-2 font-display text-base font-bold">
            <History className="h-4 w-4 text-primary" />
            Payout History
          </h3>
          <ul className="mt-2 divide-y divide-border text-xs">
            {pastPayouts.slice(0, 15).map((req) => (
              <li key={req.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {req.boyName} ·{" "}
                    {req.method === "UPI" ? `UPI (${req.upiId})` : "Cash on Delivery"}
                  </p>
                  <p className="text-muted-foreground">
                    {new Date(req.reviewedAt ?? req.createdAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-sm font-extrabold tabular-nums">
                    {rupees(req.amount)}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      req.status === "paid"
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive",
                    )}
                  >
                    {req.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
