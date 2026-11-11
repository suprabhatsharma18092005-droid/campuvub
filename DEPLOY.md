# Deploying Campu to Vercel (https://campu.in)

## Step 1 — Push notifications (no private keys on Vercel)

Firebase project: `puch-campu`. The private service account lives only in the
Lovable project's secret store (`FIREBASE_SERVICE_ACCOUNT_JSON`) — never in
source code or the database.

How each part works on Vercel without `SUPABASE_SERVICE_ROLE_KEY`:
- **Turn on notifications / re-registration on app open**: the browser calls
  the sign-in-protected database function `register_push_device` directly.
  It saves the token only for the signed-in user (creating their profile if
  missing, moving a token that a previous account used on the same browser).
  Signed-out visitors cannot call it.
- **Sending** (new order → admins, status change / cancellation → customer,
  admin broadcast, admin test button): server functions call
  `dispatchPushEvent`. A host that holds the service-role key and Firebase
  credentials (Lovable) sends directly. Any other host forwards only the event
  (type + id) with the caller's own session to
  `https://campus-crate-rush.lovable.app/api/public/push-event` (override with
  `PUSH_EVENT_HOST_URL`). That host verifies the session, re-checks
  permission (order owner / admin, events newer than 10 minutes), looks up
  tokens and sends. Every send is awaited and failures never undo the order.

What this means for you:
- **Publish the Lovable app** after any change to notifications so the
  hand-off endpoint is live.
- **Vercel**: no Firebase or service-role variables are needed.
- Verify: Admin → Settings → **Send test notification to me**.

## Step 2 — Vercel build settings
- Framework preset: Other
- Install command: `bun install` (or `npm install`)
- Build command: `vite build` (Vercel sets `VERCEL=1`, which switches the Nitro preset to `vercel`)
- Output directory: leave default (Nitro writes `.vercel/output`)

## Step 3 — Environment variables (Vercel → Settings → Environment Variables)
Use the values from this project's `.env` so Vercel talks to the same backend
(required: the Lovable host must recognise the signed-in session).

Build-time (public, safe in browser):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`

Server (public values, needed by sign-in-protected server functions):
- `SUPABASE_URL` (same as `VITE_SUPABASE_URL`)
- `SUPABASE_PUBLISHABLE_KEY` (same as `VITE_SUPABASE_PUBLISHABLE_KEY`)

Not needed: `SUPABASE_SERVICE_ROLE_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`.
Optional: `PUSH_EVENT_HOST_URL` if the Lovable app moves to another https URL.

## CORS & custom domains — what applies and what doesn't

- **No CORS code is needed.** Push sends, order data and broadcasts all go
  through same-origin server functions served by your own Vercel deployment
  (`https://campu.in/...`), so the browser and server always share an origin.
  Browser→FCM token registration talks to Google's FCM endpoints, which allow
  any HTTPS origin — nothing to whitelist there either.
- **Firebase Console** (only if you use Firebase Auth in this project — Campu
  uses Supabase auth): Authentication → Settings → Authorized domains, add
  `campu.in` and `www.campu.in`.
- **Vercel** automatically serves your deployment on `campu.in` once the
  domain is connected; no header changes required.

## Step 4 — Supabase Auth → URL Configuration
- Site URL: `https://campu.in`
- Redirect URLs: `https://campu.in/**`, `https://www.campu.in/**` (plus the Lovable preview URL if you test there)
- Google provider: enabled with your own Google OAuth client ID + secret.

## Step 5 — Google Cloud Console → OAuth client
- Authorized JavaScript origins: `https://campu.in`, `https://www.campu.in`
- Authorized redirect URI: `<VITE_SUPABASE_URL>/auth/v1/callback`

## Step 6 — Verify
1. Open https://campu.in, sign in, enable notifications (Profile → Turn on notifications).
2. Place a test order → the admin device must get "New Order! 🚀" even with the app closed.
3. Admin dashboard → change the order status → the student device gets the matching push.
4. Admin → Settings → "Send test notification to me" must succeed; if it shows the
   not-configured message, re-check Step 1 and redeploy.
