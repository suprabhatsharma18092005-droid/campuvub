import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmUserId, setConfirmUserId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  async function review(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    const { error } = await supabase.from("vip_subscriptions").update({ status }).eq("id", id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "approved" ? "VIP activated for 30 days" : "Request rejected");
    void qc.invalidateQueries({ queryKey: ["admin-vip"] });
  }

  const rows = q.data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const now = Date.now();
  const active = rows.filter((r) => r.status === "approved" && r.expires_at && new Date(r.expires_at).getTime() > now);

  // Deduplicate active VIP users for clean display while keeping all active row IDs for full deactivation
  const activeUserMap = new Map<string, typeof active[number] & { rowIds: string[] }>();
  for (const r of active) {
    const existing = activeUserMap.get(r.user_id);
    if (!existing) {
      activeUserMap.set(r.user_id, { ...r, rowIds: [r.id] });
    } else {
      existing.rowIds.push(r.id);
      if (new Date(r.expires_at!).getTime() > new Date(existing.expires_at!).getTime()) {
        existing.expires_at = r.expires_at;
      }
    }
  }
  const activeUsers = Array.from(activeUserMap.values());

  async function deactivateUser(user: typeof activeUsers[number]) {
    setBusyId(user.user_id);
    const { error } = await supabase.from("vip_subscriptions").update({ status: "rejected" }).in("id", user.rowIds);
    setBusyId(null);
    setConfirmUserId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`VIP turned off for ${user.name}`);
    void qc.invalidateQueries({ queryKey: ["admin-vip"] });
  }

  async function deactivateAllActive() {
    if (active.length === 0) return;
    setBusyAll(true);
    const { error } = await supabase.from("vip_subscriptions").update({ status: "rejected" }).in("id", active.map((r) => r.id));
    setBusyAll(false);
    setConfirmAll(false);
    if (error) { toast.error(error.message); return; }
    toast.success("All active VIP memberships turned off");
    void qc.invalidateQueries({ queryKey: ["admin-vip"] });
  }

  return (
    <div className="min-w-0 space-y-5">
      <section>
        <h3 className="font-display text-lg font-bold">Pending payments ({pending.length})</h3>
        {pending.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No pending VIP requests.</p>}
        <div className="mt-2 space-y-3">
          {pending.map((r) => (
            <div key={r.id} className="royal-card rounded-2xl border border-primary/40 bg-card p-4 shadow-card">
              <p className="font-semibold">{r.name}{r.phone ? ` · ${r.phone}` : ""}</p>
              <p className="text-sm text-muted-foreground">{rupees(r.amount)} · UTR <b className="text-foreground">{r.utr_number}</b></p>
              <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
              <div className="mt-3 flex gap-2">
                <Button disabled={busyId === r.id} className="flex-1" onClick={() => void review(r.id, "approved")}>Approve</Button>
                <Button disabled={busyId === r.id} variant="outline" className="flex-1" onClick={() => void review(r.id, "rejected")}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-bold">Active members ({activeUsers.length})</h3>
          {activeUsers.length > 0 && (
            confirmAll ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busyAll}
                  onClick={() => void deactivateAllActive()}
                  className="h-8 rounded-full px-3 text-xs"
                >
                  {busyAll ? "Disabling…" : "Confirm disable all"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busyAll}
                  onClick={() => setConfirmAll(false)}
                  className="h-8 rounded-full px-2.5 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmAll(true)}
                className="h-8 rounded-full border-destructive/40 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
              >
                Disable all VIPs
              </Button>
            )
          )}
        </div>
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
          {activeUsers.map((u) => {
            const isConfirming = confirmUserId === u.user_id;
            const isBusy = busyId === u.user_id || busyAll;
            return (
              <li key={u.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {u.name}
                    {u.phone ? <span className="font-normal text-muted-foreground"> · {u.phone}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">till {formatVipDate(u.expires_at!)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isConfirming ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isBusy}
                        onClick={() => void deactivateUser(u)}
                        className="h-7 rounded-full px-2.5 text-xs"
                      >
                        {busyId === u.user_id ? "Turning off…" : "Confirm"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => setConfirmUserId(null)}
                        className="h-7 rounded-full px-2 text-xs"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => setConfirmUserId(u.user_id)}
                      className="h-7 rounded-full border-destructive/40 px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"
                    >
                      Disable VIP
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {activeUsers.length === 0 && <li className="px-4 py-2.5 text-muted-foreground">No active members yet.</li>}
        </ul>
      </section>
    </div>
  );
}
