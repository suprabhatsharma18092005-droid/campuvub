export type AppThemeId =
  | "emerald"
  | "blue"
  | "red"
  | "yellow"
  | "purple"
  | "teal"
  | "orange"
  | "pink"
  | "indigo"
  | "cyan"
  | "lime"
  | "charcoal";

export type AppThemePreset = {
  id: AppThemeId;
  name: string;
  /** Preview swatches: [primary, softSurface, deepRoyal] */
  swatches: [string, string, string];
  themeColor: string;
  vars: Record<string, string>;
};

export const DEFAULT_THEME_ID: AppThemeId = "pink";
export const THEME_SETTING_KEY = "app_theme_color";
export const THEME_STORAGE_KEY = "campu.theme.v1";

export const APP_THEMES: AppThemePreset[] = [
  {
    id: "emerald",
    name: "Eco Emerald",
    swatches: ["#067D35", "#E8F6ED", "#064720"],
    themeColor: "#067D35",
    vars: {
      "--background": "#f3faf5",
      "--foreground": "#111e16",
      "--primary": "#067d35",
      "--primary-foreground": "#ffffff",
      "--secondary": "#e7f3eb",
      "--secondary-foreground": "#14291c",
      "--muted": "#eaf4ed",
      "--muted-foreground": "#53685a",
      "--accent": "#dff3e6",
      "--accent-foreground": "#065c27",
      "--border": "#d2e7d9",
      "--input": "#d2e7d9",
      "--ring": "#067d35",
      "--delivery-quick": "#dff3e6",
      "--delivery-scheduled": "#e9f6d9",
      "--category-tile": "#e3f4e9",
      "--price-badge": "#dff3e6",
      "--price-badge-foreground": "#065c27",
      "--scheduled-order-border": "#9fd6b4",
      "--scheduled-order-from": "#eaf8ef",
      "--scheduled-order-via": "#e3f5ea",
      "--scheduled-order-to": "#dcf2e5",
      "--gradient-brand": "linear-gradient(110deg, #067d35 0%, #0b9642 55%, #05682b 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f3faf5 0%, #e5f5eb 100%)",
      "--gradient-royal": "linear-gradient(135deg, #0b9642 0%, #067d35 55%, #046c2e 100%)",
    },
  },
  {
    id: "blue",
    name: "Ocean Blue",
    swatches: ["#1D4ED8", "#E6EFFD", "#0F296B"],
    themeColor: "#1D4ED8",
    vars: {
      "--background": "#f4f7fc",
      "--foreground": "#0f172a",
      "--primary": "#1d4ed8",
      "--primary-foreground": "#ffffff",
      "--secondary": "#e8effa",
      "--secondary-foreground": "#162447",
      "--muted": "#ebf1fa",
      "--muted-foreground": "#52607a",
      "--accent": "#e0ebff",
      "--accent-foreground": "#163ca8",
      "--border": "#d4e0f2",
      "--input": "#d4e0f2",
      "--ring": "#1d4ed8",
      "--delivery-quick": "#e0ebff",
      "--delivery-scheduled": "#e3f2fd",
      "--category-tile": "#e5efff",
      "--price-badge": "#e0ebff",
      "--price-badge-foreground": "#163ca8",
      "--scheduled-order-border": "#9ec0fa",
      "--scheduled-order-from": "#edf3ff",
      "--scheduled-order-via": "#e4edff",
      "--scheduled-order-to": "#dce8ff",
      "--gradient-brand": "linear-gradient(110deg, #1d4ed8 0%, #2563eb 55%, #1e40af 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f4f7fc 0%, #e6effd 100%)",
      "--gradient-royal": "linear-gradient(135deg, #2563eb 0%, #1d4ed8 55%, #1e40af 100%)",
    },
  },
  {
    id: "red",
    name: "Crimson Red",
    swatches: ["#C81E1E", "#FCE8E8", "#6B0F0F"],
    themeColor: "#C81E1E",
    vars: {
      "--background": "#fdf5f5",
      "--foreground": "#1f1212",
      "--primary": "#c81e1e",
      "--primary-foreground": "#ffffff",
      "--secondary": "#f9e8e8",
      "--secondary-foreground": "#361616",
      "--muted": "#faebeb",
      "--muted-foreground": "#6f5353",
      "--accent": "#fde2e2",
      "--accent-foreground": "#991515",
      "--border": "#f0d3d3",
      "--input": "#f0d3d3",
      "--ring": "#c81e1e",
      "--delivery-quick": "#fde2e2",
      "--delivery-scheduled": "#fef0e4",
      "--category-tile": "#fce6e6",
      "--price-badge": "#fde2e2",
      "--price-badge-foreground": "#991515",
      "--scheduled-order-border": "#f5aaaa",
      "--scheduled-order-from": "#fef0f0",
      "--scheduled-order-via": "#fde5e5",
      "--scheduled-order-to": "#fbdcdc",
      "--gradient-brand": "linear-gradient(110deg, #c81e1e 0%, #dc2626 55%, #9b1c1c 100%)",
      "--gradient-soft": "linear-gradient(160deg, #fdf5f5 0%, #fce8e8 100%)",
      "--gradient-royal": "linear-gradient(135deg, #dc2626 0%, #c81e1e 55%, #9b1c1c 100%)",
    },
  },
  {
    id: "yellow",
    name: "Golden Yellow",
    swatches: ["#CA8A04", "#FEF7DB", "#5C4103"],
    themeColor: "#CA8A04",
    vars: {
      "--background": "#fefdf5",
      "--foreground": "#1c1605",
      "--primary": "#a16207",
      "--primary-foreground": "#ffffff",
      "--secondary": "#fbf4d8",
      "--secondary-foreground": "#2e2306",
      "--muted": "#faf4de",
      "--muted-foreground": "#6b5d34",
      "--accent": "#fef0b8",
      "--accent-foreground": "#6e4f04",
      "--border": "#ede1b4",
      "--input": "#ede1b4",
      "--ring": "#a16207",
      "--delivery-quick": "#fef0b8",
      "--delivery-scheduled": "#fef6d6",
      "--category-tile": "#fcf3cf",
      "--price-badge": "#fef0b8",
      "--price-badge-foreground": "#5c4103",
      "--scheduled-order-border": "#ebd06e",
      "--scheduled-order-from": "#fef9e4",
      "--scheduled-order-via": "#fdf2cb",
      "--scheduled-order-to": "#fcecb8",
      "--gradient-brand": "linear-gradient(110deg, #a16207 0%, #ca8a04 55%, #854d0e 100%)",
      "--gradient-soft": "linear-gradient(160deg, #fefdf5 0%, #fef6d8 100%)",
      "--gradient-royal": "linear-gradient(135deg, #ca8a04 0%, #a16207 55%, #854d0e 100%)",
    },
  },
  {
    id: "purple",
    name: "Royal Purple",
    swatches: ["#6D28D9", "#EEE8FD", "#3B1278"],
    themeColor: "#6D28D9",
    vars: {
      "--background": "#f7f5fd",
      "--foreground": "#191229",
      "--primary": "#6d28d9",
      "--primary-foreground": "#ffffff",
      "--secondary": "#eee9fb",
      "--secondary-foreground": "#2a1b47",
      "--muted": "#f0ecfb",
      "--muted-foreground": "#5f547a",
      "--accent": "#e7defd",
      "--accent-foreground": "#511ca8",
      "--border": "#ddd3f5",
      "--input": "#ddd3f5",
      "--ring": "#6d28d9",
      "--delivery-quick": "#e7defd",
      "--delivery-scheduled": "#efe7fe",
      "--category-tile": "#ebe3fd",
      "--price-badge": "#e7defd",
      "--price-badge-foreground": "#511ca8",
      "--scheduled-order-border": "#bca6f7",
      "--scheduled-order-from": "#f4effe",
      "--scheduled-order-via": "#ebe2fd",
      "--scheduled-order-to": "#e2d6fc",
      "--gradient-brand": "linear-gradient(110deg, #6d28d9 0%, #7c3aed 55%, #5b21b6 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f7f5fd 0%, #ece4fc 100%)",
      "--gradient-royal": "linear-gradient(135deg, #7c3aed 0%, #6d28d9 55%, #5b21b6 100%)",
    },
  },
  {
    id: "teal",
    name: "Teal Mint",
    swatches: ["#0F766E", "#E0F5F2", "#094742"],
    themeColor: "#0F766E",
    vars: {
      "--background": "#f2fbfa",
      "--foreground": "#0f1e1d",
      "--primary": "#0f766e",
      "--primary-foreground": "#ffffff",
      "--secondary": "#e2f4f1",
      "--secondary-foreground": "#12302d",
      "--muted": "#e6f5f3",
      "--muted-foreground": "#4d6b68",
      "--accent": "#d7f2ee",
      "--accent-foreground": "#0a5751",
      "--border": "#c9e8e3",
      "--input": "#c9e8e3",
      "--ring": "#0f766e",
      "--delivery-quick": "#d7f2ee",
      "--delivery-scheduled": "#e0f6ec",
      "--category-tile": "#dcf3ef",
      "--price-badge": "#d7f2ee",
      "--price-badge-foreground": "#0a5751",
      "--scheduled-order-border": "#8fd6cc",
      "--scheduled-order-from": "#eafaf7",
      "--scheduled-order-via": "#dff6f2",
      "--scheduled-order-to": "#d4f2ed",
      "--gradient-brand": "linear-gradient(110deg, #0f766e 0%, #0d9488 55%, #115e59 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f2fbfa 0%, #dff5f1 100%)",
      "--gradient-royal": "linear-gradient(135deg, #0d9488 0%, #0f766e 55%, #115e59 100%)",
    },
  },
  {
    id: "orange",
    name: "Sunset Orange",
    swatches: ["#C2410C", "#FCEAE0", "#6B2406"],
    themeColor: "#C2410C",
    vars: {
      "--background": "#fef7f3",
      "--foreground": "#21140e",
      "--primary": "#c2410c",
      "--primary-foreground": "#ffffff",
      "--secondary": "#faeae1",
      "--secondary-foreground": "#3b1c0e",
      "--muted": "#fbede5",
      "--muted-foreground": "#735648",
      "--accent": "#fde2d4",
      "--accent-foreground": "#943008",
      "--border": "#f2d6c6",
      "--input": "#f2d6c6",
      "--ring": "#c2410c",
      "--delivery-quick": "#fde2d4",
      "--delivery-scheduled": "#fef0d8",
      "--category-tile": "#fde7db",
      "--price-badge": "#fde2d4",
      "--price-badge-foreground": "#943008",
      "--scheduled-order-border": "#f5b593",
      "--scheduled-order-from": "#fef1ea",
      "--scheduled-order-via": "#fde7dc",
      "--scheduled-order-to": "#fcdecf",
      "--gradient-brand": "linear-gradient(110deg, #c2410c 0%, #ea580c 55%, #9a3412 100%)",
      "--gradient-soft": "linear-gradient(160deg, #fef7f3 0%, #fce8dc 100%)",
      "--gradient-royal": "linear-gradient(135deg, #ea580c 0%, #c2410c 55%, #9a3412 100%)",
    },
  },
  {
    id: "pink",
    name: "Rose Pink",
    swatches: ["#BE185D", "#FCE5F0", "#6B0D34"],
    themeColor: "#BE185D",
    vars: {
      "--background": "#fdf4f8",
      "--foreground": "#211118",
      "--primary": "#be185d",
      "--primary-foreground": "#ffffff",
      "--secondary": "#fae8f0",
      "--secondary-foreground": "#3a1426",
      "--muted": "#fbeaf2",
      "--muted-foreground": "#705160",
      "--accent": "#fce0ed",
      "--accent-foreground": "#941148",
      "--border": "#f1d1e0",
      "--input": "#f1d1e0",
      "--ring": "#be185d",
      "--delivery-quick": "#fce0ed",
      "--delivery-scheduled": "#fae9f7",
      "--category-tile": "#fce5f0",
      "--price-badge": "#fce0ed",
      "--price-badge-foreground": "#941148",
      "--scheduled-order-border": "#f4a6ca",
      "--scheduled-order-from": "#fef0f6",
      "--scheduled-order-via": "#fde3ef",
      "--scheduled-order-to": "#fbd8e8",
      "--gradient-brand": "linear-gradient(110deg, #be185d 0%, #db2777 55%, #9d174d 100%)",
      "--gradient-soft": "linear-gradient(160deg, #fdf4f8 0%, #fce4ef 100%)",
      "--gradient-royal": "linear-gradient(135deg, #db2777 0%, #be185d 55%, #9d174d 100%)",
    },
  },
  {
    id: "indigo",
    name: "Deep Indigo",
    swatches: ["#4338CA", "#E7E9FB", "#231C70"],
    themeColor: "#4338CA",
    vars: {
      "--background": "#f4f5fd",
      "--foreground": "#121329",
      "--primary": "#4338ca",
      "--primary-foreground": "#ffffff",
      "--secondary": "#e9ebfa",
      "--secondary-foreground": "#1e204b",
      "--muted": "#eceefa",
      "--muted-foreground": "#55587a",
      "--accent": "#e0e3fc",
      "--accent-foreground": "#31279c",
      "--border": "#d3d7f2",
      "--input": "#d3d7f2",
      "--ring": "#4338ca",
      "--delivery-quick": "#e0e3fc",
      "--delivery-scheduled": "#eae8fd",
      "--category-tile": "#e6e8fc",
      "--price-badge": "#e0e3fc",
      "--price-badge-foreground": "#31279c",
      "--scheduled-order-border": "#a4abf5",
      "--scheduled-order-from": "#eff0fe",
      "--scheduled-order-via": "#e5e7fd",
      "--scheduled-order-to": "#dce0fc",
      "--gradient-brand": "linear-gradient(110deg, #4338ca 0%, #4f46e5 55%, #3730a3 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f4f5fd 0%, #e5e7fb 100%)",
      "--gradient-royal": "linear-gradient(135deg, #4f46e5 0%, #4338ca 55%, #3730a3 100%)",
    },
  },
  {
    id: "cyan",
    name: "Sky Cyan",
    swatches: ["#0369A1", "#E0F2FE", "#063D5C"],
    themeColor: "#0369A1",
    vars: {
      "--background": "#f2f9fd",
      "--foreground": "#0e1c26",
      "--primary": "#0369a1",
      "--primary-foreground": "#ffffff",
      "--secondary": "#e3f2fa",
      "--secondary-foreground": "#112b3b",
      "--muted": "#e7f4fb",
      "--muted-foreground": "#4d6675",
      "--accent": "#d9effc",
      "--accent-foreground": "#024f7a",
      "--border": "#cae3f2",
      "--input": "#cae3f2",
      "--ring": "#0369a1",
      "--delivery-quick": "#d9effc",
      "--delivery-scheduled": "#dff6f9",
      "--category-tile": "#dff1fc",
      "--price-badge": "#d9effc",
      "--price-badge-foreground": "#024f7a",
      "--scheduled-order-border": "#92cde8",
      "--scheduled-order-from": "#ecf7fe",
      "--scheduled-order-via": "#dff2fd",
      "--scheduled-order-to": "#d4edfc",
      "--gradient-brand": "linear-gradient(110deg, #0369a1 0%, #0284c7 55%, #075985 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f2f9fd 0%, #e0f2fe 100%)",
      "--gradient-royal": "linear-gradient(135deg, #0284c7 0%, #0369a1 55%, #075985 100%)",
    },
  },
  {
    id: "lime",
    name: "Fresh Lime",
    swatches: ["#65A30D", "#ECFAD6", "#314F06"],
    themeColor: "#4D7C0F",
    vars: {
      "--background": "#f8fef1",
      "--foreground": "#152007",
      "--primary": "#4d7c0f",
      "--primary-foreground": "#ffffff",
      "--secondary": "#eef9dc",
      "--secondary-foreground": "#203307",
      "--muted": "#f0f9e0",
      "--muted-foreground": "#57683d",
      "--accent": "#e5f7c6",
      "--accent-foreground": "#3b5c08",
      "--border": "#d7ebb5",
      "--input": "#d7ebb5",
      "--ring": "#4d7c0f",
      "--delivery-quick": "#e5f7c6",
      "--delivery-scheduled": "#f2fbd4",
      "--category-tile": "#eaf8d1",
      "--price-badge": "#e5f7c6",
      "--price-badge-foreground": "#314f06",
      "--scheduled-order-border": "#b2dc68",
      "--scheduled-order-from": "#f3fce4",
      "--scheduled-order-via": "#eaf9d2",
      "--scheduled-order-to": "#e1f6c0",
      "--gradient-brand": "linear-gradient(110deg, #4d7c0f 0%, #65a30d 55%, #3f6212 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f8fef1 0%, #ecf9d6 100%)",
      "--gradient-royal": "linear-gradient(135deg, #65a30d 0%, #4d7c0f 55%, #3f6212 100%)",
    },
  },
  {
    id: "charcoal",
    name: "Obsidian Slate",
    swatches: ["#18181B", "#ECECEF", "#09090B"],
    themeColor: "#18181B",
    vars: {
      "--background": "#f6f6f7",
      "--foreground": "#111113",
      "--primary": "#18181b",
      "--primary-foreground": "#ffffff",
      "--secondary": "#ececef",
      "--secondary-foreground": "#1f1f23",
      "--muted": "#efeff1",
      "--muted-foreground": "#5c5c66",
      "--accent": "#e4e4e8",
      "--accent-foreground": "#18181b",
      "--border": "#d8d8df",
      "--input": "#d8d8df",
      "--ring": "#18181b",
      "--delivery-quick": "#e7e7eb",
      "--delivery-scheduled": "#ededf2",
      "--category-tile": "#ebebef",
      "--price-badge": "#e4e4e8",
      "--price-badge-foreground": "#18181b",
      "--scheduled-order-border": "#b5b5c0",
      "--scheduled-order-from": "#f3f3f5",
      "--scheduled-order-via": "#ebebf0",
      "--scheduled-order-to": "#e2e2e8",
      "--gradient-brand": "linear-gradient(110deg, #18181b 0%, #3f3f46 55%, #09090b 100%)",
      "--gradient-soft": "linear-gradient(160deg, #f6f6f7 0%, #e9e9ec 100%)",
      "--gradient-royal": "linear-gradient(135deg, #3f3f46 0%, #27272a 55%, #18181b 100%)",
    },
  },
];

export const USER_THEME_STORAGE_KEY = "campu.theme.user.v1";

export function getAppTheme(id?: string | null): AppThemePreset {
  return APP_THEMES.find((t) => t.id === id) ?? APP_THEMES[0]!;
}

export function getUserThemeOverride(): AppThemeId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_THEME_STORAGE_KEY);
    if (!raw) return null;
    return APP_THEMES.some((t) => t.id === raw) ? (raw as AppThemeId) : null;
  } catch {
    return null;
  }
}

export function setUserThemeOverride(id: AppThemeId | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(USER_THEME_STORAGE_KEY, id);
    else window.localStorage.removeItem(USER_THEME_STORAGE_KEY);
    window.dispatchEvent(new Event("campu-theme-change"));
  } catch {
    /* ignore storage errors */
  }
}

export function applyAppTheme(id?: string | null): AppThemePreset {
  const preset = getAppTheme(id);
  if (typeof document === "undefined") return preset;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(preset.vars)) {
    root.style.setProperty(k, v);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", preset.themeColor);

  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    manifestLink.setAttribute("href", `/api/public/manifest?theme=${preset.id}`);
  }
  const faviconLink = document.querySelector('link[rel="icon"]');
  if (faviconLink) faviconLink.setAttribute("href", "/pwa-192x192.png");
  const appleIconLink = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleIconLink) appleIconLink.setAttribute("href", "/apple-touch-icon.png");

  try {
    document.cookie = `campu_theme=${encodeURIComponent(preset.id)}; path=/; max-age=31536000; SameSite=Lax`;
    window.localStorage.setItem(THEME_STORAGE_KEY, preset.id);
  } catch {
    /* ignore storage errors */
  }
  return preset;
}
