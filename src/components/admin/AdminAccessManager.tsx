import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Shield, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  grantAdminAccess,
  listAdminAccess,
  revokeAdminAccess,
  type AdminTeamMember,
} from "@/lib/admin-access.functions";

export function AdminAccessManager() {
  const queryClient = useQueryClient();
  const fetchTeam = useServerFn(listAdminAccess);
  const grantRemote = useServerFn(grantAdminAccess);
  const revokeRemote = useServerFn(revokeAdminAccess);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmRevokeKey, setConfirmRevokeKey] = useState<string | null>(null);

  const teamQuery = useQuery({
    queryKey: ["admin-access-team"],
    queryFn: () => fetchTeam(),
    staleTime: 15_000,
  });

  const snapshot = teamQuery.data;
  const callerIsSuperAdmin = snapshot?.callerIsSuperAdmin ?? false;
  const admins = snapshot?.admins ?? [];
  const promotableUsers = (snapshot?.candidates ?? []).filter((u) => !u.isAdmin);

  async function handleGrantByUser() {
    if (!selectedUserId) {
      toast.error("Select a registered user first.");
      return;
    }
    const picked = promotableUsers.find((u) => u.userId === selectedUserId);
    setBusyKey("grant-user");
    try {
      const res = await grantRemote({
        data: {
          userId: selectedUserId,
          ...(picked?.email ? { email: picked.email } : {}),
        },
      });
      setSelectedUserId("");
      toast.success(
        res.syncedToDatabaseRoles
          ? `${picked?.name ?? "User"} is now an Admin!`
          : `${picked?.name ?? "User"} added to Admin list (database role sync activates on live host).`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-access-team"] });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not grant admin access.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGrantByEmail(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = emailInput.trim().toLowerCase();
    if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setBusyKey("grant-email");
    try {
      const res = await grantRemote({ data: { email: cleaned } });
      setEmailInput("");
      toast.success(
        res.pendingSignup
          ? `${cleaned} pre-approved as Admin! Access activates automatically on verified sign-in.`
          : res.syncedToDatabaseRoles
            ? `${cleaned} is now an Admin!`
            : `${cleaned} added to Admin list.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-access-team"] });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not grant admin access.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevoke(member: AdminTeamMember) {
    if (member.isSuperAdmin) {
      toast.error("Super Admin cannot be removed.");
      return;
    }
    const label = member.email || member.name;
    const rowKey = member.userId ?? member.email;
    const key = `revoke:${rowKey}`;
    setBusyKey(key);
    setConfirmRevokeKey(null);
    try {
      await revokeRemote({
        data: {
          ...(member.userId ? { userId: member.userId } : {}),
          ...(member.email ? { email: member.email } : {}),
        },
      });
      toast.success(`Removed admin access from ${label}.`);
      await queryClient.invalidateQueries({ queryKey: ["admin-access-team"] });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove admin.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>Admin Access &amp; Super Admin</span>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {callerIsSuperAdmin
              ? "As Super Admin, you can grant or remove admin access for any account. Your Super Admin role is permanently protected."
              : "Super Admin is permanently protected. Only the Super Admin can add or remove admins."}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {teamQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading admin team…</p>
        ) : teamQuery.isError ? (
          <p className="text-xs text-destructive">Could not load admin access list.</p>
        ) : (
          <>
            {/* Active Admins List */}
            <ul className="divide-y divide-border rounded-xl border border-border bg-background">
              {admins.map((member) => {
                const rowKey = member.userId ?? member.email;
                const revoking = busyKey === `revoke:${rowKey}`;
                return (
                  <li
                    key={rowKey}
                    className="flex items-center justify-between gap-3 px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {member.name}
                        </p>
                        {member.isSuperAdmin ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                            <Crown className="h-3 w-3" /> Super Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            <Shield className="h-3 w-3" />
                            {member.pendingSignup ? "Pending Sign-in" : "Admin"}
                          </span>
                        )}
                      </div>
                      {member.email && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      )}
                      {member.isSuperAdmin && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Protected owner account — cannot be removed
                        </p>
                      )}
                    </div>

                    {!member.isSuperAdmin && callerIsSuperAdmin && (
                      confirmRevokeKey === rowKey ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            disabled={revoking || busyKey !== null}
                            onClick={() => void handleRevoke(member)}
                            className="h-8 rounded-lg bg-destructive px-2.5 text-xs font-bold text-destructive-foreground hover:opacity-90"
                          >
                            {revoking ? "Removing…" : "Confirm"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busyKey !== null}
                            onClick={() => setConfirmRevokeKey(null)}
                            className="h-8 rounded-lg px-2 text-xs text-muted-foreground"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={revoking || busyKey !== null}
                          onClick={() => setConfirmRevokeKey(rowKey)}
                          className="h-9 shrink-0 rounded-xl text-xs font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove
                        </Button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Grant Admin Controls (Super Admin Only) */}
            {callerIsSuperAdmin && (
              <div className="space-y-3 border-t border-border/70 pt-3.5">
                {promotableUsers.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-foreground">
                      Grant Admin to Registered User
                    </label>
                    <div className="flex gap-2">
                      <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                        <SelectTrigger className="h-10 min-w-0 flex-1 rounded-xl bg-background text-xs [&>span]:truncate">
                          <SelectValue placeholder="Select a registered user…" />
                        </SelectTrigger>
                        <SelectContent>
                          {promotableUsers.map((u) => (
                            <SelectItem key={u.userId} value={u.userId}>
                              {u.name}
                              {u.email ? ` (${u.email})` : u.phone ? ` · ${u.phone}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        disabled={!selectedUserId || busyKey !== null}
                        onClick={() => void handleGrantByUser()}
                        className="h-10 shrink-0 rounded-xl bg-brand px-3.5 text-xs font-bold text-primary-foreground"
                      >
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                        {busyKey === "grant-user" ? "Granting…" : "Make Admin"}
                      </Button>
                    </div>
                  </div>
                )}

                <form onSubmit={(e) => void handleGrantByEmail(e)}>
                  <label
                    htmlFor="grant-admin-email"
                    className="mb-1.5 block text-xs font-semibold text-foreground"
                  >
                    Or Grant Admin by Email Address
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="grant-admin-email"
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="name@gmail.com"
                      className="h-10 min-w-0 flex-1 rounded-xl bg-background text-sm"
                    />
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={!emailInput.trim() || busyKey !== null}
                      className="h-10 shrink-0 rounded-xl px-3.5 text-xs font-bold"
                    >
                      <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                      {busyKey === "grant-email" ? "Adding…" : "Add Admin"}
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
