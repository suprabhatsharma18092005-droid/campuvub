import { Link } from "@tanstack/react-router";
import { Clock, Home, LockOpen, ReceiptText, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { CampuLogo } from "@/components/CampuLogo";
import { Button } from "@/components/ui/button";
import { countdownLabel } from "@/lib/ordering";
import {
  formatStoreClockTime,
  getReopenDayLabel,
  getStoreClosedMessage,
  getStoreReopenTime,
  nextReopenCountdownMs,
} from "@/lib/store-status";

export function StoreClosedShutter({
  settings,
  preview = false,
  isAdmin = false,
  onClosePreview,
  onDismiss,
}: {
  settings: Record<string, string> | undefined;
  preview?: boolean;
  isAdmin?: boolean;
  onClosePreview?: () => void;
  onDismiss?: () => void;
}) {
  const reopenTime = getStoreReopenTime(settings);
  const closedMessage = getStoreClosedMessage(settings);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = nextReopenCountdownMs(reopenTime, nowMs);
  const reopenDayText = getReopenDayLabel(reopenTime, nowMs);
  const clockLabel = formatStoreClockTime(reopenTime);

  const handleClose = onClosePreview ?? onDismiss;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Store is currently closed"
      className="fixed inset-0 z-50 overflow-hidden bg-black/55 backdrop-blur-[2px]"
    >
      {/* Rolling metallic shutter curtain tinted entirely to the active app theme */}
      <div
        className="animate-shutter-drop relative flex h-full w-full flex-col overflow-y-auto text-primary-foreground shadow-2xl"
        style={{
          backgroundColor: "color-mix(in oklab, var(--primary) 68%, #0e0a12)",
        }}
      >
        {/* Theme-colored metallic horizontal shutter slats */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, color-mix(in oklab, var(--primary) 42%, #ffffff) 0px, color-mix(in oklab, var(--primary) 78%, #140f1a) 3px, color-mix(in oklab, var(--primary) 66%, #0d0a10) 24px, color-mix(in oklab, var(--primary) 88%, #050307) 28px, color-mix(in oklab, var(--primary) 48%, #ffffff) 30px)",
            opacity: 0.92,
          }}
        />
        {/* Vertical side shutter guide tracks */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-y-0 left-0 w-2.5 sm:w-4"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--primary) 92%, #000), color-mix(in oklab, var(--primary) 55%, #1c1722), color-mix(in oklab, var(--primary) 88%, #000))",
            borderRight: "1px solid color-mix(in oklab, var(--primary) 40%, #ffffff)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-y-0 right-0 w-2.5 sm:w-4"
          style={{
            background:
              "linear-gradient(270deg, color-mix(in oklab, var(--primary) 92%, #000), color-mix(in oklab, var(--primary) 55%, #1c1722), color-mix(in oklab, var(--primary) 88%, #000))",
            borderLeft: "1px solid color-mix(in oklab, var(--primary) 40%, #ffffff)",
          }}
        />

        {/* Top header housing bar */}
        <div
          className="relative z-10 flex items-center justify-between px-5 py-3 sm:px-8"
          style={{
            backgroundColor: "color-mix(in oklab, var(--primary) 85%, #07050a)",
            borderBottom: "1px solid color-mix(in oklab, var(--primary) 38%, #ffffff)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <CampuLogo className="h-8 w-8 rounded-xl ring-1 ring-white/30" />
            <span className="font-display text-lg font-extrabold tracking-tight text-white">
              Campu
            </span>
          </div>
          {handleClose ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleClose}
              className="h-9 rounded-xl border-white/25 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 hover:text-white"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              {preview ? "Close Preview" : "Back"}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/90">
              <span className="h-2 w-2 rounded-full bg-white" />
              Closed
            </span>
          )}
        </div>

        {/* Center themed shutter card + Home screen app icon + animated padlock */}
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-7 text-center">
          {/* App Home Screen Icon + Animated Padlock badge */}
          <div className="animate-padlock-snap relative mb-5 flex items-center justify-center">
            <div className="relative flex h-24 w-24 items-center justify-center rounded-[28px] border-2 border-white/35 bg-card p-2 shadow-[0_16px_42px_rgba(0,0,0,0.45)]">
              <CampuLogo className="h-full w-full rounded-[20px] shadow-none" />
              {/* Snapping padlock emblem anchored on corner */}
              <div
                className="absolute -bottom-2.5 -right-2.5 flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-card shadow-lg"
                style={{
                  backgroundColor: "var(--primary)",
                }}
              >
                <svg
                  viewBox="0 0 64 64"
                  className="h-7 w-7"
                  fill="none"
                  aria-hidden="true"
                >
                  <g className="animate-shackle-lock">
                    <path
                      d="M21 30V21a11 11 0 0 1 22 0v9"
                      stroke="#ffffff"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                  </g>
                  <rect
                    x="13"
                    y="29"
                    width="38"
                    height="27"
                    rx="7"
                    fill="#ffffff"
                  />
                  <circle cx="32" cy="40.5" r="3.4" style={{ fill: "var(--primary)" }} />
                  <path
                    d="M30.5 42.5h3l1 6.5h-5l1-6.5Z"
                    style={{ fill: "var(--primary)" }}
                  />
                </svg>
              </div>
            </div>
          </div>

          <div className="animate-shutter-card-reveal w-full rounded-3xl border border-primary/25 bg-card/95 p-6 text-card-foreground shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              Shop Shutter Locked
            </p>
            <h1 className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
              Store is Closed
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {closedMessage}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your cart items are saved — ordering will resume once we reopen.
            </p>

            {/* Morning Opening Time + Live Countdown */}
            <div className="mt-5 rounded-2xl border border-primary/25 bg-accent/55 p-4">
              <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                <Clock className="h-3.5 w-3.5" />
                <span>Opens in the Morning</span>
              </div>
              <p className="mt-1.5 font-display text-2xl font-extrabold text-foreground tabular-nums">
                {clockLabel}{" "}
                <span className="text-sm font-semibold text-muted-foreground">IST</span>
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                {reopenDayText}
              </p>
              {remainingMs > 0 && (
                <div className="mt-3 border-t border-border/80 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Reopening in
                  </p>
                  <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-primary tabular-nums">
                    {countdownLabel(remainingMs)}
                  </p>
                </div>
              )}
            </div>

            {/* Navigation actions including Home screen button */}
            {!preview && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <Link
                  to="/"
                  onClick={onDismiss}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs transition-opacity hover:opacity-95"
                >
                  <Home className="h-4 w-4" />
                  Home
                </Link>
                <Link
                  to="/orders"
                  onClick={onDismiss}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <ReceiptText className="h-4 w-4" />
                  My Orders
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    search={{ tab: "settings" }}
                    onClick={onDismiss}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/35 bg-accent px-4 py-2 text-xs font-bold text-primary transition-colors hover:opacity-90"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Open Store (Admin)
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Heavy bottom shutter bar with metallic rivets */}
        <div
          className="relative z-10 mt-auto px-6 py-3.5"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--primary) 64%, #100c14), color-mix(in oklab, var(--primary) 88%, #040306))",
            borderTop: "2px solid color-mix(in oklab, var(--primary) 35%, #ffffff)",
          }}
        >
          <div className="mx-auto flex max-w-md items-center justify-between">
            <span className="h-2.5 w-2.5 rounded-full border border-white/40 bg-white/20" />
            <div className="flex items-center gap-2 rounded-lg border border-white/25 bg-black/25 px-4 py-1 text-[11px] font-bold uppercase tracking-widest text-white/90">
              <LockOpen className="h-3 w-3 opacity-80" />
              <span>Opens {clockLabel} IST</span>
            </div>
            <span className="h-2.5 w-2.5 rounded-full border border-white/40 bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
