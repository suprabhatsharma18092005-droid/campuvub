export const SUPER_ADMIN_EMAIL = "sumit.workplac@gmail.com";
export const ADMIN_ACCESS_SETTING_KEY = "admin_access_v1";
export const STORE_NAME_SETTING_KEY = "store_name";
export const MAX_STORE_NAME_LENGTH = 60;

export function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function isSuperAdminEmail(email?: string | null): boolean {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

export function getStoreName(settings?: Record<string, string> | null): string {
  const raw = settings?.[STORE_NAME_SETTING_KEY]?.trim() ?? "";
  if (!raw) return "";
  return raw.slice(0, MAX_STORE_NAME_LENGTH);
}

export type AdminGrantRecord = {
  userId?: string | undefined;
  email: string;
  name?: string | undefined;
  grantedAt: string;
  grantedBy: string;
};

export type AdminAccessStateV1 = {
  version: 1;
  admins: AdminGrantRecord[];
  updatedAt: string;
};

export function emptyAdminAccessState(): AdminAccessStateV1 {
  return {
    version: 1,
    admins: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseAdminAccessState(raw?: string | null): AdminAccessStateV1 {
  if (!raw) return emptyAdminAccessState();
  try {
    const parsed = JSON.parse(raw) as Partial<AdminAccessStateV1>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.admins)) {
      return emptyAdminAccessState();
    }
    const admins: AdminGrantRecord[] = [];
    const seen = new Set<string>();
    for (const item of parsed.admins) {
      if (!item || typeof item !== "object") continue;
      const email = normalizeEmail(item.email);
      const userId = typeof item.userId === "string" && item.userId.trim() ? item.userId.trim() : undefined;
      if (!email && !userId) continue;
      if (isSuperAdminEmail(email)) continue;
      const dedupeKey = userId || email;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      admins.push({
        ...(userId ? { userId } : {}),
        email,
        ...(typeof item.name === "string" && item.name.trim() ? { name: item.name.trim() } : {}),
        grantedAt: typeof item.grantedAt === "string" ? item.grantedAt : new Date(0).toISOString(),
        grantedBy: typeof item.grantedBy === "string" ? item.grantedBy : SUPER_ADMIN_EMAIL,
      });
    }
    return {
      version: 1,
      admins,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyAdminAccessState();
  }
}

export function addAdminGrant(
  state: AdminAccessStateV1,
  entry: {
    userId?: string | undefined;
    email?: string | undefined;
    name?: string | undefined;
    grantedBy: string;
    nowIso?: string | undefined;
  },
): AdminAccessStateV1 {
  const email = normalizeEmail(entry.email);
  const userId = entry.userId?.trim() || undefined;
  if (!email && !userId) {
    throw new Error("Provide a valid user or email address.");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  if (isSuperAdminEmail(email)) {
    throw new Error("This account is already the Super Admin.");
  }

  const nowIso = entry.nowIso ?? new Date().toISOString();
  const filtered = state.admins.filter((a) => {
    if (userId && a.userId && a.userId === userId) return false;
    if (email && a.email && normalizeEmail(a.email) === email) return false;
    return true;
  });

  return {
    version: 1,
    admins: [
      {
        ...(userId ? { userId } : {}),
        email,
        ...(entry.name?.trim() ? { name: entry.name.trim() } : {}),
        grantedAt: nowIso,
        grantedBy: normalizeEmail(entry.grantedBy) || SUPER_ADMIN_EMAIL,
      },
      ...filtered,
    ],
    updatedAt: nowIso,
  };
}

export function removeAdminGrant(
  state: AdminAccessStateV1,
  target: {
    userId?: string | undefined;
    email?: string | undefined;
    nowIso?: string | undefined;
  },
): AdminAccessStateV1 {
  const email = normalizeEmail(target.email);
  const userId = target.userId?.trim() || undefined;

  if (isSuperAdminEmail(email)) {
    throw new Error("Super Admin cannot be removed.");
  }

  const nowIso = target.nowIso ?? new Date().toISOString();
  const nextAdmins = state.admins.filter((a) => {
    if (userId && a.userId && a.userId === userId) return false;
    if (email && a.email && normalizeEmail(a.email) === email) return false;
    return true;
  });

  return {
    version: 1,
    admins: nextAdmins,
    updatedAt: nowIso,
  };
}
