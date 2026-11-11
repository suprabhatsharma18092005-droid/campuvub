import { FIREBASE_PROJECT_ID } from "./firebase-config";
import { isDeadTokenError } from "./push-policy";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/firebase_messaging";

export type PushPayload = {
  title: string;
  body: string;
  path?: string;
};

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type SendResult = { ok: true } | { ok: false; dead: boolean };

let cachedToken: { token: string; expiresAt: number; accountKey: string } | null = null;

/** Secrets holding the full service-account JSON (plain or base64-encoded). */
export const SERVICE_ACCOUNT_SECRET_NAMES = [
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_SERVICE_ACCOUNT",
  "FCM_SERVICE_ACCOUNT",
  "GOOGLE_APPLICATION_CREDENTIALS_JSON",
] as const;

/** Individual variables holding the three credential fields (common on Vercel). */
export const SERVICE_ACCOUNT_FIELD_VARS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export type ServiceAccountStatus = {
  secretName: string | null;
  parses: boolean;
  projectId: string | null;
  account: ServiceAccount | null;
};

function parseServiceAccount(raw: string): ServiceAccount | null {
  const text = raw.trim();
  const attempts = [text];
  if (!text.startsWith("{")) {
    try {
      attempts.push(atob(text.replace(/\s+/g, "")));
    } catch {
      /* not base64 */
    }
  }
  for (const candidate of attempts) {
    try {
      let parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === "string") parsed = JSON.parse(parsed); // double-encoded
      const sa = parsed as Partial<ServiceAccount>;
      if (!sa?.project_id || !sa.client_email || !sa.private_key) continue;
      return {
        project_id: sa.project_id,
        client_email: sa.client_email,
        private_key: sa.private_key.replace(/\\n/g, "\n"),
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Finds the service account from any supported secret. Preference order:
 * 1. a full service-account JSON secret (plain or base64-encoded)
 * 2. the three individual credential variables (common Vercel format)
 * Never logs or returns any key material.
 */
export function serviceAccountStatus(): ServiceAccountStatus {
  for (const name of SERVICE_ACCOUNT_SECRET_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    const account = parseServiceAccount(raw);
    if (!account) console.error(`${name} is set but is not a valid service account JSON`);
    return { secretName: name, parses: Boolean(account), projectId: account?.project_id ?? null, account };
  }
  // Individual variables — FIREBASE_PRIVATE_KEY may carry escaped \n newlines.
  const projectId = process.env["FIREBASE_PROJECT_ID"];
  const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
  const privateKey = process.env["FIREBASE_PRIVATE_KEY"];
  if (projectId && clientEmail && privateKey) {
    const account: ServiceAccount = {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
    return { secretName: "FIREBASE_PROJECT_ID+CLIENT_EMAIL+PRIVATE_KEY", parses: true, projectId, account };
  }
  const missing = SERVICE_ACCOUNT_FIELD_VARS.filter((v) => !process.env[v]);
  if (missing.length < SERVICE_ACCOUNT_FIELD_VARS.length) {
    console.error(
      `Firebase credentials incomplete: ${missing.join(", ")} is missing. Set all three or provide the full JSON secret.`,
    );
  }
  return { secretName: null, parses: false, projectId: null, account: null };
}

function readServiceAccount(): ServiceAccount | null {
  return serviceAccountStatus().account;
}

function base64url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const accountKey = `${sa.project_id}:${sa.client_email}:${sa.private_key}`;
  if (cachedToken && cachedToken.accountKey === accountKey && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed [${res.status}]: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: now + json.expires_in, accountKey };
  return json.access_token;
}

/** Data-only message: the service worker / foreground listener renders exactly one alert. */
export function buildMessage(token: string, payload: PushPayload) {
  return {
    message: {
      token,
      data: {
        title: payload.title,
        body: payload.body,
        path: payload.path ?? "/",
      },
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { "content-available": 1 } },
      },
      webpush: { headers: { Urgency: "high", TTL: "86400" } },
    },
  };
}

async function sendOne(
  token: string,
  payload: PushPayload,
  transport: { url: string; headers: Record<string, string> },
): Promise<SendResult> {
  const res = await fetch(transport.url, {
    method: "POST",
    headers: transport.headers,
    body: JSON.stringify(buildMessage(token, payload)),
  });
  if (res.ok) return { ok: true };
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    console.error(
      `FCM auth error [${res.status}] — check that the Firebase Cloud Messaging API is enabled for the project in FIREBASE_SERVICE_ACCOUNT_JSON and that the service account key is valid: ${text}`,
    );
  } else {
    console.error(`FCM send failed [${res.status}]: ${text}`);
  }
  return { ok: false, dead: isDeadTokenError(res.status, text) };
}

/**
 * Transport that sends FCM messages with credentials held locally in this
 * deployment's environment — the Firebase service account when present,
 * otherwise the Lovable connector gateway. Returns null when neither is
 * configured (senders should fall back to the push relay).
 */
export async function directTransport(): Promise<{ url: string; headers: Record<string, string> } | null> {
  const sa = readServiceAccount();
  if (sa && sa.project_id !== FIREBASE_PROJECT_ID) {
    throw new Error("Firebase sender project does not match puch-campu. Update the service-account secret securely.");
  }
  if (sa) {
    const accessToken = await getAccessToken(sa);
    return {
      url: `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    };
  }
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["FIREBASE_MESSAGING_API_KEY"];
  if (!lovableKey || !connectionKey) return null;
  return {
    url: `${GATEWAY_URL}/v1/projects/_/messages:send`,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": connectionKey,
      "Content-Type": "application/json",
    },
  };
}

/**
 * Sends a push to the given device tokens. Uses a Firebase service account
 * when FIREBASE_SERVICE_ACCOUNT_JSON is set, otherwise the Lovable connector
 * gateway. When this deployment holds no Firebase credentials at all (e.g. a
 * self-hosted Vercel build), it proxies the send through the Lovable-hosted
 * push relay, which does hold them — the relay returns the provider's status
 * and body verbatim, so dead-token detection below keeps working unchanged.
 */
export async function sendPushToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<{ sent: number; staleTokens: string[] }> {
  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) return { sent: 0, staleTokens: [] };

  let transport;
  try {
    transport = await directTransport();
  } catch (error) {
    console.error("FCM auth error", error);
    return { sent: 0, staleTokens: [] };
  }
  if (!transport) {
    try {
      const { getRelayConfig } = await import("./push-relay.server");
      const relay = getRelayConfig();
      if (relay) {
        transport = {
          url: `${relay.baseUrl}/api/public/push-relay`,
          headers: { "x-relay-key": relay.key, "Content-Type": "application/json" },
        };
      }
    } catch (error) {
      console.error("Push relay fallback error", error);
    }
  }
  if (!transport) {
    console.error("Firebase messaging is not configured");
    return { sent: 0, staleTokens: [] };
  }

  const results = await Promise.allSettled(unique.map((t) => sendOne(t, payload, transport)));
  let sent = 0;
  const staleTokens: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error("FCM send error", r.reason);
      return;
    }
    if (r.value.ok) sent += 1;
    else if (r.value.dead) {
      const token = unique[i];
      if (token) staleTokens.push(token);
    }
  });

  if (staleTokens.length > 0) await clearDeadTokens(staleTokens);
  return { sent, staleTokens };
}

/** Removes unregistered device tokens so the database stays clean. */
export async function clearDeadTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("push_devices").delete().in("token", tokens);
    if (error) console.error("Failed to clear dead FCM tokens", error.message);
    const { error: legacyError } = await supabaseAdmin.from("profiles").update({ fcm_token: null }).in("fcm_token", tokens);
    if (legacyError) console.error("Failed to clear legacy tokens", legacyError.message);
  } catch (error) {
    console.error("Failed to clear dead FCM tokens", error);
  }
}
