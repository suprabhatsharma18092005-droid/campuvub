import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REVIEWS_SETTING_KEY, parseGlobalReviewsSummary } from "@/lib/reviews";

const submitSchema = z.object({
  orderId: z.string().min(1),
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(300).optional(),
  userName: z.string().trim().max(80).optional(),
});

export const submitProductReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof submitSchema>) => submitSchema.parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) return { ok: false, persistedRemotely: false };

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: order } = await context.supabase
        .from("orders")
        .select("id, student_id, status")
        .eq("id", data.orderId)
        .maybeSingle();

      if (!order || order.student_id !== userId || order.status !== "delivered") {
        return { ok: false, persistedRemotely: false };
      }

      const { data: setting } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", REVIEWS_SETTING_KEY)
        .maybeSingle();

      const summary = parseGlobalReviewsSummary(setting?.value);
      const current = summary[data.productId] ?? { count: 0, sum: 0, recent: [] };
      const nextCount = current.count + 1;
      const nextSum = current.sum + data.rating;
      const nextRecent = [
        {
          rating: data.rating,
          comment: data.comment?.trim() ?? "",
          userName: data.userName?.trim() || "Campus Student",
          createdAt: new Date().toISOString(),
        },
        ...(current.recent ?? []),
      ].slice(0, 10);

      summary[data.productId] = {
        count: nextCount,
        sum: nextSum,
        recent: nextRecent,
      };

      const { error } = await supabaseAdmin
        .from("app_settings")
        .upsert({ key: REVIEWS_SETTING_KEY, value: JSON.stringify(summary) }, { onConflict: "key" });

      return { ok: !error, persistedRemotely: !error };
    } catch {
      return { ok: true, persistedRemotely: false };
    }
  });
