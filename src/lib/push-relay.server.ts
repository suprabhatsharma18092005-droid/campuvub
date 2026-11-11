/**
 * Push relay configuration.
 *
 * Deployments that do not hold Firebase credentials in their environment
 * (e.g. a self-hosted Vercel build of this app) cannot send FCM messages
 * directly. They instead proxy each send to this project's own
 * Lovable-hosted deployment, which already holds the working Firebase
 * messaging configuration.
 *
 * Server-only module (.server.ts) — never bundled into client code.
 */

export type RelayConfig = { baseUrl: string; key: string };

/** Read inside handlers — env injection happens per-request on Workers. */
export function getRelayConfig(): RelayConfig | null {
  const key = process.env["PUSH_RELAY_KEY"];
  const configuredUrl = process.env["PUSH_RELAY_BASE_URL"];
  if (!key || !configuredUrl) return null;
  const baseUrl = configuredUrl.replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) return null;
  return { baseUrl, key };
}

/** Constant-time string comparison (no secrets logged or returned). */
export function relayKeyMatches(received: string | null, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
