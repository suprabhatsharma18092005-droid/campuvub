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

/**
 * VIP membership is currently disabled on the user site; returns an inactive
 * VIP state without querying `vip_subscriptions` or opening realtime channels.
 */
export function useVip() {
  const { session } = useSession();
  const uid = session?.user.id;
  const dismissCelebration = useCallback(() => {}, []);
  const refetch = useCallback(
    async () => ({ data: { rows: [] as VipRow[], freeUsedToday: 0 } }),
    [],
  );

  return {
    loading: false,
    signedIn: Boolean(uid),
    isVip: false,
    startsAt: null as string | null,
    expiresAt: null as string | null,
    wasMember: false,
    pending: null as VipRow | null,
    freeUsedToday: 0,
    justApproved: false,
    dismissCelebration,
    refetch,
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
  const isAdmin = Boolean(
    roles?.includes("admin") ||
      session?.user.email?.toLowerCase() === ADMIN_EMAIL,
  );
  return {
    isRoyal: isAdmin,
    isAdmin,
    isVip: false,
  };
}

export function useRoyalTheme(): RoyalThemeState {
  return useContext(RoyalThemeContext);
}
