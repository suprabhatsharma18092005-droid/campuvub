import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const MOCK_SESSION_KEY = "campu_mock_session_v1";

interface MockUser {
  id: string;
  email: string;
  user_metadata: { full_name?: string };
}

interface MockSession {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_token: string;
  user: MockUser;
}

const DEFAULT_CATEGORIES: Row[] = [
  { id: "cat-snacks", name: "Snacks", emoji: "🍿", image_url: null, sort_order: 1 },
  { id: "cat-drinks", name: "Drinks", emoji: "🥤", image_url: null, sort_order: 2 },
  { id: "cat-noodles", name: "Noodles & Meals", emoji: "🍜", image_url: null, sort_order: 3 },
  { id: "cat-stationery", name: "Essentials", emoji: "📓", image_url: null, sort_order: 4 },
];

const DEFAULT_SUBCATEGORIES: Row[] = [
  {
    id: "sub-chips",
    category_id: "cat-snacks",
    name: "Chips & Crunch",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "sub-biscuits",
    category_id: "cat-snacks",
    name: "Cookies & Chocolates",
    image_url: null,
    sort_order: 2,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "sub-soda",
    category_id: "cat-drinks",
    name: "Cold Drinks",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "sub-energy",
    category_id: "cat-drinks",
    name: "Coffee & Energy",
    image_url: null,
    sort_order: 2,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "sub-ramen",
    category_id: "cat-noodles",
    name: "Instant Noodles",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "sub-notes",
    category_id: "cat-stationery",
    name: "Notebooks & Pens",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const DEFAULT_BRANDS: Row[] = [
  {
    id: "brand-lays",
    subcategory_id: "sub-chips",
    category_id: "cat-snacks",
    name: "Lay's",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "brand-maggi",
    subcategory_id: "sub-ramen",
    category_id: "cat-noodles",
    name: "Maggi",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "brand-coke",
    subcategory_id: "sub-soda",
    category_id: "cat-drinks",
    name: "Coca-Cola",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "brand-classmate",
    subcategory_id: "sub-notes",
    category_id: "cat-stationery",
    name: "Classmate",
    image_url: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const DEFAULT_PRODUCTS: Row[] = [
  {
    id: "11111111-1111-4111-8111-111111111101",
    name: "Lay's India's Magic Masala",
    description: "Crispy classic masala potato chips for late-night hostel cravings.",
    price: 20,
    actual_price: 25,
    badge_text: "Bestseller",
    specs_text: "50 g pack",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-snacks",
    subcategory_id: "sub-chips",
    brand_id: "brand-lays",
    stock_quantity: 40,
    delivery_types: ["quick", "sunday_tuesday"],
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111102",
    name: "Maggi 2-Minute Masala Noodles",
    description: "Single pack instant masala noodles ready in minutes.",
    price: 14,
    actual_price: 15,
    badge_text: "Hostel Staple",
    specs_text: "70 g pack",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-noodles",
    subcategory_id: "sub-ramen",
    brand_id: "brand-maggi",
    stock_quantity: 55,
    delivery_types: ["quick", "sunday_tuesday"],
    created_at: "2026-01-01T00:01:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111103",
    name: "Coca-Cola Chilled Can",
    description: "Ice-cold sparkling cola delivered straight to your hostel room.",
    price: 40,
    actual_price: 45,
    badge_text: "Chilled",
    specs_text: "300 ml can",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-drinks",
    subcategory_id: "sub-soda",
    brand_id: "brand-coke",
    stock_quantity: 30,
    delivery_types: ["quick"],
    created_at: "2026-01-01T00:02:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111104",
    name: "Dark Fantasy Choco Fills",
    description: "Rich molten chocolate center inside crisp baked cookies.",
    price: 35,
    actual_price: 40,
    badge_text: null,
    specs_text: "75 g pack",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-snacks",
    subcategory_id: "sub-biscuits",
    brand_id: null,
    stock_quantity: 25,
    delivery_types: ["quick", "sunday_tuesday"],
    created_at: "2026-01-01T00:03:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111105",
    name: "Cold Coffee Bottle",
    description: "Smooth café-style iced coffee for exam prep nights.",
    price: 55,
    actual_price: 65,
    badge_text: "Night Study",
    specs_text: "250 ml bottle",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-drinks",
    subcategory_id: "sub-energy",
    brand_id: null,
    stock_quantity: 18,
    delivery_types: ["quick"],
    created_at: "2026-01-01T00:04:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111106",
    name: "Classmate Spiral Notebook",
    description: "Single-subject ruled A4 notebook with smooth 70 GSM pages.",
    price: 75,
    actual_price: 90,
    badge_text: "Campus Value",
    specs_text: "180 pages · A4",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-stationery",
    subcategory_id: "sub-notes",
    brand_id: "brand-classmate",
    stock_quantity: 22,
    delivery_types: ["quick", "sunday_tuesday"],
    created_at: "2026-01-01T00:05:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111107",
    name: "Maggi Family Multipack (6x)",
    description: "Value 6-pack bundle for Sunday & Tuesday hostel restocks.",
    price: 78,
    actual_price: 90,
    badge_text: "Save ₹12",
    specs_text: "420 g bundle",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-noodles",
    subcategory_id: "sub-ramen",
    brand_id: "brand-maggi",
    stock_quantity: 15,
    delivery_types: ["sunday_tuesday"],
    created_at: "2026-01-01T00:06:00Z",
  },
  {
    id: "11111111-1111-4111-8111-111111111108",
    name: "Ballpoint Pen Pack (Blue, 5 pcs)",
    description: "Smooth-flow low-viscosity ink pens for assignments and exams.",
    price: 45,
    actual_price: 50,
    badge_text: null,
    specs_text: "Pack of 5",
    tagline: null,
    image_url: null,
    image_path: null,
    in_stock: true,
    category_id: "cat-stationery",
    subcategory_id: "sub-notes",
    brand_id: "brand-classmate",
    stock_quantity: 35,
    delivery_types: ["quick", "sunday_tuesday"],
    created_at: "2026-01-01T00:07:00Z",
  },
];

const DEFAULT_SETTINGS: Row[] = [
  { key: "upi_delivery_charge", value: "5" },
  { key: "night_upi_delivery_charge", value: "5" },
  { key: "cod_delivery_charge", value: "8" },
  { key: "upi_id", value: "campu@upi" },
  { key: "night_mode_enabled", value: "false" },
  { key: "order_start_time", value: "" },
  { key: "sunday_tuesday_delivery_time", value: "10:00" },
  { key: "quick_delivery_estimate", value: "15–20 min" },
  { key: "vip_price", value: "149" },
  { key: "app_theme_color", value: "emerald" },
];

const tables: Record<string, Row[]> = {
  categories: [...DEFAULT_CATEGORIES],
  subcategories: [...DEFAULT_SUBCATEGORIES],
  brands: [...DEFAULT_BRANDS],
  products: [...DEFAULT_PRODUCTS],
  banners: [],
  app_settings: [...DEFAULT_SETTINGS],
  orders: [],
  profiles: [],
  user_roles: [],
  vip_subscriptions: [],
  suggestions: [],
  broadcasts: [],
  push_devices: [],
};

type RealtimeSub = {
  event: string;
  table: string;
  filter?: string | undefined;
  cb: (payload: { eventType: string; table: string; new: Row; old: Row }) => void;
};

const storageFiles = new Map<string, string>();
const authListeners = new Set<(event: string, session: MockSession | null) => void>();
const realtimeSubs = new Map<string, RealtimeSub[]>();
let memorySession: MockSession | null = null;

function matchesFilter(row: Row, filter?: string): boolean {
  if (!filter) return true;
  const eqMatch = /^([^=]+)=eq\.(.+)$/.exec(filter);
  if (!eqMatch) return true;
  const col = eqMatch[1]!.trim();
  const val = eqMatch[2]!.trim();
  return String(row[col] ?? "") === val;
}

function emitRealtime(eventType: "INSERT" | "UPDATE" | "DELETE", table: string, nextRow: Row, oldRow: Row) {
  const target = eventType === "DELETE" ? oldRow : nextRow;
  for (const subs of realtimeSubs.values()) {
    for (const sub of subs) {
      if (sub.table !== table) continue;
      if (sub.event !== "*" && sub.event !== eventType) continue;
      if (!matchesFilter(target, sub.filter)) continue;
      queueMicrotask(() => {
        try {
          sub.cb({ eventType, table, new: { ...nextRow }, old: { ...oldRow } });
        } catch {
          /* ignore listener error */
        }
      });
    }
  }
}

function readStoredSession(): MockSession | null {
  if (typeof window === "undefined") return memorySession;
  try {
    const raw = window.localStorage.getItem(MOCK_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MockSession;
  } catch {
    return memorySession;
  }
}

function writeStoredSession(session: MockSession | null) {
  memorySession = session;
  if (typeof window !== "undefined") {
    try {
      if (session) window.localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(MOCK_SESSION_KEY);
    } catch {
      /* ignore storage quota issues */
    }
  }
}

function makeMockToken(userId: string, email: string): string {
  const encode = (obj: object) => {
    const json = JSON.stringify(obj);
    return typeof btoa === "function"
      ? btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      : Buffer.from(json).toString("base64url");
  };
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: userId, email })}.mock`;
}

export function parseMockBearerToken(token: string): { sub: string; email?: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[2] !== "mock") return null;
  try {
    const payload = parts[1] ?? "";
    const json =
      typeof atob === "function"
        ? atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        : Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as { sub?: unknown; email?: unknown };
    if (typeof parsed.sub !== "string" || !parsed.sub) return null;
    return {
      sub: parsed.sub,
      ...(typeof parsed.email === "string" ? { email: parsed.email } : {}),
    };
  } catch {
    return null;
  }
}

function ensureUserRecords(user: MockUser) {
  const profiles = tables["profiles"]!;
  if (!profiles.some((p) => p["id"] === user.id)) {
    profiles.push({
      id: user.id,
      full_name: user.user_metadata.full_name ?? user.email.split("@")[0] ?? "Student",
      phone_number: null,
      hostel_details: null,
      room_number: null,
      ban_status: null,
      fcm_token: null,
      created_at: new Date().toISOString(),
    });
  }
  const roles = tables["user_roles"]!;
  if (!roles.some((r) => r["user_id"] === user.id && r["role"] === "student")) {
    roles.push({ id: crypto.randomUUID(), user_id: user.id, role: "student" });
  }
  if (
    user.email.toLowerCase() === "sumit.workplac@gmail.com" &&
    !roles.some((r) => r["user_id"] === user.id && r["role"] === "admin")
  ) {
    roles.push({ id: crypto.randomUUID(), user_id: user.id, role: "admin" });
  }
}

function createSessionForEmail(email: string, fullName?: string): MockSession {
  const normalized = email.trim().toLowerCase();
  const id = `mock-${normalized.replace(/[^a-z0-9]/g, "-")}`;
  const user: MockUser = {
    id,
    email: normalized,
    user_metadata: fullName ? { full_name: fullName } : {},
  };
  ensureUserRecords(user);
  return {
    access_token: makeMockToken(id, normalized),
    token_type: "bearer",
    expires_in: 3600 * 24,
    refresh_token: `refresh-${id}`,
    user,
  };
}

function notifyAuth(event: string, session: MockSession | null) {
  for (const listener of authListeners) {
    try {
      listener(event, session);
    } catch {
      /* ignore listener error */
    }
  }
}

function projectRow(row: Row, selectSpec: string | undefined): Row {
  if (!selectSpec || selectSpec.trim() === "*") return { ...row };
  const cols = selectSpec
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const out: Row = {};
  for (const col of cols) {
    if (col in row) out[col] = row[col];
  }
  return out;
}

class MockQueryBuilder {
  private table: string;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private selectSpec: string | undefined;
  private countMode = false;
  private headMode = false;
  private payload: Row | Row[] | null = null;
  private onConflictKey: string | undefined;
  private filters: Filter[] = [];
  private orders: { col: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private returnMode: "many" | "single" | "maybeSingle" = "many";

  constructor(table: string) {
    this.table = table;
    if (!tables[table]) tables[table] = [];
  }

  select(columns?: string, options?: { count?: "exact"; head?: boolean }) {
    if (this.op === "select") this.op = "select";
    this.selectSpec = columns;
    if (options?.count === "exact") this.countMode = true;
    if (options?.head) this.headMode = true;
    return this;
  }

  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = values;
    return this;
  }

  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = values;
    this.onConflictKey = options?.onConflict ?? "id";
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val);
    return this;
  }

  neq(col: string, val: unknown) {
    this.filters.push((row) => row[col] !== val);
    return this;
  }

  in(col: string, vals: unknown[]) {
    const set = new Set(vals);
    this.filters.push((row) => set.has(row[col]));
    return this;
  }

  gte(col: string, val: string | number) {
    this.filters.push((row) => {
      const v = row[col];
      return v != null && (v as string | number) >= val;
    });
    return this;
  }

  lte(col: string, val: string | number) {
    this.filters.push((row) => {
      const v = row[col];
      return v != null && (v as string | number) <= val;
    });
    return this;
  }

  gt(col: string, val: string | number) {
    this.filters.push((row) => {
      const v = row[col];
      return v != null && (v as string | number) > val;
    });
    return this;
  }

  lt(col: string, val: string | number) {
    this.filters.push((row) => {
      const v = row[col];
      return v != null && (v as string | number) < val;
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending !== false });
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  single() {
    this.returnMode = "single";
    return this;
  }

  maybeSingle() {
    this.returnMode = "maybeSingle";
    return this;
  }

  private execute(): { data: unknown; error: { message: string; code?: string } | null; count?: number | null } {
    const store = tables[this.table]!;
    const now = new Date().toISOString();

    if (this.op === "insert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const inserted = rows.map((r) => {
        const record: Row = {
          ...(this.table !== "app_settings" && !r["id"] ? { id: crypto.randomUUID() } : {}),
          created_at: r["created_at"] ?? now,
          ...r,
        };
        if (this.table === "orders") {
          record["updated_at"] = now;
          record["refund_status"] = record["refund_status"] ?? "none";
          record["cancellation_fee"] = record["cancellation_fee"] ?? 0;
        }
        if (this.table === "vip_subscriptions") {
          record["status"] = record["status"] ?? "pending";
          record["updated_at"] = now;
        }
        store.push(record);
        emitRealtime("INSERT", this.table, record, {});
        return projectRow(record, this.selectSpec);
      });
      if (this.returnMode === "single" || this.returnMode === "maybeSingle") {
        return { data: inserted[0] ?? null, error: null };
      }
      return { data: inserted, error: null };
    }

    if (this.op === "upsert") {
      const key = this.onConflictKey ?? "id";
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      const affected = rows.map((r) => {
        const idx = store.findIndex((existing) => existing[key] === r[key]);
        if (idx >= 0) {
          const prev = store[idx]!;
          const updated = { ...prev, ...r };
          store[idx] = updated;
          emitRealtime("UPDATE", this.table, updated, prev);
          return projectRow(updated, this.selectSpec);
        }
        const inserted: Row = {
          ...(this.table !== "app_settings" && !r["id"] ? { id: crypto.randomUUID() } : {}),
          created_at: r["created_at"] ?? now,
          ...r,
        };
        store.push(inserted);
        emitRealtime("INSERT", this.table, inserted, {});
        return projectRow(inserted, this.selectSpec);
      });
      if (this.returnMode === "single" || this.returnMode === "maybeSingle") {
        return { data: affected[0] ?? null, error: null };
      }
      return { data: affected, error: null };
    }

    const matches = (row: Row) => this.filters.every((fn) => fn(row));

    if (this.op === "update") {
      const updates: Row = Array.isArray(this.payload)
        ? (this.payload[0] ?? {})
        : (this.payload ?? {});
      const updatedRows: Row[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const current = store[i]!;
        if (!matches(current)) continue;
        const next: Row = { ...current, ...updates, updated_at: now };
        if (this.table === "vip_subscriptions" && updates["status"] === "approved" && current["status"] !== "approved") {
          const nowMs = Date.now();
          const maxActive = store
            .filter(
              (v) =>
                v["user_id"] === current["user_id"] &&
                v["status"] === "approved" &&
                v["id"] !== current["id"] &&
                v["expires_at"] &&
                new Date(String(v["expires_at"])).getTime() > nowMs,
            )
            .reduce<number | null>((max, v) => {
              const t = new Date(String(v["expires_at"])).getTime();
              return max === null || t > max ? t : max;
            }, null);
          const startMs = maxActive ?? nowMs;
          next["starts_at"] = new Date(startMs).toISOString();
          next["expires_at"] = new Date(startMs + 30 * 86_400_000).toISOString();
          next["reviewed_at"] = now;
        }
        if (this.table === "vip_subscriptions" && updates["status"] === "rejected" && current["status"] !== "rejected") {
          next["reviewed_at"] = now;
          next["starts_at"] = null;
          next["expires_at"] = null;
        }
        if (this.table === "orders" && updates["status"] === "accepted" && !next["accepted_at"]) {
          next["accepted_at"] = now;
        }
        if (this.table === "orders" && updates["status"] === "cancelled" && !next["cancelled_at"]) {
          next["cancelled_at"] = now;
        }
        store[i] = next;
        emitRealtime("UPDATE", this.table, next, current);
        updatedRows.push(projectRow(next, this.selectSpec));
      }
      if (this.returnMode === "single") {
        return updatedRows[0]
          ? { data: updatedRows[0], error: null }
          : { data: null, error: { message: "Row not found" } };
      }
      if (this.returnMode === "maybeSingle") {
        return { data: updatedRows[0] ?? null, error: null };
      }
      return { data: updatedRows, error: null };
    }

    if (this.op === "delete") {
      const kept: Row[] = [];
      const removed: Row[] = [];
      for (const row of store) {
        if (matches(row)) {
          emitRealtime("DELETE", this.table, {}, row);
          removed.push(projectRow(row, this.selectSpec));
        } else {
          kept.push(row);
        }
      }
      tables[this.table] = kept;
      return { data: removed, error: null };
    }

    let rows = store.filter(matches);
    if (this.orders.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { col, ascending } of this.orders) {
          const av = a[col];
          const bv = b[col];
          if (av === bv) continue;
          const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
          return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    const totalCount = rows.length;
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    if (this.headMode) {
      return { data: null, error: null, count: this.countMode ? totalCount : null };
    }
    const projected = rows.map((r) => projectRow(r, this.selectSpec));
    if (this.returnMode === "single") {
      return projected[0]
        ? { data: projected[0], error: null, ...(this.countMode ? { count: totalCount } : {}) }
        : { data: null, error: { message: "Row not found" } };
    }
    if (this.returnMode === "maybeSingle") {
      return { data: projected[0] ?? null, error: null, ...(this.countMode ? { count: totalCount } : {}) };
    }
    return { data: projected, error: null, ...(this.countMode ? { count: totalCount } : {}) };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export function createMockSupabaseClient(scopedUserId?: string): SupabaseClient<Database> {
  const client = {
    auth: {
      async getSession() {
        return { data: { session: readStoredSession() }, error: null };
      },
      async getUser(token?: string) {
        if (token) {
          const claims = parseMockBearerToken(token);
          if (claims) {
            return {
              data: { user: { id: claims.sub, email: claims.email ?? "", user_metadata: {} } },
              error: null,
            };
          }
        }
        const session = readStoredSession();
        return { data: { user: session?.user ?? null }, error: null };
      },
      async getClaims(token?: string) {
        if (token) {
          const claims = parseMockBearerToken(token);
          if (claims) return { data: { claims }, error: null };
        }
        const session = readStoredSession();
        if (session?.user) {
          return { data: { claims: { sub: session.user.id, email: session.user.email } }, error: null };
        }
        if (scopedUserId) return { data: { claims: { sub: scopedUserId } }, error: null };
        return { data: null, error: { message: "Not authenticated" } };
      },
      onAuthStateChange(cb: (event: string, session: MockSession | null) => void) {
        authListeners.add(cb);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                authListeners.delete(cb);
              },
            },
          },
        };
      },
      async signInWithPassword({ email }: { email: string; password: string }) {
        const session = createSessionForEmail(email);
        writeStoredSession(session);
        notifyAuth("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      },
      async signUp({ email, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
        const session = createSessionForEmail(email, options?.data?.full_name);
        writeStoredSession(session);
        notifyAuth("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      },
      async signInWithOAuth({ provider }: { provider: string }) {
        const session = createSessionForEmail("student@campu.edu", "Campus Student");
        writeStoredSession(session);
        notifyAuth("SIGNED_IN", session);
        return { data: { provider, url: null }, error: null };
      },
      async signOut() {
        writeStoredSession(null);
        notifyAuth("SIGNED_OUT", null);
        return { error: null };
      },
    },
    from(table: string) {
      return new MockQueryBuilder(table);
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "has_role") {
        const uid = args?.["_user_id"];
        const role = args?.["_role"];
        const match = tables["user_roles"]!.some((r) => r["user_id"] === uid && r["role"] === role);
        return { data: match, error: null };
      }
      if (fn === "is_vip") {
        const uid = args?.["_user_id"];
        const now = Date.now();
        const match = tables["vip_subscriptions"]!.some(
          (v) =>
            v["user_id"] === uid &&
            v["status"] === "approved" &&
            v["expires_at"] &&
            new Date(String(v["expires_at"])).getTime() > now,
        );
        return { data: match, error: null };
      }
      if (fn === "vip_free_quick_used_today") {
        const uid = args?.["_user_id"];
        const now = new Date();
        const ist = new Date(now.getTime() + 330 * 60_000);
        const startIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000;
        const usedCount = tables["orders"]!.filter(
          (o) =>
            o["student_id"] === uid &&
            o["delivery_type"] === "quick" &&
            Number(o["delivery_fee"]) === 0 &&
            o["status"] !== "cancelled" &&
            o["created_at"] &&
            new Date(String(o["created_at"])).getTime() >= startIstMs,
        ).length;
        return { data: usedCount, error: null };
      }
      if (fn === "deliver_order_with_otp") {
        const orderId = args?.["_order_id"];
        const otp = String(args?.["_delivery_otp"] ?? "").trim();
        const order = tables["orders"]!.find((o) => o["id"] === orderId);
        if (!order) return { data: false, error: { message: "Order not found" } };
        if (order["delivery_otp"] !== otp) return { data: false, error: { message: "Incorrect delivery code" } };
        order["status"] = "delivered";
        emitRealtime("UPDATE", "orders", order, order);
        return { data: true, error: null };
      }
      if (fn === "register_push_device") {
        const uid = scopedUserId ?? readStoredSession()?.user.id;
        if (uid && args?.["_token"] && args?.["_device_id"]) {
          tables["push_devices"]!.push({
            user_id: uid,
            token: args["_token"],
            device_id: args["_device_id"],
            project_id: args["_project_id"] ?? "puch-campu",
            updated_at: new Date().toISOString(),
          });
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    channel(name: string) {
      const channelId = `${name}::${Math.random().toString(36).slice(2)}`;
      const subs: RealtimeSub[] = [];
      const ch = {
        _channelId: channelId,
        on(
          _type: string,
          opts: { event?: string; table?: string; filter?: string },
          cb: (payload: { eventType: string; table: string; new: Row; old: Row }) => void,
        ) {
          if (opts?.table) {
            subs.push({
              event: opts.event ?? "*",
              table: opts.table,
              filter: opts.filter,
              cb,
            });
          }
          return ch;
        },
        subscribe(cb?: (status: string) => void) {
          realtimeSubs.set(channelId, subs);
          if (cb) queueMicrotask(() => cb("SUBSCRIBED"));
          return ch;
        },
      };
      return ch;
    },
    async removeChannel(ch: { _channelId?: string }) {
      if (ch?._channelId) realtimeSubs.delete(ch._channelId);
      return "ok";
    },
    storage: {
      from(bucket: string) {
        return {
          getPublicUrl(path: string) {
            const stored = storageFiles.get(`${bucket}/${path}`);
            return { data: { publicUrl: stored ?? "/favicon.png" } };
          },
          async createSignedUrl(path: string) {
            const stored = storageFiles.get(`${bucket}/${path}`);
            return { data: { signedUrl: stored ?? "/favicon.png" }, error: null };
          },
          async upload(path: string, file: Blob) {
            if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
              storageFiles.set(`${bucket}/${path}`, URL.createObjectURL(file));
            } else {
              storageFiles.set(`${bucket}/${path}`, "/favicon.png");
            }
            return { data: { path }, error: null };
          },
          async remove(paths: string[]) {
            for (const p of paths) storageFiles.delete(`${bucket}/${p}`);
            return { data: [], error: null };
          },
        };
      },
    },
  };

  return client as unknown as SupabaseClient<Database>;
}
