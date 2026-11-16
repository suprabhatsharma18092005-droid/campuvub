import { Check, Download, Palette, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { APP_THEMES, type AppThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function ThemePicker({
  activeThemeId,
  onSelect,
  disabled = false,
  title = "App color theme",
  description,
  onReset,
  showReset = false,
}: {
  activeThemeId: string;
  onSelect: (id: AppThemeId, name: string) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
  onReset?: () => void;
  showReset?: boolean;
}) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const res = await installPrompt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    if (res.outcome === "accepted") {
      toast.success("Installing Campu with your selected theme icon!");
    }
    setInstallPrompt(null);
  }

  return (
    <section className="w-full min-w-0 space-y-3 overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-card sm:p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-base font-bold sm:text-lg">
            <Palette className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate">{title}</span>
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {showReset && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Default
          </button>
        )}
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-4">
        {APP_THEMES.map((theme) => {
          const active = activeThemeId === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(theme.id, theme.name)}
              aria-pressed={active}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border p-2 text-left transition-all active:scale-[0.98] sm:gap-2.5 sm:p-2.5",
                active
                  ? "border-primary bg-accent ring-1 ring-primary"
                  : "border-border bg-background hover:bg-muted/60",
              )}
            >
              <span className="flex shrink-0 -space-x-1.5">
                {theme.swatches.map((hex, i) => (
                  <span
                    key={i}
                    className="h-4 w-4 rounded-full border border-black/15 shadow-xs sm:h-5 sm:w-5"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold sm:text-xs">
                {theme.name}
              </span>
              {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>

      <div className="flex w-full min-w-0 items-center justify-between gap-2.5 overflow-hidden rounded-xl border border-border/70 bg-background px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <img
            src="/pwa-192x192.png"
            alt="App icon preview"
            className="h-9 w-9 shrink-0 rounded-xl shadow-xs"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-foreground">Home screen app icon</p>
            <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">
              This Campu logo appears when installed from your browser.
            </p>
          </div>
        </div>
        {installPrompt && (
          <button
            type="button"
            onClick={() => void installApp()}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-primary-foreground shadow-xs active:scale-95"
          >
            <Download className="h-3.5 w-3.5" /> Install
          </button>
        )}
      </div>
    </section>
  );
}
