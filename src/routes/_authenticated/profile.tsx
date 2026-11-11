import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Bell, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { enablePush, pushDeviceId } from "@/lib/push";
import { savePushDevice } from "@/lib/push-device";
import { useProfile, useRoles, useSession } from "@/lib/session";

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

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushOn(Notification.permission === "granted");
    }
  }, []);

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
        toast.success("Notifications are on for this device");
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

  const isAdmin = roles?.includes("admin") || roles?.includes("vendor");

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <h1 className="font-display text-2xl font-bold">Your profile</h1>
        <p className="text-sm text-muted-foreground">{session?.user.email}</p>

        {next === "checkout" && (
          <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/15 p-3 text-sm">
            Please complete your phone number, hostel block and room number before placing your
            first order.
          </div>
        )}

        <form onSubmit={save} className="mt-5 space-y-4">
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
            className="h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float hover:opacity-95"
          >
            Save details
          </Button>
        </form>

        <div className="mt-6 rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">Order alerts</p>
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
            {pushOn ? "Notifications on — refresh device" : "Turn on notifications"}
          </Button>
        </div>

        {isAdmin && (
          <Button
            variant="outline"
            className="mt-4 h-11 w-full rounded-full"
            onClick={() => navigate({ to: "/admin" })}
          >
            <ShieldCheck className="mr-2 h-4 w-4" /> Open admin dashboard
          </Button>
        )}

        <Button variant="ghost" className="mt-2 h-11 w-full rounded-full" onClick={signOut}>
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
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
