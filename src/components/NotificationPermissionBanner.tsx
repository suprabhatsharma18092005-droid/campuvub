import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { enablePush, pushDeviceId } from "@/lib/push";
import { savePushDevice } from "@/lib/push-device";
import { useSession } from "@/lib/session";

const DISMISSED_KEY = "campu.notif-prompt-dismissed";

export function NotificationPermissionBanner() {
  const { session } = useSession();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    try {
      if (window.sessionStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      /* ignore sessionStorage errors */
    }
    setVisible(true);
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function allowAlerts() {
    if (busy || typeof window === "undefined" || !("Notification" in window)) return;
    setBusy(true);
    try {
      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();

      if (permission !== "granted") {
        toast.info("Notifications were not enabled. You can allow them anytime from your browser settings.");
        if (permission === "denied") setVisible(false);
        return;
      }

      setVisible(false);

      if (session) {
        const result = await enablePush((token) =>
          savePushDevice(token, pushDeviceId()),
        );
        if (result.status === "registered") {
          toast.success("Instant order & delivery alerts enabled!");
          return;
        }
        if (result.status === "open-in-new-tab") {
          toast.success("Alerts allowed! Open in a full browser tab to finish device registration.");
          return;
        }
      }

      toast.success("Instant order & delivery alerts enabled!");
    } catch {
      toast.info("Could not enable browser alerts in this view. Try opening Campu in a full tab.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Notification permission prompt"
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-card p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent text-primary">
          <Bell className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 pr-6">
          <p className="font-display text-sm font-bold text-foreground">
            🔔 Enable Instant Order &amp; Delivery Alerts
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Get real-time sound notifications and live status updates when your order is accepted or out for delivery.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => void allowAlerts()}
              className="h-11 rounded-full bg-brand px-5 text-xs font-bold text-primary-foreground shadow-card hover:opacity-95"
            >
              {busy ? "Enabling…" : "Allow Alerts"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={dismiss}
              className="h-11 rounded-full px-4 text-xs font-semibold text-muted-foreground"
            >
              Maybe later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss notification prompt"
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
