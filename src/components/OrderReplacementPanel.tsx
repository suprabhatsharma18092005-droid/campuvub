import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Copy,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CatalogImage } from "@/components/CatalogImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/format";
import { productsQuery, settingsQuery } from "@/lib/queries";
import {
  getReplacementItemTotal,
  replacementSettingKey,
  writeLocalReplacement,
  type OrderReplacement,
  type ReplacementItem,
} from "@/lib/replacements";
import { submitReplacementChoice } from "@/lib/replacements.functions";
import { useSession } from "@/lib/session";
import { fallbackQrUrl, useSignedAsset, useUpiQrImage } from "@/lib/upi";
import { cn } from "@/lib/utils";

export function OrderReplacementPanel({
  order,
  replacement,
  onUpdated,
}: {
  order: {
    id: string;
    status: string;
    payment_method: string;
    total: number | string;
    delivery_fee: number | string;
  };
  replacement: OrderReplacement;
  onUpdated: () => void;
}) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const products = useQuery(productsQuery);
  const settings = useQuery(settingsQuery);
  const qr = useUpiQrImage(settings.data?.["upi_qr_path"]);
  const partialProof = useSignedAsset(replacement.partialRefundProofPath);
  const submitChoice = useServerFn(submitReplacementChoice);

  const [selected, setSelected] = useState<ReplacementItem[]>(() =>
    replacement.suggestedItems[0] ? [{ ...replacement.suggestedItems[0], qty: 1 }] : [],
  );
  const [showCatalog, setShowCatalog] = useState(false);
  const [search, setSearch] = useState("");
  const [extraPaymentMethod, setExtraPaymentMethod] = useState<"UPI" | "COD">(
    order.payment_method === "COD" ? "COD" : "UPI",
  );
  const [extraUtr, setExtraUtr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (replacement.status === "awaiting_student" && selected.length === 0 && replacement.suggestedItems[0]) {
      setSelected([{ ...replacement.suggestedItems[0], qty: 1 }]);
    }
  }, [replacement.status, replacement.suggestedItems, selected.length]);

  const inStockProducts = useMemo(() => {
    const list = (products.data ?? []).filter(
      (p) => p.in_stock && p.stock_quantity > 0 && p.id !== replacement.unavailableItem.id,
    );
    const term = search.trim().toLowerCase();
    if (!term) return list.slice(0, 24);
    return list.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 24);
  }, [products.data, search, replacement.unavailableItem.id]);

  const originalTotal =
    Number(replacement.unavailableItem.price) * replacement.unavailableItem.qty;
  const chosenTotal = getReplacementItemTotal(selected);
  const priceDiff = Math.round((chosenTotal - originalTotal) * 100) / 100;
  const upiId = settings.data?.["upi_id"] ?? "";

  function addOrIncrement(item: {
    id: string;
    name: string;
    price: number | string;
    image_url: string | null;
    stock_quantity?: number;
  }) {
    setSelected((prev) => {
      const existing = prev.find((p) => p.id === item.id);
      if (existing) {
        const max = item.stock_quantity ?? 20;
        if (existing.qty >= max) return prev;
        return prev.map((p) => (p.id === item.id ? { ...p, qty: p.qty + 1 } : p));
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          qty: 1,
          price: Number(item.price),
          image_url: item.image_url,
        },
      ];
    });
  }

  function updateQty(id: string, delta: number) {
    setSelected((prev) =>
      prev
        .map((p) => (p.id === id ? { ...p, qty: p.qty + delta } : p))
        .filter((p) => p.qty > 0),
    );
  }

  async function handleConfirm() {
    if (selected.length === 0) {
      toast.error("Select at least one replacement item.");
      return;
    }
    const cleanUtr = extraUtr.replace(/\D/g, "");
    const effectiveMethod =
      priceDiff > 0 ? (order.payment_method === "UPI" ? "UPI" : extraPaymentMethod) : "UPI";
    if (priceDiff > 0 && effectiveMethod === "UPI" && !/^\d{12}$/.test(cleanUtr)) {
      toast.error("Enter the 12-digit UTR for the extra UPI payment.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitChoice({
        data: {
          orderId: order.id,
          chosenItems: selected.map((s) => ({ id: s.id, qty: s.qty })),
          extraPaymentMethod: effectiveMethod,
          extraUtr: priceDiff > 0 && effectiveMethod === "UPI" ? cleanUtr : null,
        },
      });

      writeLocalReplacement(result.record);

      if (!result.persistedToSettings && session?.user.id) {
        // Cross-device Realtime bridge via user-insertable suggestions table when service key isn't set
        await supabase.from("suggestions").insert({
          user_id: session.user.id,
          user_name: session.user.email ?? "Student",
          suggestion_text: JSON.stringify({
            type: "order_replacement_response",
            orderId: order.id,
            key: replacementSettingKey(order.id),
            record: result.record,
          }),
        });
      }

      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      onUpdated();
      toast.success(
        priceDiff > 0 && effectiveMethod === "UPI"
          ? "Replacement & extra payment UTR submitted! Store is reviewing."
          : priceDiff < 0
            ? `Replacement confirmed! ₹${Math.abs(priceDiff)} refund queued.`
            : "Replacement confirmed!",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit replacement.");
    } finally {
      setSubmitting(false);
    }
  }

  if (replacement.status === "cancelled") return null;

  if (replacement.status === "awaiting_student") {
    return (
      <section className="mt-5 rounded-3xl border-2 border-primary/40 bg-card p-4 shadow-float">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-warning/20 text-warning-foreground">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-extrabold text-foreground">
              Item Unavailable — Choose Replacement
            </h2>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {replacement.unavailableItem.qty}× {replacement.unavailableItem.name}
              </span>{" "}
              ({rupees(originalTotal)}) is currently out of stock. Pick a replacement or add any item below.
            </p>
            {replacement.adminNote && (
              <p className="mt-1.5 rounded-xl bg-accent/60 px-2.5 py-1.5 text-xs font-medium text-accent-foreground">
                Store note: {replacement.adminNote}
              </p>
            )}
          </div>
        </div>

        {replacement.suggestedItems.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Recommended by store
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {replacement.suggestedItems.map((item) => {
                const picked = selected.find((s) => s.id === item.id);
                const diff = Number(item.price) - originalTotal;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addOrIncrement(item)}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border p-2 text-left transition-all active:scale-95",
                      picked
                        ? "border-primary bg-accent ring-1 ring-primary"
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
                      {item.image_url ? (
                        <CatalogImage
                          source={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="font-display text-sm font-bold text-primary">
                          {item.name.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold">{item.name}</p>
                      <p className="text-[11px] font-extrabold text-primary">
                        {rupees(item.price)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {diff === 0 ? "Same price" : diff > 0 ? `+${rupees(diff)}` : `Save ${rupees(Math.abs(diff))}`}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowCatalog((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-primary hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {showCatalog ? "Hide full menu" : "Or browse & add any item"}
          </button>

          {showCatalog && (
            <div className="mt-2.5 space-y-2 rounded-2xl border border-border bg-background p-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search any in-stock item…"
                  className="h-9 rounded-xl pl-8 text-xs"
                />
              </div>
              <div className="grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto">
                {inStockProducts.map((p) => {
                  const picked = selected.find((s) => s.id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addOrIncrement(p)}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border p-1.5 text-left text-xs transition-colors",
                        picked ? "border-primary bg-accent" : "border-border/70 bg-card",
                      )}
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                        {p.image_url ? (
                          <CatalogImage source={p.image_url} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-bold text-primary">{p.name.slice(0, 1)}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{p.name}</p>
                        <p className="text-[11px] font-bold text-primary">{rupees(p.price)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {selected.length > 0 && (
          <div className="mt-4 space-y-2 rounded-2xl border border-border bg-background p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Your selected replacement
            </p>
            <ul className="space-y-2">
              {selected.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
                  <span className="font-semibold text-muted-foreground">
                    {rupees(s.price * s.qty)}
                  </span>
                  <div className="flex items-center gap-1 rounded-full border border-border bg-card px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => updateQty(s.id, -1)}
                      aria-label={`Remove one ${s.name}`}
                      className="grid h-6 w-6 place-items-center rounded-full hover:bg-muted"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="min-w-4 text-center font-bold tabular-nums">{s.qty}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(s.id, 1)}
                      aria-label={`Add one ${s.name}`}
                      className="grid h-6 w-6 place-items-center rounded-full hover:bg-muted"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="h-px bg-border" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Original item value</span>
              <span className="font-semibold">{rupees(originalTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Replacement total</span>
              <span className="font-bold">{rupees(chosenTotal)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-accent/60 px-2.5 py-2 text-xs font-extrabold">
              <span>
                {priceDiff === 0
                  ? "Same price"
                  : priceDiff > 0
                    ? "Extra payable"
                    : "Refund due to you"}
              </span>
              <span
                className={cn(
                  priceDiff > 0
                    ? "text-primary"
                    : priceDiff < 0
                      ? "text-success"
                      : "text-foreground",
                )}
              >
                {priceDiff === 0
                  ? "₹0 (No extra charge)"
                  : priceDiff > 0
                    ? `+${rupees(priceDiff)}`
                    : rupees(Math.abs(priceDiff))}
              </span>
            </div>

            {priceDiff > 0 && (
              <div className="mt-2 space-y-2.5 rounded-2xl border border-primary/30 bg-card p-3">
                {order.payment_method === "COD" && (
                  <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted p-1 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setExtraPaymentMethod("COD")}
                      className={cn(
                        "rounded-lg py-1.5 transition-colors",
                        extraPaymentMethod === "COD"
                          ? "bg-brand text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      Pay on Delivery
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtraPaymentMethod("UPI")}
                      className={cn(
                        "rounded-lg py-1.5 transition-colors",
                        extraPaymentMethod === "UPI"
                          ? "bg-brand text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      Pay Now (UPI)
                    </button>
                  </div>
                )}

                {(order.payment_method === "UPI" || extraPaymentMethod === "UPI") && (
                  <>
                    <p className="text-xs font-bold">
                      Scan & Pay extra {rupees(priceDiff)} via UPI
                    </p>
                    <div className="flex flex-col items-center gap-2">
                      {qr.data ? (
                        <img
                          src={qr.data}
                          alt="Campu UPI QR"
                          className="h-36 w-36 rounded-xl border border-border bg-white object-contain p-1"
                        />
                      ) : upiId ? (
                        <img
                          src={fallbackQrUrl(upiId, priceDiff)}
                          alt="Campu UPI QR"
                          className="h-36 w-36 rounded-xl border border-border bg-white object-contain p-1"
                        />
                      ) : null}
                      {upiId && (
                        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs">
                          <span className="font-mono font-semibold">{upiId}</span>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(upiId);
                              toast.success("UPI ID copied");
                            }}
                            aria-label="Copy UPI ID"
                            className="text-primary"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-bold" htmlFor="extra-utr-input">
                        12-digit Extra Payment UTR
                      </label>
                      <Input
                        id="extra-utr-input"
                        value={extraUtr}
                        onChange={(e) => setExtraUtr(e.target.value.replace(/\D/g, "").slice(0, 12))}
                        inputMode="numeric"
                        placeholder="Enter 12-digit UTR number"
                        className="h-10 rounded-xl font-mono tracking-wider"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            <Button
              type="button"
              disabled={submitting}
              onClick={() => void handleConfirm()}
              className="mt-2 h-11 w-full rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-float"
            >
              {submitting
                ? "Submitting…"
                : priceDiff > 0 && (order.payment_method === "UPI" || extraPaymentMethod === "UPI")
                  ? `Submit Replacement & Pay ${rupees(priceDiff)}`
                  : priceDiff < 0
                    ? `Confirm & Get ${rupees(Math.abs(priceDiff))} Refund`
                    : "Confirm Replacement"}
            </Button>
          </div>
        )}
      </section>
    );
  }

  const chosenList = replacement.chosenItems ?? [];
  const diff = Number(replacement.priceDifference ?? 0);

  return (
    <section className="mt-5 rounded-3xl border border-primary/30 bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-primary">
          <ArrowRightLeft className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-extrabold">
            {replacement.status === "applied"
              ? "Item Replaced & Order Updated"
              : "Replacement Submitted — Awaiting Store Confirmation"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Swapped {replacement.unavailableItem.qty}× {replacement.unavailableItem.name} →{" "}
            {chosenList.map((i) => `${i.qty}× ${i.name}`).join(", ")}
          </p>
        </div>
      </div>

      {replacement.extraUtr && (
        <p className="mt-2 rounded-xl bg-accent/60 px-3 py-1.5 text-xs font-semibold text-accent-foreground">
          Extra payment UTR submitted: <span className="font-mono">{replacement.extraUtr}</span>
        </p>
      )}

      {diff < 0 && (
        <div className="mt-3 rounded-2xl border border-border bg-background p-3">
          {replacement.partialRefundStatus === "refunded" ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-bold text-success">
                <Check className="h-4 w-4" />
                Partial refund of {rupees(Math.abs(diff))} sent to your UPI
              </p>
              {partialProof.data && (
                <img
                  src={partialProof.data}
                  alt="Partial refund proof"
                  className="max-h-56 w-full rounded-xl border border-border object-contain"
                />
              )}
            </div>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">
              Partial refund of <span className="font-bold text-foreground">{rupees(Math.abs(diff))}</span> will be sent to your UPI shortly.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
