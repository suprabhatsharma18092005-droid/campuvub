import { useQuery } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type ErrorComponentProps,
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/lib/cart";
import { settingsQuery } from "@/lib/queries";
import { SessionProvider } from "@/lib/session";
import {
  DEFAULT_THEME_ID,
  THEME_SETTING_KEY,
  THEME_STORAGE_KEY,
  applyAppTheme,
  getUserThemeOverride,
} from "@/lib/themes";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-brand">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-float"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

const CHUNK_RELOAD_KEY = "campu_chunk_reload_at";

function isDynamicImportError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError/i.test(
    msg,
  );
}

function tryOneShotReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0");
    if (Number.isFinite(last) && now - last < 10_000) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Ignore storage access failures and still attempt a reload
  }
  window.location.reload();
  return true;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const isChunkError = isDynamicImportError(error);

  useEffect(() => {
    if (isChunkError && tryOneShotReload()) {
      return;
    }
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, isChunkError]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isChunkError
            ? "The app updated in the background. Reload to load the latest page."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              if (isChunkError) {
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-float"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-input bg-background px-5 py-2.5 text-sm font-medium text-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Campu — Your Campus, One Tap Away" },
      {
        name: "description",
        content: "Ultra-fast campus delivery: snacks, drinks and essentials to your hostel room.",
      },
      { property: "og:title", content: "Campu — Your Campus, One Tap Away" },
      {
        property: "og:description",
        content: "Ultra-fast campus delivery: snacks, drinks and essentials to your hostel room.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#BE185D" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Campu" },

    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=DM+Sans:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/pwa-192x192.png" },
      { rel: "manifest", href: "/api/public/manifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },

    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      tryOneShotReload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void router.invalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      <SessionProvider>
        <CartProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          <Toaster position="top-center" richColors />
        </CartProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

function ThemeSync() {
  const settings = useQuery(settingsQuery);
  const configured = settings.data?.[THEME_SETTING_KEY];
  const [userOverride, setUserOverride] = useState<string | null>(() => getUserThemeOverride());

  useEffect(() => {
    const syncOverride = () => setUserOverride(getUserThemeOverride());
    syncOverride();
    window.addEventListener("campu-theme-change", syncOverride);
    window.addEventListener("storage", syncOverride);
    return () => {
      window.removeEventListener("campu-theme-change", syncOverride);
      window.removeEventListener("storage", syncOverride);
    };
  }, []);

  useEffect(() => {
    let target = userOverride ?? configured;
    if (!target && typeof window !== "undefined") {
      try {
        target = window.localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
      } catch {
        target = DEFAULT_THEME_ID;
      }
    }
    applyAppTheme(target ?? DEFAULT_THEME_ID);
  }, [configured, userOverride]);

  return null;
}
