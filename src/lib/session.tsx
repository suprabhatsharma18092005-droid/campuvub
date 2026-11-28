import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { syncMyPendingAdminRole } from "@/lib/admin-access.functions";

const pendingRoleSyncedUsers = new Set<string>();

const SessionContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    void supabase.auth.getSession().then(({ data: got }) => {
      setSession(got.session);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

export type Profile = {
  id: string;
  full_name: string | null;
  phone_number: string | null;
  hostel_details: string | null;
  room_number: string | null;
  fcm_token?: string | null;
};

export function useProfile() {
  const { session } = useSession();
  const userId = session?.user.id;

  return useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone_number, hostel_details, room_number, fcm_token")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function isProfileComplete(profile: Profile | null | undefined) {
  return Boolean(profile?.phone_number && profile?.hostel_details && profile?.room_number);
}

export function useRoles() {
  const { session } = useSession();
  const userId = session?.user.id;
  const syncPendingAdmin = useServerFn(syncMyPendingAdminRole);

  return useQuery({
    queryKey: ["roles", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId!);
      if (error) throw error;
      const roles = (data ?? []).map((r) => r.role as string);

      if (userId && !roles.includes("admin") && !pendingRoleSyncedUsers.has(userId)) {
        pendingRoleSyncedUsers.add(userId);
        try {
          const result = await syncPendingAdmin();
          if (result?.promoted) {
            const { data: refreshed } = await supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", userId);
            return (refreshed ?? []).map((r) => r.role as string);
          }
        } catch {
          // Non-fatal; standard roles remain active
        }
      }

      return roles;
    },
  });
}
