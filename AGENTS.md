<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->


- Keep Campu's daily order opening time in Asia/Kolkata; both the client countdown and database order-insert guard must use this timezone so the displayed availability matches enforcement.
- Store payment configuration as key/value rows in `app_settings` and uploaded QR paths in private `payment-assets`; this preserves existing consumers and avoids public payment images.
- Store banner and product uploads in the private `catalog-media` bucket, persist object paths in banner `image_path` / product `image_path`, and resolve them through signed URLs so public listings never require a public bucket.
- Push credentials stay in runtime secrets, never source; FCM HTTP v1 sends data-only messages and requires sender/client project agreement to avoid duplicate or mismatched notifications.
- Browsers save push tokens via the sign-in-protected `register_push_device` RPC (no server key), so any host can register devices; tokens live in push_devices with project metadata.
- All notification triggers go through `dispatchPushEvent`: send locally when the host has privileged keys, otherwise forward only the event with the caller's session to the trusted host, which re-authorizes; always awaited and never throwing, so serverless responses cannot abandon sends or undo order changes.
- An optional external push relay requires runtime URL/key configuration, with no copied credential fallback, to prevent unauthenticated messaging abuse.
- Google sign-in uses `supabase.auth.signInWithOAuth` directly (not the Lovable broker) — the app is hosted on a custom domain outside Lovable.
- Catalogue/order realtime lives in one shared hook mounted by AppShell; pages must not open their own duplicate channels for the same tables.
- Keep bottom navigation fixed at the viewport bottom across breakpoints; desktop width is used by responsive content grids and split checkout columns rather than replacing navigation or constraining the app to a narrow centered shell.
- Keep home delivery-mode selection in the existing selector component and delegate mode state to the shared delivery store, so presentation changes do not fork filtering or cart rules.
- Keep product-card price normalization in the browser-safe product-pricing helper; display metadata must not alter cart or checkout pricing.
- Transfer the per-request query cache through router dehydration/hydration and settle storefront prefetches before SSR; matching initial data prevents hydration errors.
- Designated-email admin grants use the existing database role table and verified-email auth lifecycle triggers, including sign-in updates; this prevents unverified signup privilege escalation.
- Keep the profile-creation auth trigger and backfill missing remix profiles before device registration; push device ownership references profiles.
- Backend is the user-connected Supabase project "Campu"; schema changes go through Lovable migrations (supabase/migrations), not the legacy drizzle folder, so one source of truth exists.
