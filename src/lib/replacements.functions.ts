import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeCartWithReplacement,
  getReplacementItemTotal,
  parseOrderReplacement,
  replacementSettingKey,
  type OrderReplacement,
  type ReplacementItem,
} from "@/lib/replacements";

const chosenItemSchema = z.object({
  id: z.string().uuid(),
  qty: z.number().int().positive().max(25),
});

const studentChoiceSchema = z.object({
  orderId: z.string().uuid(),
  chosenItems: z.array(chosenItemSchema).min(1),
  extraPaymentMethod: z.enum(["UPI", "COD"]).default("UPI"),
  extraUtr: z.string().trim().optional().nullable(),
});

const applySchema = z.object({
  orderId: z.string().uuid(),
  partialRefundProofPath: z.string().trim().optional().nullable(),
  markPartialRefundDone: z.boolean().optional(),
  overrideRecord: z.any().optional(),
});

function hasLiveAdminDb() {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

export const submitReplacementChoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof studentChoiceSchema>) => studentChoiceSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error: orderErr } = await context.supabase
      .from("orders")
      .select("id, student_id, status, payment_method")
      .eq("id", data.orderId)
      .maybeSingle();

    if (orderErr || !order || order.student_id !== context.userId) {
      throw new Error("Order not found or access denied.");
    }
    if (["delivered", "cancelled"].includes(order.status)) {
      throw new Error("Order can no longer be modified.");
    }

    const key = replacementSettingKey(data.orderId);
    const { data: settingRow } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    const current = parseOrderReplacement(settingRow?.value);
    if (!current || current.status !== "awaiting_student") {
      throw new Error("No active replacement request for this order.");
    }

    const ids = data.chosenItems.map((i) => i.id);
    const { data: productRows, error: prodErr } = await context.supabase
      .from("products")
      .select("id, name, price, image_url, in_stock, stock_quantity")
      .in("id", ids);

    if (prodErr || !productRows || productRows.length === 0) {
      throw new Error("Could not verify selected replacement products.");
    }

    const productMap = new Map(productRows.map((p) => [p.id, p]));
    const verifiedItems: ReplacementItem[] = [];
    for (const reqItem of data.chosenItems) {
      const prod = productMap.get(reqItem.id);
      if (!prod || !prod.in_stock || prod.stock_quantity < reqItem.qty) {
        throw new Error(`${prod?.name ?? "Selected item"} does not have enough stock.`);
      }
      verifiedItems.push({
        id: prod.id,
        name: prod.name,
        qty: reqItem.qty,
        price: Number(prod.price),
        image_url: prod.image_url,
      });
    }

    const originalTotal =
      Number(current.unavailableItem.price) * current.unavailableItem.qty;
    const chosenTotal = getReplacementItemTotal(verifiedItems);
    const priceDifference = Math.round((chosenTotal - originalTotal) * 100) / 100;

    const paymentMethod =
      priceDifference > 0
        ? order.payment_method === "UPI"
          ? "UPI"
          : data.extraPaymentMethod
        : undefined;

    const cleanUtr = (data.extraUtr ?? "").replace(/\D/g, "");
    if (priceDifference > 0 && paymentMethod === "UPI" && !/^\d{12}$/.test(cleanUtr)) {
      throw new Error("Enter the 12-digit UPI UTR for the extra amount.");
    }

    const nextRecord: OrderReplacement = {
      ...current,
      status:
        priceDifference > 0 && paymentMethod === "UPI"
          ? "extra_payment_submitted"
          : "student_confirmed",
      chosenItems: verifiedItems,
      priceDifference,
      ...(paymentMethod ? { extraPaymentMethod: paymentMethod } : {}),
      extraUtr: priceDifference > 0 && paymentMethod === "UPI" ? cleanUtr : null,
      partialRefundStatus: priceDifference < 0 ? "pending" : "none",
      updatedAt: new Date().toISOString(),
    };

    let persistedToSettings = false;
    if (hasLiveAdminDb()) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error: upsertErr } = await supabaseAdmin
          .from("app_settings")
          .upsert({ key, value: JSON.stringify(nextRecord) }, { onConflict: "key" });
        persistedToSettings = !upsertErr;
      } catch {
        persistedToSettings = false;
      }
    }

    return { ok: true, persistedToSettings, record: nextRecord };
  });

export const applyOrderReplacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof applySchema>) => applySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Forbidden");

    const key = replacementSettingKey(data.orderId);
    const { data: settingRow } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    const parsed = parseOrderReplacement(settingRow?.value);
    const override =
      data.overrideRecord && typeof data.overrideRecord === "object"
        ? (data.overrideRecord as OrderReplacement)
        : null;
    const active =
      override && override.orderId === data.orderId && override.chosenItems?.length
        ? override
        : parsed;

    if (!active || !active.chosenItems?.length) {
      throw new Error("Student has not confirmed a replacement item yet.");
    }

    const { data: order, error: orderErr } = await context.supabase
      .from("orders")
      .select("id, cart_items, subtotal, delivery_fee, total, status")
      .eq("id", data.orderId)
      .single();

    if (orderErr || !order) throw new Error("Order not found.");
    if (["delivered", "cancelled"].includes(order.status)) {
      throw new Error("Cannot replace items on a completed or cancelled order.");
    }

    const existingItems = ((order.cart_items as ReplacementItem[]) ?? []).map((item) => ({
      ...item,
      price: Number(item.price),
    }));

    const { items: updatedItems, subtotal: nextSubtotal } = computeCartWithReplacement(
      existingItems,
      active.unavailableItem,
      active.chosenItems,
    );
    const nextTotal = Math.max(0, nextSubtotal + Number(order.delivery_fee));

    // Update stock: restore unavailable qty and deduct chosen qty.
    const stockClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : context.supabase;

    if (active.unavailableItem.id) {
      const { data: oldProd } = await stockClient
        .from("products")
        .select("stock_quantity")
        .eq("id", active.unavailableItem.id)
        .maybeSingle();
      if (oldProd) {
        const restored = oldProd.stock_quantity + active.unavailableItem.qty;
        await stockClient
          .from("products")
          .update({ stock_quantity: restored, in_stock: restored > 0 })
          .eq("id", active.unavailableItem.id);
      }
    }

    for (const picked of active.chosenItems) {
      const { data: newProd } = await stockClient
        .from("products")
        .select("stock_quantity")
        .eq("id", picked.id)
        .maybeSingle();
      if (newProd) {
        const left = Math.max(0, newProd.stock_quantity - picked.qty);
        await stockClient
          .from("products")
          .update({ stock_quantity: left, in_stock: left > 0 })
          .eq("id", picked.id);
      }
    }

    const { error: updOrderErr } = await context.supabase
      .from("orders")
      .update({
        cart_items: updatedItems,
        subtotal: nextSubtotal,
        total: nextTotal,
      })
      .eq("id", data.orderId);

    if (updOrderErr) throw new Error(updOrderErr.message);

    const diff = Number(active.priceDifference ?? 0);
    const partialRefundStatus =
      diff < 0
        ? data.markPartialRefundDone || data.partialRefundProofPath
          ? "refunded"
          : active.partialRefundStatus === "refunded"
            ? "refunded"
            : "pending"
        : "none";

    const nextRecord: OrderReplacement = {
      ...active,
      status: "applied",
      partialRefundStatus,
      partialRefundProofPath: data.partialRefundProofPath ?? active.partialRefundProofPath ?? null,
      updatedAt: new Date().toISOString(),
    };

    const { error: saveErr } = await context.supabase
      .from("app_settings")
      .upsert({ key, value: JSON.stringify(nextRecord) }, { onConflict: "key" });
    if (saveErr) throw new Error(saveErr.message);

    try {
      const { dispatchPushEvent } = await import("./push-events.server");
      await dispatchPushEvent({ type: "order_status", orderId: data.orderId }, context);
    } catch {
      // Push failure never undoes replacement update
    }

    return { ok: true, record: nextRecord };
  });
