import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  ADMIN_ACCESS_SETTING_KEY,
  SUPER_ADMIN_EMAIL,
  addAdminGrant,
  isSuperAdminEmail,
  normalizeEmail,
  parseAdminAccessState,
  removeAdminGrant,
  type AdminAccessStateV1,
} from "@/lib/admin-access";

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

function hasLiveAdminDb() {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

async function assertAdmin(context: AuthContext): Promise<{ email: string; isSuperAdmin: boolean }> {
  const [{ data: hasAdminRole, error: roleErr }, { data: userRes, error: userErr }] =
    await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.auth.getUser(),
    ]);
  if (roleErr || !hasAdminRole || userErr || !userRes.user) {
    throw new Error("Forbidden");
  }
  const email = normalizeEmail(userRes.user.email);
  const emailVerified = Boolean(userRes.user.email_confirmed_at);
  return {
    email,
    isSuperAdmin: emailVerified && isSuperAdminEmail(email),
  };
}

async function assertSuperAdmin(context: AuthContext): Promise<{ email: string }> {
  const { email, isSuperAdmin } = await assertAdmin(context);
  if (!isSuperAdmin) {
    throw new Error("Only the Super Admin can grant or revoke admin access.");
  }
  return { email };
}

async function readAccessState(client: SupabaseClient<Database>): Promise<AdminAccessStateV1> {
  const { data } = await client
    .from("app_settings")
    .select("value")
    .eq("key", ADMIN_ACCESS_SETTING_KEY)
    .maybeSingle();
  return parseAdminAccessState(data?.value);
}

async function saveAccessState(
  client: SupabaseClient<Database>,
  nextState: AdminAccessStateV1,
): Promise<void> {
  const { error } = await client
    .from("app_settings")
    .upsert(
      { key: ADMIN_ACCESS_SETTING_KEY, value: JSON.stringify(nextState) },
      { onConflict: "key" },
    );
  if (error) throw new Error(error.message);
}

export type AdminTeamMember = {
  userId?: string | undefined;
  email: string;
  name: string;
  phone: string | null;
  isSuperAdmin: boolean;
  hasDbRole: boolean;
  pendingSignup: boolean;
  grantedAt?: string | undefined;
};

export type AdminCandidateUser = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
};

export type AdminAccessSnapshot = {
  callerIsSuperAdmin: boolean;
  superAdminEmail: string;
  hasServiceRole: boolean;
  admins: AdminTeamMember[];
  candidates: AdminCandidateUser[];
};

export const listAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminAccessSnapshot> => {
    const { isSuperAdmin: callerIsSuperAdmin } = await assertAdmin(context);
    const serviceAvailable = hasLiveAdminDb();

    const [{ data: roleRows }, { data: profileRows }, accessState] = await Promise.all([
      context.supabase.from("user_roles").select("user_id, role").eq("role", "admin"),
      context.supabase
        .from("profiles")
        .select("id, full_name, phone_number")
        .order("created_at", { ascending: false })
        .limit(300),
      readAccessState(context.supabase),
    ]);

    const authEmailByUserId = new Map<string, string>();
    const authNameByUserId = new Map<string, string>();

    if (serviceAvailable) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: listed } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 500,
        });
        for (const u of listed?.users ?? []) {
          if (u.email) authEmailByUserId.set(u.id, normalizeEmail(u.email));
          const metaName =
            typeof u.user_metadata?.["full_name"] === "string"
              ? u.user_metadata["full_name"]
              : typeof u.user_metadata?.["name"] === "string"
                ? u.user_metadata["name"]
                : "";
          if (metaName.trim()) authNameByUserId.set(u.id, metaName.trim());
        }
      } catch {
        // Fallback to profiles + accessState metadata if auth admin listing fails
      }
    }

    const profileMap = new Map(
      (profileRows ?? []).map((p) => [
        p.id,
        {
          name: p.full_name?.trim() || authNameByUserId.get(p.id) || "User",
          phone: p.phone_number ?? null,
        },
      ]),
    );

    const dbAdminIds = new Set((roleRows ?? []).map((r) => r.user_id));
    const grantByUserId = new Map(
      accessState.admins.filter((a) => a.userId).map((a) => [a.userId as string, a]),
    );

    const admins: AdminTeamMember[] = [];
    const seenAdminIds = new Set<string>();
    const seenAdminEmails = new Set<string>();

    // 1. Always surface Super Admin at the top (protected)
    let superAdminUserId: string | undefined;
    for (const [uid, email] of authEmailByUserId.entries()) {
      if (isSuperAdminEmail(email)) {
        superAdminUserId = uid;
        break;
      }
    }
    const superProfile = superAdminUserId ? profileMap.get(superAdminUserId) : undefined;
    admins.push({
      ...(superAdminUserId ? { userId: superAdminUserId } : {}),
      email: SUPER_ADMIN_EMAIL,
      name: superProfile?.name || "Super Admin",
      phone: superProfile?.phone ?? null,
      isSuperAdmin: true,
      hasDbRole: true,
      pendingSignup: false,
    });
    if (superAdminUserId) seenAdminIds.add(superAdminUserId);
    seenAdminEmails.add(SUPER_ADMIN_EMAIL);

    // 2. All DB-level admin rows from public.user_roles
    for (const uid of dbAdminIds) {
      if (seenAdminIds.has(uid)) continue;
      const grant = grantByUserId.get(uid);
      const email = authEmailByUserId.get(uid) || grant?.email || "";
      if (isSuperAdminEmail(email)) continue;
      const profile = profileMap.get(uid);
      admins.push({
        userId: uid,
        email,
        name: profile?.name || grant?.name || "Admin",
        phone: profile?.phone ?? null,
        isSuperAdmin: false,
        hasDbRole: true,
        pendingSignup: false,
        grantedAt: grant?.grantedAt,
      });
      seenAdminIds.add(uid);
      if (email) seenAdminEmails.add(email);
    }

    // 3. Registry entries that haven't signed up yet or are awaiting service-role sync
    for (const grant of accessState.admins) {
      if (grant.userId && seenAdminIds.has(grant.userId)) continue;
      if (grant.email && seenAdminEmails.has(grant.email)) continue;
      if (isSuperAdminEmail(grant.email)) continue;
      const profile = grant.userId ? profileMap.get(grant.userId) : undefined;
      admins.push({
        ...(grant.userId ? { userId: grant.userId } : {}),
        email: grant.email,
        name: profile?.name || grant.name || grant.email || "Pending Admin",
        phone: profile?.phone ?? null,
        isSuperAdmin: false,
        hasDbRole: false,
        pendingSignup: !grant.userId,
        grantedAt: grant.grantedAt,
      });
      if (grant.userId) seenAdminIds.add(grant.userId);
      if (grant.email) seenAdminEmails.add(grant.email);
    }

    // 4. Candidate non-admin registered users Super Admin can promote with 1 click
    const candidates: AdminCandidateUser[] = (profileRows ?? []).map((p) => {
      const email = authEmailByUserId.get(p.id) || grantByUserId.get(p.id)?.email || "";
      const isSuper = isSuperAdminEmail(email);
      const isAdmin = isSuper || seenAdminIds.has(p.id);
      return {
        userId: p.id,
        name: p.full_name?.trim() || authNameByUserId.get(p.id) || "User",
        email,
        phone: p.phone_number ?? null,
        isAdmin,
        isSuperAdmin: isSuper,
      };
    });

    return {
      callerIsSuperAdmin,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      hasServiceRole: serviceAvailable,
      admins,
      candidates,
    };
  });

const adminTargetSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .refine((v) => Boolean(v.userId || v.email), {
    message: "Choose a registered user or enter an email address.",
  });

export const grantAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof adminTargetSchema>) => adminTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { email: callerEmail } = await assertSuperAdmin(context);
    const requestedEmail = normalizeEmail(data.email);
    if (isSuperAdminEmail(requestedEmail)) {
      throw new Error("This account is already the Super Admin.");
    }

    let resolvedUserId = data.userId;
    let resolvedEmail = requestedEmail;
    let resolvedName: string | undefined;
    let syncedToDatabaseRoles = false;

    if (hasLiveAdminDb()) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (resolvedUserId) {
        const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(resolvedUserId);
        if (userRes?.user) {
          resolvedEmail = normalizeEmail(userRes.user.email) || resolvedEmail;
          const metaName =
            typeof userRes.user.user_metadata?.["full_name"] === "string"
              ? userRes.user.user_metadata["full_name"]
              : undefined;
          if (metaName?.trim()) resolvedName = metaName.trim();
        }
      } else if (resolvedEmail) {
        const { data: listed } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const match = (listed?.users ?? []).find(
          (u) => normalizeEmail(u.email) === resolvedEmail,
        );
        if (match) {
          resolvedUserId = match.id;
          const metaName =
            typeof match.user_metadata?.["full_name"] === "string"
              ? match.user_metadata["full_name"]
              : undefined;
          if (metaName?.trim()) resolvedName = metaName.trim();
        }
      }

      if (isSuperAdminEmail(resolvedEmail)) {
        throw new Error("This account is already the Super Admin.");
      }

      if (resolvedUserId) {
        const { error: insertErr } = await supabaseAdmin
          .from("user_roles")
          .upsert(
            { user_id: resolvedUserId, role: "admin" },
            { onConflict: "user_id,role", ignoreDuplicates: true },
          );
        if (insertErr) throw new Error(insertErr.message);
        syncedToDatabaseRoles = true;
      }
    }

    if (resolvedUserId && !resolvedName) {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("full_name")
        .eq("id", resolvedUserId)
        .maybeSingle();
      if (prof?.full_name?.trim()) resolvedName = prof.full_name.trim();
    }

    const currentState = await readAccessState(context.supabase);
    const nextState = addAdminGrant(currentState, {
      userId: resolvedUserId,
      email: resolvedEmail || undefined,
      name: resolvedName,
      grantedBy: callerEmail,
    });
    await saveAccessState(context.supabase, nextState);

    return {
      ok: true,
      syncedToDatabaseRoles,
      pendingSignup: !resolvedUserId,
      email: resolvedEmail,
      userId: resolvedUserId ?? null,
    };
  });

export const revokeAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof adminTargetSchema>) => adminTargetSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const requestedEmail = normalizeEmail(data.email);
    if (isSuperAdminEmail(requestedEmail)) {
      throw new Error("Super Admin cannot be removed.");
    }

    let targetUserId = data.userId;
    let targetEmail = requestedEmail;
    let syncedToDatabaseRoles = false;

    // Never allow Super Admin to remove themselves
    if (targetUserId && targetUserId === context.userId) {
      throw new Error("Super Admin cannot be removed.");
    }

    if (hasLiveAdminDb()) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (targetUserId) {
        const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
        const realEmail = normalizeEmail(userRes?.user?.email);
        if (isSuperAdminEmail(realEmail)) {
          throw new Error("Super Admin cannot be removed.");
        }
        if (realEmail) targetEmail = realEmail;
      } else if (targetEmail) {
        const { data: listed } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        const match = (listed?.users ?? []).find(
          (u) => normalizeEmail(u.email) === targetEmail,
        );
        if (match) targetUserId = match.id;
      }

      if (isSuperAdminEmail(targetEmail) || (targetUserId && targetUserId === context.userId)) {
        throw new Error("Super Admin cannot be removed.");
      }

      if (targetUserId) {
        const { error: delErr } = await supabaseAdmin
          .from("user_roles")
          .delete()
          .eq("user_id", targetUserId)
          .eq("role", "admin");
        if (delErr) throw new Error(delErr.message);
        syncedToDatabaseRoles = true;
      }
    }

    const currentState = await readAccessState(context.supabase);
    const nextState = removeAdminGrant(currentState, {
      userId: targetUserId,
      email: targetEmail || undefined,
    });
    await saveAccessState(context.supabase, nextState);

    return { ok: true, syncedToDatabaseRoles };
  });

/**
 * When a user signs in with a verified email that Super Admin pre-authorized in
 * `admin_access_v1`, promote them into `public.user_roles` automatically.
 */
export const syncMyPendingAdminRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!hasLiveAdminDb()) return { promoted: false };
    const { data: userRes } = await context.supabase.auth.getUser();
    const user = userRes?.user;
    if (!user || !user.email_confirmed_at) return { promoted: false };
    const email = normalizeEmail(user.email);
    if (!email || isSuperAdminEmail(email)) return { promoted: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const state = await readAccessState(supabaseAdmin);
    const match = state.admins.find(
      (a) =>
        (a.userId && a.userId === user.id) ||
        (a.email && normalizeEmail(a.email) === email),
    );
    if (!match) return { promoted: false };

    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: user.id, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) return { promoted: false };

    if (!match.userId) {
      const updated = addAdminGrant(state, {
        userId: user.id,
        email,
        name: match.name,
        grantedBy: match.grantedBy,
        nowIso: match.grantedAt,
      });
      await saveAccessState(supabaseAdmin, updated).catch(() => undefined);
    }

    return { promoted: true };
  });
