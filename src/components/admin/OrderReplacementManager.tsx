import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft, Check, RefreshCw, Search, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { CatalogImage } from "@/components/CatalogImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/format";
import {
  parseOrderReplacement,
  replacementSettingKey,
  type OrderReplacement,
  type ReplacementItem,
} from "@/lib/replacements";
import { applyOrderReplacement } from "@/lib/replacements.functions";
import { QR_BUCKET } from "@/lib/upi";
import { cn } from "@/lib/utils";

type AdminProductOption = {
  id: string;
  name: string;
  price: number | string;
  in_stock: boolean;
  stock_quantity: number;
  image_url?: string | null;
};

export function OrderReplacementManager({
  order,
  products,
  settings,
  fallbackResponse,
}: {
  order: {
    id: string;
    status: string;
    payment_method: string;
    cart_items: unknown;
  };
  products: AdminProductOption[];
  settings: Record<string, string> | undefined;
  fallbackResponse?: OrderReplacement | null | undefined;
}) {
  const queryClient = useQueryClient();
  const applyReplacement = useServerFn(applyOrderReplacement);

  const items = ((order.cart_items as {
    id?: string;
    name: string;
    qty: number;
    price: number;
    image_url?: string | null;
  }[]) ?? []).map((i) => ({
    id: i.id ?? "",
    name: i.name,
    qty: i.qty,
    price: Number(i.price),
    image_url: i.image_url ?? null,
  }));

  const remoteRecord = parseOrderReplacement(settings?.[replacementSettingKey(order.id)]);
  const activeRecord =
    fallbackResponse &&
    (!remoteRecord ||
      new Date(fallbackResponse.updatedAt).getTime() >
        new Date(remoteRecord.updatedAt).getTime())
      ? fallbackResponse
      : remoteRecord;

  const [open, setOpen] = useState(false);
  const [unavailableIdx, setUnavailableIdx] = useState(0);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const targetItem = items[unavailableIdx] ?? items[0];

  const candidateProducts = useMemo(() => {
    const targetPrice = targetItem ? Number(targetItem.price) * targetItem.qty : 0;
    const list = products
      .filter((p) => p.in_stock && p.stock_quantity > 0 && p.id !== targetItem?.id)
      .sort((a, b) => {
        const diffA = Math.abs(Number(a.price) - targetPrice);
        const diffB = Math.abs(Number(b.price) - targetPrice);
        return diffA - diffB;
      });
    const term = search.trim().toLowerCase();
    if (!term) return list.slice(0, 18);
    return list.filter((p) => p.name.toLowerCase().includes(term)).slice(0, 18);
  }, [products, search, targetItem]);

  async function sendRequest() {
    if (!targetItem) return;
    if (suggestedIds.length === 0) {
      toast.error("Select at least one suggested replacement product.");
      return;
    }

    const suggestions: ReplacementItem[] = products
      .filter((p) => suggestedIds.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        qty: 1,
        price: Number(p.price),
        image_url: p.image_url ?? null,
      }));

    const now = new Date().toISOString();
    const record: OrderReplacement = {
      orderId: order.id,
      status: "awaiting_student",
      unavailableItem: targetItem,
      suggestedItems: suggestions,
      ...(adminNote.trim() ? { adminNote: adminNote.trim() } : {}),
      createdAt: now,
      updatedAt: now,
    };

    setBusy(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: replacementSettingKey(order.id), value: JSON.stringify(record) },
        { onConflict: "key" },
      );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOpen(false);
    setSuggestedIds([]);
    setAdminNote("");
    toast.success("Replacement options sent to student");
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  async function cancelRequest() {
    if (!activeRecord) return;
    setBusy(true);
    const cancelled: OrderReplacement = {
      ...activeRecord,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: replacementSettingKey(order.id), value: JSON.stringify(cancelled) },
        { onConflict: "key" },
      );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Replacement request cancelled");
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  async function confirmAndApply(proofPath?: string | null, markDone?: boolean) {
    if (!activeRecord) return;
    setBusy(true);
    try {
      await applyReplacement({
        data: {
          orderId: order.id,
          partialRefundProofPath: proofPath ?? null,
          markPartialRefundDone: markDone,
          overrideRecord: activeRecord,
        },
      });
      toast.success("Order updated with replacement item!");
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply replacement.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPartialRefund(file: File) {
    if (!activeRecord) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose a screenshot image smaller than 5 MB.");
      return;
    }
    setBusy(true);
    const path = `refunds/partial-${order.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "")}`;
    const { error: upErr } = await supabase.storage.from(QR_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (upErr) {
      setBusy(false);
      toast.error(upErr.message);
      return;
    }
    if (activeRecord.status === "applied") {
      const updated: OrderReplacement = {
        ...activeRecord,
        partialRefundStatus: "refunded",
        partialRefundProofPath: path,
        updatedAt: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: replacementSettingKey(order.id), value: JSON.stringify(updated) },
          { onConflict: "key" },
        );
      setBusy(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Partial refund proof uploaded");
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    } else {
      await confirmAndApply(path, true);
    }
  }

  const diff = Number(activeRecord?.priceDifference ?? 0);

  return (
    <div className="mt-3 space-y-2">
      {activeRecord && activeRecord.status !== "cancelled" && (
        <div className="rounded-2xl border border-primary/30 bg-accent/45 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-extrabold text-primary">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                {activeRecord.status === "awaiting_student"
                  ? "Awaiting Student Replacement Choice"
                  : activeRecord.status === "applied"
                    ? "Replacement Applied to Order"
                    : "Student Confirmed Replacement"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Unavailable: {activeRecord.unavailableItem.qty}× {activeRecord.unavailableItem.name} (
                {rupees(activeRecord.unavailableItem.price * activeRecord.unavailableItem.qty)})
              </p>
            </div>
            {activeRecord.status === "awaiting_student" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void cancelRequest()}
                className="h-7 rounded-full px-2 text-xs text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {activeRecord.chosenItems && activeRecord.chosenItems.length > 0 && (
            <div className="mt-2 rounded-xl border border-border/70 bg-card p-2.5 text-xs">
              <p className="font-bold text-foreground">
                Student selected:{" "}
                {activeRecord.chosenItems.map((c) => `${c.qty}× ${c.name}`).join(", ")}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Price difference:{" "}
                <span className="font-bold text-foreground">
                  {diff === 0
                    ? "₹0 (Even)"
                    : diff > 0
                      ? `+${rupees(diff)} extra`
                      : `-${rupees(Math.abs(diff))} (Refund due)`}
                </span>
              </p>
              {activeRecord.extraUtr && (
                <p className="mt-1 font-mono font-bold text-primary">
                  Extra Payment UTR: {activeRecord.extraUtr}
                </p>
              )}
              {diff > 0 && activeRecord.extraPaymentMethod === "COD" && (
                <p className="mt-1 font-semibold text-warning-foreground">
                  Collect {rupees(diff)} extra in Cash on Delivery.
                </p>
              )}

              {activeRecord.status !== "applied" && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void confirmAndApply(null, false)}
                    className="h-9 flex-1 rounded-full bg-success text-xs font-bold text-success-foreground"
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {busy
                      ? "Updating…"
                      : activeRecord.extraUtr
                        ? "Verify UTR & Update Order"
                        : "Confirm & Update Order"}
                  </Button>
                </div>
              )}

              {diff < 0 && (
                <div className="mt-2 border-t border-border/60 pt-2">
                  {activeRecord.partialRefundStatus === "refunded" ? (
                    <p className="flex items-center gap-1 text-xs font-bold text-success">
                      <Check className="h-3.5 w-3.5" /> Partial refund of {rupees(Math.abs(diff))} sent
                    </p>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-primary-foreground">
                      <Upload className="h-3.5 w-3.5" />
                      {busy
                        ? "Uploading…"
                        : `Upload ${rupees(Math.abs(diff))} Partial Refund Proof`}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={busy}
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadPartialRefund(f);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(!activeRecord || activeRecord.status === "cancelled" || activeRecord.status === "applied") && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          className="h-8 rounded-full border-primary/35 text-xs font-bold text-primary"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {open ? "Close replacement picker" : "Replace unavailable item"}
        </Button>
      )}

      {open && (
        <div className="space-y-2.5 rounded-2xl border border-border bg-background p-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              1. Which item is out of stock?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {items.map((it, idx) => (
                <button
                  key={`${it.id}-${idx}`}
                  type="button"
                  onClick={() => setUnavailableIdx(idx)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                    unavailableIdx === idx
                      ? "border-primary bg-accent text-primary"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  {it.qty}× {it.name} ({rupees(it.price * it.qty)})
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              2. Pick suggested replacements (same-price shown first)
            </p>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="h-9 rounded-xl pl-8 text-xs"
              />
            </div>
            <div className="mt-2 grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto">
              {candidateProducts.map((p) => {
                const picked = suggestedIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setSuggestedIds((cur) =>
                        cur.includes(p.id) ? cur.filter((id) => id !== p.id) : [...cur, p.id],
                      )
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-1.5 text-left text-xs transition-colors",
                      picked ? "border-primary bg-accent" : "border-border/70 bg-card",
                    )}
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
                      {p.image_url ? (
                        <CatalogImage
                          source={p.image_url}
                          alt={p.name}
                          className="h-full w-full object-cover"
                        />
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

          <Input
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            placeholder="Optional note to student (e.g. Same price option available)…"
            className="h-9 rounded-xl text-xs"
          />

          <Button
            type="button"
            disabled={busy || suggestedIds.length === 0}
            onClick={() => void sendRequest()}
            className="h-10 w-full rounded-full bg-brand text-xs font-bold text-primary-foreground"
          >
            {busy ? "Sending…" : `Send ${suggestedIds.length} suggestion(s) to student`}
          </Button>
        </div>
      )}
    </div>
  );
}
