import { createFileRoute } from "@tanstack/react-router";

/**
 * Trusted notification host. Other deployments of this app (e.g. Vercel)
 * forward an event here with the signed-in caller's own session. The caller
 * is verified and re-authorized (order owner / admin) before any send; tokens
 * and message content never come from the request.
 */
export const Route = createFileRoute("/api/public/push-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const events = await import("@/lib/push-events.server");
        const { hasAnyTelegramCredentials } = await import("@/lib/telegram.server");
        // Only a host that can send notifications locally serves events — prevents forwarding loops.
        const localPushReady = events.canSendLocally();
        const localTelegramReady = await hasAnyTelegramCredentials();
        if (!localPushReady && !localTelegramReady) {
          return Response.json({ error: "Notifications unavailable" }, { status: 503 });
        }

        const ctx = await events.contextFromBearer(request.headers.get("authorization"));
        if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

        const raw = await request.text();
        if (raw.length > 2_000) return Response.json({ error: "Payload too large" }, { status: 413 });
        let body: unknown;
        try { body = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const event = events.pushEventSchema.safeParse(body);
        if (!event.success) return Response.json({ error: "Invalid event" }, { status: 400 });

        try {
          return Response.json(await events.runPushEvent(event.data, ctx));
        } catch (error) {
          if (error instanceof events.PushForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
          console.error("Push event error", error);
          return Response.json({ error: "Notification failed" }, { status: 500 });
        }
      },
    },
  },
});
