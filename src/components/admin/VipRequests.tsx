import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { formatVipDate } from "@/components/VipBanner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/format";

type Row = { id: string; user_id: string; amount: number; utr_number: string; status: string; expires_at: string | null; created_at: string };

export const vipAdminQuery = {
  queryKey: ["admin-vip"],
  queryFn: async () => {
    const { data, error } = await supabase.from("vip_subscriptions")
      .select("id, user_id, amount, utr_number, status, expires_at, created_at")
      .order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, full_name, phone_number").in("id", ids)
      : { data: [] };
    const names = new Map((profiles ?? []).map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, name: names.get(r.user_id)?.full_name ?? "Student", phone: names.get(r.user_id)?.phone_number ?? null }));
  },
};

export function VipRequests() {
  const qc = useQueryClient();
  const q = useQuery(vipAdminQuery);
  useEffect(() => {
    const ch = supabase.channel(`admin-vip-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "vip_subscriptions" }, () => void qc.invalidateQueries({ queryKey: ["admin-vip"] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  async function review(id: string, status: "approved" | "rejected") {
    if (status === "rejected" && !confirm("Reject this VIP payment?")) return;
    const { error } = await supabase.from("vip_subscriptions").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(status === "approved" ? "VIP activated for 30 days" : "Request rejected");
    void qc.invalidateQueries({ queryKey: ["admin-vip"] });
  }

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const now = Date.now();
  const active = rows.filter((r) => r.status === "approved" && r.expires_at && new Date(r.expires_at).getTime() > now);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="font-display text-lg font-bold">Pending payments ({pending.length})</h3>
        {pending.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No pending VIP requests.</p>}
        <div className="mt-2 space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
              <p className="font-semibold">{r.name}{r.phone ? ` · ${r.phone}` : ""}</p>
              <p className="text-sm text-muted-foreground">{rupees(r.amount)} · UTR <b className="text-foreground">{r.utr_number}</b></p>
              <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
              <div className="mt-3 flex gap-2">
                <Button className="flex-1" onClick={() => void review(r.id, "approved")}>Approve</Button>
                <Button variant="outline" className="flex-1" onClick={() => void review(r.id, "rejected")}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="font-display text-lg font-bold">Active members ({new Set(active.map((r) => r.user_id)).size})</h3>
        <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card text-sm">
          {active.map((r) => (
            <li key={r.id} className="flex justify-between px-4 py-2"><span>{r.name}</span><span className="text-muted-foreground">till {formatVipDate(r.expires_at!)}</span></li>
          ))}
          {active.length === 0 && <li className="px-4 py-2 text-muted-foreground">No active members yet.</li>}
        </ul>
      </section>
    </div>
  );
}
