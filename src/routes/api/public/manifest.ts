import { createFileRoute } from "@tanstack/react-router";

import { normalizeThemeId } from "@/lib/pwa-icon.server";
import { getAppTheme } from "@/lib/themes";

function readThemeCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "campu_theme") return decodeURIComponent(rest.join("="));
  }
  return null;
}

export const Route = createFileRoute("/api/public/manifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        let rawTheme = url.searchParams.get("theme") || readThemeCookie(request.headers.get("cookie"));

        if (!rawTheme) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data } = await supabaseAdmin
              .from("app_settings")
              .select("value")
              .eq("key", "app_theme_color")
              .maybeSingle();
            if (data?.value) rawTheme = data.value;
          } catch {
            // Fall back cleanly to default theme
          }
        }

        const themeId = normalizeThemeId(rawTheme);
        const preset = getAppTheme(themeId);
        const manifest = {
          id: "/",
          name: "Campu — Campus Delivery",
          short_name: "Campu",
          description:
            "Ultra-fast campus delivery: snacks, drinks and essentials to your hostel room.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: preset.vars["--background"] ?? "#f3faf5",
          theme_color: preset.themeColor,
          icons: [
            {
              src: `/api/public/pwa-icon?theme=${themeId}&size=192&purpose=any`,
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: `/api/public/pwa-icon?theme=${themeId}&size=192&purpose=maskable`,
              sizes: "192x192",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: `/api/public/pwa-icon?theme=${themeId}&size=512&purpose=any`,
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: `/api/public/pwa-icon?theme=${themeId}&size=512&purpose=maskable`,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        };

        return new Response(JSON.stringify(manifest, null, 2), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "no-store, max-age=0",
          },
        });
      },
    },
  },
});
