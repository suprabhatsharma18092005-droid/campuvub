import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";

export type VipRow = {
  id: string;
  status: string;
  amount: number;
  utr_number: string;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
};

function istDayStart() {
  const now = new Date();
  const ist = new Date(now.getTime() + 330 * 60_000);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return new Date(startIst - 330 * 60_000).toISOString();
}

/** Signed-in student's VIP state: active membership, pending request, and free quick deliveries used today. */
export function useVip() {
  const { session } = useSession();
  const uid = session?.user.id;
  const q = useQuery({
    queryKey: ["vip", uid],
    enabled: Boolean(uid),
    queryFn: async () => {
      const [subs, used] = await Promise.all([
        supabase.from("vip_subscriptions").select("id, status, amount, utr_number, starts_at, expires_at, created_at")
          .eq("user_id", uid!).order("created_at", { ascending: false }),
        supabase.from("orders").select("id", { count: "exact", head: true })
          .eq("student_id", uid!).eq("delivery_type", "quick").eq("delivery_fee", 0)
          .neq("status", "cancelled").gte("created_at", istDayStart()),
      ]);
      if (subs.error) throw subs.error;
      return { rows: (subs.data ?? []) as VipRow[], freeUsedToday: used.count ?? 0 };
    },
  });
  const rows = q.data?.rows ?? [];
  const now = Date.now();
  const approved = rows.filter((r) => r.status === "approved" && r.expires_at);
  const active = approved.find((r) => new Date(r.starts_at!).getTime() <= now && new Date(r.expires_at!).getTime() > now) ?? null;
  const expiresAt = approved.reduce<string | null>((m, r) => (!m || r.expires_at! > m ? r.expires_at : m), null);
  return {
    loading: q.isLoading,
    signedIn: Boolean(uid),
    isVip: Boolean(active),
    expiresAt: active ? expiresAt : null,
    wasMember: approved.length > 0,
    pending: rows.find((r) => r.status === "pending") ?? null,
    freeUsedToday: q.data?.freeUsedToday ?? 0,
    refetch: q.refetch,
  };
}
