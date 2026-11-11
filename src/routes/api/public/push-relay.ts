import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Push relay: lets a deployment of this app that has no Firebase
 * credentials (e.g. a self-hosted Vercel build) proxy an FCM HTTP v1 send
 * through this Lovable-hosted deployment, which already holds the working
 * Firebase messaging configuration.
 *
 * The caller authenticates with a shared relay key header. The request body
 * is a standard FCM v1 send body ({ message: {...} }) and is forwarded to
 * the gateway verbatim; the provider's status and body are relayed back so
 * dead-token detection keeps working on the caller side.
 */

const relayBodySchema = z
  .object({
    message: z
      .object({
        token: z.string().min(10).max(500),
        data: z.record(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const Route = createFileRoute("/api/public/push-relay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getRelayConfig, relayKeyMatches } = await import("@/lib/push-relay.server");
        const relay = getRelayConfig();
        if (!relay) return new Response("Relay disabled", { status: 503 });

        if (!relayKeyMatches(request.headers.get("x-relay-key"), relay.key)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const raw = await request.text();
        if (raw.length > 20_000) return new Response("Payload too large", { status: 413 });

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const body = relayBodySchema.safeParse(parsed);
        if (!body.success) return new Response("Invalid payload", { status: 400 });

        // Direct transport only (service account or gateway) — never the
        // relay fallback, so a misconfigured host can't forward to itself.
        const { directTransport } = await import("@/lib/fcm.server");
        let transport;
        try {
          transport = await directTransport();
        } catch (error) {
          console.error("Push relay transport error", error);
          return Response.json({ error: "Relay transport failed" }, { status: 502 });
        }
        if (!transport) {
          return Response.json({ error: "Messaging not configured on relay host" }, { status: 503 });
        }

        const res = await fetch(transport.url, {
          method: "POST",
          headers: transport.headers,
          body: raw,
        });
        const text = await res.text();
        if (!res.ok) {
          console.error(`Push relay forward failed [${res.status}]: ${text.slice(0, 300)}`);
        }
        return new Response(text, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
