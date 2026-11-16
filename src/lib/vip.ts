import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useRoles, useSession } from "@/lib/session";

export const ADMIN_EMAIL = "sumit.workplac@gmail.com";

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

type VipChannelEntry = {
  count: number;
  channel: ReturnType<typeof supabase.channel>;
};

const vipChannels = new Map<string, VipChannelEntry>();
const approvedThisSession = new Map<string, boolean>();
const celebrationListeners = new Map<string, Set<() => void>>();

function notifyCelebration(uid: string) {
  approvedThisSession.set(uid, true);
  const listeners = celebrationListeners.get(uid);
  if (listeners) {
    for (const l of listeners) l();
  }
}

export function clearVipCelebration(uid: string) {
  approvedThisSession.set(uid, false);
  const listeners = celebrationListeners.get(uid);
  if (listeners) {
    for (const l of listeners) l();
  }
}

/** Signed-in student's VIP state: active membership, pending request, realtime approval transition, and daily free quick deliveries used. */
export function useVip() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const uid = session?.user.id;
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [justApproved, setJustApproved] = useState<boolean>(() =>
    uid ? Boolean(approvedThisSession.get(uid)) : false,
  );

  const q = useQuery({
    queryKey: ["vip", uid],
    enabled: Boolean(uid),
    queryFn: async () => {
      const [subs, used] = await Promise.all([
        supabase
          .from("vip_subscriptions")
          .select("id, status, amount, utr_number, starts_at, expires_at, created_at")
          .eq("user_id", uid!)
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("student_id", uid!)
          .eq("delivery_type", "quick")
          .eq("delivery_fee", 0)
          .neq("status", "cancelled")
          .gte("created_at", istDayStart()),
      ]);
      if (subs.error) throw subs.error;
      return { rows: (subs.data ?? []) as VipRow[], freeUsedToday: used.count ?? 0 };
    },
  });

  // Subscribe to student's celebration state changes across all mounted useVip hooks.
  useEffect(() => {
    if (!uid) {
      setJustApproved(false);
      return;
    }
    setJustApproved(Boolean(approvedThisSession.get(uid)));
    let set = celebrationListeners.get(uid);
    if (!set) {
      set = new Set();
      celebrationListeners.set(uid, set);
    }
    const sync = () => setJustApproved(Boolean(approvedThisSession.get(uid)));
    set.add(sync);
    return () => {
      set?.delete(sync);
      if (set && set.size === 0) celebrationListeners.delete(uid);
    };
  }, [uid]);

  // Ref-counted single Supabase Realtime subscription on vip_subscriptions for this student.
  useEffect(() => {
    if (!uid) return;
    const existing = vipChannels.get(uid);
    if (existing) {
      existing.count += 1;
    } else {
      const channel = supabase
        .channel(`vip-live-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "vip_subscriptions", filter: `user_id=eq.${uid}` },
          (payload) => {
            const nextRow = payload.new as Partial<VipRow> | undefined;
            const prevRow = payload.old as Partial<VipRow> | undefined;
            if (nextRow?.status === "approved" && prevRow?.status !== "approved") {
              notifyCelebration(uid);
              toast.success("👑 Campu Royal VIP Activated! Enjoy free quick deliveries!", {
                duration: 6000,
              });
            }
            void queryClient.invalidateQueries({ queryKey: ["vip", uid] });
          },
        )
        .subscribe();
      vipChannels.set(uid, { count: 1, channel });
    }
    return () => {
      const entry = vipChannels.get(uid);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) {
        vipChannels.delete(uid);
        void supabase.removeChannel(entry.channel);
      }
    };
  }, [queryClient, uid]);

  const rows = q.data?.rows ?? [];
  const approved = rows.filter((r) => r.status === "approved" && r.expires_at);
  const active =
    approved.find(
      (r) =>
        (!r.starts_at || new Date(r.starts_at).getTime() <= nowTick) &&
        new Date(r.expires_at!).getTime() > nowTick,
    ) ?? null;
  const expiresAt = approved.reduce<string | null>(
    (m, r) => (!m || r.expires_at! > m ? r.expires_at : m),
    null,
  );
  const pending = rows.find((r) => r.status === "pending") ?? null;
  const isVip = Boolean(active);

  // Detect transition from pending -> approved even if realtime fired before listener saw old.status.
  const prevStateRef = useRef<{ hadPending: boolean; wasActive: boolean }>({
    hadPending: false,
    wasActive: false,
  });
  useEffect(() => {
    if (!uid || q.isLoading) return;
    const prev = prevStateRef.current;
    if (prev.hadPending && !prev.wasActive && isVip) {
      notifyCelebration(uid);
    }
    if (prev.wasActive && !isVip && approved.length > 0 && typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem("campu.vip-popup-seen");
      } catch {
        /* ignore */
      }
    }
    prevStateRef.current = { hadPending: Boolean(pending), wasActive: isVip };
  }, [uid, q.isLoading, isVip, pending, approved.length]);

  // Exact expiry timer + focus/visibility re-check so expired VIP immediately restores banners/popups.
  useEffect(() => {
    if (!active?.expires_at) return;
    const expiryMs = new Date(active.expires_at).getTime();
    const refreshNow = () => setNowTick(Date.now());
    const delay = Math.max(250, expiryMs - Date.now() + 250);
    const timer =
      delay <= 2_147_483_647 ? window.setTimeout(refreshNow, delay) : undefined;
    window.addEventListener("focus", refreshNow);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshNow();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active?.expires_at]);

  const dismissCelebration = useCallback(() => {
    if (uid) clearVipCelebration(uid);
  }, [uid]);

  return {
    loading: q.isLoading,
    signedIn: Boolean(uid),
    isVip,
    startsAt: active?.starts_at ?? null,
    expiresAt: active ? expiresAt : null,
    wasMember: approved.length > 0,
    pending,
    freeUsedToday: q.data?.freeUsedToday ?? 0,
    justApproved,
    dismissCelebration,
    refetch: q.refetch,
  };
}

export type RoyalThemeState = {
  isRoyal: boolean;
  isAdmin: boolean;
  isVip: boolean;
};

export const RoyalThemeContext = createContext<RoyalThemeState>({
  isRoyal: false,
  isAdmin: false,
  isVip: false,
});

export function useRoyalThemeState(): RoyalThemeState {
  const { session } = useSession();
  const { data: roles } = useRoles();
  const vip = useVip();
  const isAdmin = Boolean(
    roles?.includes("admin") ||
      session?.user.email?.toLowerCase() === ADMIN_EMAIL,
  );
  return {
    isRoyal: isAdmin || vip.isVip,
    isAdmin,
    isVip: vip.isVip,
  };
}

export function useRoyalTheme(): RoyalThemeState {
  return useContext(RoyalThemeContext);
}
