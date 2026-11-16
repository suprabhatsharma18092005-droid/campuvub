import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Coins,
  Crown,
  FileText,
  LogOut,
  MapPin,
  Palette,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/AppShell";
import { ThemePicker } from "@/components/ThemePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { enablePush, pushDeviceId } from "@/lib/push";
import { savePushDevice } from "@/lib/push-device";
import { settingsQuery } from "@/lib/queries";
import { useProfile, useRoles, useSession } from "@/lib/session";
import {
  DEFAULT_THEME_ID,
  THEME_SETTING_KEY,
  applyAppTheme,
  getAppTheme,
  getUserThemeOverride,
  setUserThemeOverride,
  type AppThemeId,
} from "@/lib/themes";
import { useCoinWallet } from "@/lib/coins";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ADMIN_EMAIL } from "@/lib/vip";

const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Please enter your name").max(80),
  phone_number: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, "Enter a valid 10-digit phone number"),
  hostel_details: z.string().trim().min(1, "Hostel block is required").max(60),
  room_number: z.string().trim().min(1, "Room number is required").max(20),
});

export const Route = createFileRoute("/_authenticated/profile")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Your Profile — Campu" },
      { name: "description", content: "Manage your delivery details and account on Campu." },
      { property: "og:title", content: "Your Profile — Campu" },
      { property: "og:description", content: "Manage your delivery details and account on Campu." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { session } = useSession();
  const { data: profile } = useProfile();
  const { data: roles } = useRoles();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { next } = useSearch({ from: "/_authenticated/profile" });

  const [form, setForm] = useState({
    full_name: "",
    phone_number: "",
    hostel_details: "",
    room_number: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(() => next === "checkout");
  const [themeOpen, setThemeOpen] = useState(false);
  const settings = useQuery(settingsQuery);
  const [userTheme, setUserTheme] = useState<AppThemeId | null>(() => getUserThemeOverride());
  const storeDefaultTheme = (settings.data?.[THEME_SETTING_KEY] as AppThemeId | undefined) ?? DEFAULT_THEME_ID;
  const activeThemeId = userTheme ?? storeDefaultTheme;
  const activeTheme = getAppTheme(activeThemeId);

  useEffect(() => {
    if (next === "checkout") setAddressOpen(true);
  }, [next]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushOn(Notification.permission === "granted" && Boolean(profile?.fcm_token));
    }
  }, [profile?.fcm_token]);

  useEffect(() => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name ?? "",
      phone_number: profile.phone_number ?? "",
      hostel_details: profile.hostel_details ?? "",
      room_number: profile.room_number ?? "",
    });
  }, [profile]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const issue of parsed.error.issues) map[String(issue.path[0])] = issue.message;
      setErrors(map);
      return;
    }
    setErrors({});
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, ...parsed.data });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["profile"] });
    toast.success("Delivery details saved");
    setAddressOpen(false);
    if (next === "checkout") void navigate({ to: "/checkout" });
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  async function turnOnNotifications() {
    setPushBusy(true);
    try {
      const result = await enablePush((token) => savePushDevice(token, pushDeviceId()));
      if (result.status === "registered") {
        setPushOn(true);
        if (session?.user.id) {
          void queryClient.invalidateQueries({ queryKey: ["profile", session.user.id] });
        }
        toast.success("Notifications are on & saved to your profile");
        return;
      }
      const messages: Record<string, string> = {
        "not-configured": "Notifications aren't set up yet. Please try again later.",
        unsupported: "This browser can't receive notifications.",
        "open-in-new-tab": "Open the app in its own tab or add it to your home screen first.",
        denied: "Notifications are blocked. Allow them in your browser settings.",
      };
      toast.error(messages[result.status] ?? "Could not turn on notifications");
    } catch (error) {
      toast.error(`Could not turn on notifications: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setPushBusy(false);
    }
  }

  const wallet = useCoinWallet();
  const isAdmin = Boolean(
    roles?.includes("admin") ||
      roles?.includes("vendor") ||
      session?.user.email?.toLowerCase() === ADMIN_EMAIL,
  );
  const isRoyalProfile = isAdmin;

  return (
    <AppShell>
      <div className="px-4 pt-5 pb-8 md:grid md:grid-cols-12 md:items-start md:gap-6">
        <div className="min-w-0 md:col-span-5">
        {isRoyalProfile ? (
          <div className="relative overflow-hidden rounded-3xl border border-primary/50 bg-royal p-4 text-white shadow-float">
            <div className="animate-gold-shimmer pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/30 via-white/80 to-primary/30" />
            <div className="flex items-center gap-3.5">
              <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/25 bg-brand text-primary-foreground shadow-card">
                <Crown className="animate-crown-float h-7 w-7" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-bold text-white/95">
                  <Sparkles className="h-3 w-3 text-white/90" />
                  Admin / Store Owner 👑
                </div>
                <h1 className="mt-1 truncate font-display text-xl font-extrabold text-white">
                  {profile?.full_name || "Campu Master Admin"}
                </h1>
                <p className="truncate text-xs text-white/80">
                  {session?.user.email}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-card">
            <h1 className="font-display text-2xl font-bold">Your profile</h1>
            <p className="text-sm text-muted-foreground">{session?.user.email}</p>
          </div>
        )}
        {isAdmin && (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              type="button"
              variant="default"
              className="h-11 rounded-2xl bg-brand font-bold text-primary-foreground shadow-card"
              onClick={() => navigate({ to: "/admin" })}
            >
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              Admin Panel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-2xl border-primary/35 font-bold text-primary"
              onClick={() => navigate({ to: "/orders" })}
            >
              <ReceiptText className="mr-1.5 h-4 w-4" />
              My Orders
            </Button>
          </div>
        )}

        {/* Campu Coins Wallet */}
        <Link
          to="/coins"
          className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 text-sm font-semibold shadow-card transition-colors hover:bg-muted/40"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <Coins className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5 text-foreground">
                <span>Campu Coins Wallet</span>
                <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  Recommended
                </span>
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground tabular-nums">
                Balance: <strong className="text-primary">{wallet.balance} Coins</strong> (
                {rupees(wallet.balanceInr)}) · Min buy ₹50
              </span>
            </span>
          </span>
          <span className="shrink-0 text-xs font-bold text-primary">Buy / Use →</span>
        </Link>
        </div>

        <div className="min-w-0 md:col-span-7">
        {/* 3. Color Theme (Floating Modal Trigger) */}
        <button
          type="button"
          onClick={() => setThemeOpen(true)}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-all hover:bg-muted/40 active:scale-[0.99] md:mt-0"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <Palette className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Your color theme</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="flex shrink-0 -space-x-1">
                  {activeTheme.swatches.map((hex, i) => (
                    <span
                      key={i}
                      className="h-3.5 w-3.5 rounded-full border border-black/15"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </span>
                <span className="truncate text-xs text-muted-foreground">{activeTheme.name}</span>
              </div>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-primary">
            Change <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>

        {/* 4. Terms & Conditions */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <button
            type="button"
            onClick={() => setTermsOpen((v) => !v)}
            aria-expanded={termsOpen}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-primary" />
              Terms & Conditions
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", termsOpen && "rotate-180")}
            />
          </button>
          {termsOpen && (
            <ul className="mt-3 space-y-2 border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
              <li>
                <strong className="text-foreground">1. Delivery Schedule & Timings:</strong> Orders operate in India Standard Time (Asia/Kolkata). Quick Delivery items arrive within the displayed estimate; Sunday & Tuesday Special Delivery orders are delivered on the upcoming scheduled slot.
              </li>
              <li>
                <strong className="text-foreground">2. Minimum Order &amp; Fees:</strong> Quick Delivery has no minimum order (standard ₹5 UPI / ₹8 COD delivery fees apply). Sunday &amp; Tuesday Special Delivery requires a ₹99 minimum order (₹15 on ₹99–₹299, ₹10 on ₹300+).
              </li>
              <li>
                <strong className="text-foreground">3. Payments & UTR Verification:</strong> All UPI payments require a valid 12-digit UTR/reference number. Duplicate or unverified UTR submissions will be rejected. Confirmed orders cannot be cancelled once dispatched.
              </li>
              <li>
                <strong className="text-foreground">4. Hostel Delivery Policy:</strong> Ensure accurate phone number, hostel block, and room number before checkout so our campus rider can reach you promptly.
              </li>
            </ul>
          )}
        </div>

        {/* 5. Notification Alerts */}
        <div className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Order alerts</p>
            {profile?.fcm_token && (
              <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] font-bold text-success">
                Saved to profile
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Get a notification on this device when your order is accepted, on the way or delivered —
            even when the app is closed.
          </p>
          <Button
            variant={pushOn ? "outline" : "default"}
            disabled={pushBusy}
            className="mt-3 h-11 w-full rounded-full"
            onClick={turnOnNotifications}
          >
            <Bell className="mr-2 h-4 w-4" />
            {pushOn ? "Notifications on — refresh device" : "Turn on & save to profile"}
          </Button>
        </div>

        {/* 6. Delivery Address & Save Details (Placed right before Sign Out, Floating Dialog Trigger) */}
        <button
          type="button"
          onClick={() => setAddressOpen(true)}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-all hover:bg-muted/40 active:scale-[0.99]"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Delivery address & details</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {form.hostel_details && form.room_number
                  ? `${form.full_name || "Saved"} · ${form.hostel_details}, Room ${form.room_number}${form.phone_number ? ` · ${form.phone_number}` : ""}`
                  : "Tap to add name, phone, hostel block & room number"}
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-primary-foreground shadow-xs">
            {form.hostel_details && form.room_number ? "Edit" : "Save details"}
          </span>
        </button>

        {/* 7. Sign Out */}
        <Button variant="ghost" className="mt-4 h-11 w-full rounded-full" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
        </div>

        {/* Floating Color Theme Picker Dialog */}
        <Dialog open={themeOpen} onOpenChange={setThemeOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] min-w-0 max-w-lg overflow-x-hidden overflow-y-auto rounded-3xl border border-border bg-background p-4 sm:p-5">
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-lg font-bold">Choose Color Theme</DialogTitle>
              <DialogDescription className="text-xs">
                Pick any of the 12 color themes — updates instantly across the app.
              </DialogDescription>
            </DialogHeader>
            <ThemePicker
              title="12 Color Themes"
              activeThemeId={activeThemeId}
              showReset={userTheme !== null}
              onSelect={(id, name) => {
                setUserTheme(id);
                setUserThemeOverride(id);
                applyAppTheme(id);
                toast.success(`Theme switched to ${name}`);
                setThemeOpen(false);
              }}
              onReset={() => {
                setUserTheme(null);
                setUserThemeOverride(null);
                applyAppTheme(storeDefaultTheme);
                toast.success("Restored store default theme");
                setThemeOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>

        {/* Floating Delivery Address & Save Details Dialog */}
        <Dialog open={addressOpen} onOpenChange={setAddressOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] min-w-0 max-w-md overflow-x-hidden overflow-y-auto rounded-3xl border border-border bg-card p-5">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2 font-display text-lg font-bold">
                <MapPin className="h-5 w-5 text-primary" />
                Delivery Address & Details
              </DialogTitle>
              <DialogDescription className="text-xs">
                Save your name, mobile number, hostel block and room number for quick delivery.
              </DialogDescription>
            </DialogHeader>

            {next === "checkout" && (
              <div className="rounded-2xl border border-warning/40 bg-warning/15 p-3 text-xs">
                Please complete your phone number, hostel block and room number before placing your
                first order.
              </div>
            )}

            <form onSubmit={save} className="space-y-3.5">
              <Field
                id="full_name"
                label="Full name"
                value={form.full_name}
                error={errors["full_name"]}
                onChange={(v) => setForm({ ...form, full_name: v })}
              />
              <Field
                id="phone_number"
                label="Phone number"
                value={form.phone_number}
                error={errors["phone_number"]}
                placeholder="10-digit mobile number"
                onChange={(v) => setForm({ ...form, phone_number: v.replace(/\D/g, "").slice(0, 10) })}
              />
              <Field
                id="hostel_details"
                label="Hostel block"
                value={form.hostel_details}
                error={errors["hostel_details"]}
                placeholder="e.g. Block C"
                onChange={(v) => setForm({ ...form, hostel_details: v })}
              />
              <Field
                id="room_number"
                label="Room number"
                value={form.room_number}
                error={errors["room_number"]}
                placeholder="e.g. 214"
                onChange={(v) => setForm({ ...form, room_number: v })}
              />

              <Button
                type="submit"
                disabled={busy}
                className="mt-2 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float hover:opacity-95"
              >
                Save details
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-11 rounded-xl"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
