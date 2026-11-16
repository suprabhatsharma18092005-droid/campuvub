import { createFileRoute } from "@tanstack/react-router";

import { generateThemedPwaIconPng } from "@/lib/pwa-icon.server";

function readThemeCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "campu_theme") return decodeURIComponent(rest.join("="));
  }
  return null;
}

export const Route = createFileRoute("/api/public/pwa-icon")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rawSize = url.searchParams.get("size");
        const size: 192 | 512 = rawSize === "512" ? 512 : 192;
        const purpose = url.searchParams.get("purpose") === "maskable" ? "maskable" : "any";
        let themeId = url.searchParams.get("theme") || readThemeCookie(request.headers.get("cookie"));

        if (!themeId) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data } = await supabaseAdmin
              .from("app_settings")
              .select("value")
              .eq("key", "app_theme_color")
              .maybeSingle();
            if (data?.value) themeId = data.value;
          } catch {
            // Fall back cleanly to default emerald theme
          }
        }

        const png = generateThemedPwaIconPng(themeId, size, purpose);
        return new Response(new Uint8Array(png), {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
