import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { sendTestPushToMe } from "@/lib/push.functions";

import { ThemePicker } from "@/components/ThemePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { settingsQuery } from "@/lib/queries";
import { DEFAULT_THEME_ID, THEME_SETTING_KEY, applyAppTheme, type AppThemeId } from "@/lib/themes";
import { QR_BUCKET, useUpiQrImage } from "@/lib/upi";
import { CATALOG_BUCKET, catalogReference, removeCatalogImage, resolveCatalogImage, uploadCatalogImage } from "@/lib/catalog-media";

const FEES = [
  { key: "upi_delivery_charge", label: "Standard UPI delivery fee" },
  { key: "night_upi_delivery_charge", label: "Night mode UPI delivery fee" },
  { key: "cod_delivery_charge", label: "COD delivery fee" },
] as const;

export function AdminSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery(settingsQuery);
  const banners = useQuery({
    queryKey: ["admin-banners"],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from("banners").select("id, image_path, alt_text, sort_order, is_active").order("sort_order").order("created_at");
      if (error) throw error;
      return Promise.all((rows ?? []).map(async (banner) => ({ ...banner, imageUrl: await resolveCatalogImage(catalogReference(banner.image_path)) })));
    },
  });
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const qr = useUpiQrImage(data?.["upi_qr_path"] || undefined);

  const [savingTheme, setSavingTheme] = useState<AppThemeId | null>(null);

  useEffect(() => {
    if (data) setValues({
      upi_delivery_charge: data["upi_delivery_charge"] ?? "5",
      night_upi_delivery_charge: data["night_upi_delivery_charge"] ?? "5",
      cod_delivery_charge: data["cod_delivery_charge"] ?? "8",
      upi_id: data["upi_id"] ?? "",
      night_mode_enabled: data["night_mode_enabled"] ?? "false",
      order_start_time: data["order_start_time"] ?? "",
      sunday_tuesday_delivery_time: data["sunday_tuesday_delivery_time"] ?? "10:00",
      quick_delivery_estimate: data["quick_delivery_estimate"] ?? "15–20 min",
      [THEME_SETTING_KEY]: data[THEME_SETTING_KEY] ?? DEFAULT_THEME_ID,
    });
  }, [data]);

  async function selectTheme(themeId: AppThemeId, themeName: string) {
    setValues((prev) => (prev ? { ...prev, [THEME_SETTING_KEY]: themeId } : prev));
    applyAppTheme(themeId);
    setSavingTheme(themeId);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: THEME_SETTING_KEY, value: themeId }, { onConflict: "key" });
    setSavingTheme(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Theme changed to ${themeName}`);
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
  }

  async function save() {
    if (!values) return;
    if (FEES.some(({ key }) => !/^\d+(\.\d{1,2})?$/.test(values[key] ?? ""))) {
      toast.error("Enter valid non-negative delivery fees (up to two decimal places).");
      return;
    }
    if (!values["upi_id"]?.trim()) {
      toast.error("UPI ID is required.");
      return;
    }
    setBusy(true);
    const rows = Object.entries(values).map(([key, value]) => ({ key, value: value.trim() }));
    const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Settings saved");
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    }
  }

  async function uploadQr(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    setUploading(true);
    const extension = file.name.split(".").pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, "") || "png";
    const path = `upi/qr-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(QR_BUCKET).upload(path, file, { contentType: file.type });
    if (uploadError) {
      toast.error(uploadError.message);
    } else {
      const { error } = await supabase.from("app_settings").upsert({ key: "upi_qr_path", value: path }, { onConflict: "key" });
      if (error) toast.error(error.message);
      else {
        toast.success("UPI QR updated");
        void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      }
    }
    setUploading(false);
  }

  async function uploadBanners(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let saved = 0;
    for (const file of Array.from(files)) {
      let path: string | null = null;
      try {
        path = await uploadCatalogImage(file, "banners");
        const { error } = await supabase.from("banners").insert({
          image_path: path,
          alt_text: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120) || "Campu offer",
          sort_order: (banners.data?.length ?? 0) + saved,
        });
        if (error) throw error;
        saved += 1;
      } catch (error) {
        if (path) await removeCatalogImage(path).catch(() => undefined);
        toast.error(error instanceof Error ? error.message : "Banner upload failed.");
      }
    }
    setUploading(false);
    if (saved) {
      toast.success(`${saved} banner${saved === 1 ? "" : "s"} added`);
      void queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
      void queryClient.invalidateQueries({ queryKey: ["banners"] });
    }
  }

  async function deleteBanner(id: string, path: string) {
    const { error } = await supabase.from("banners").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.storage.from(CATALOG_BUCKET).remove([path]);
    toast.success("Banner removed");
    void queryClient.invalidateQueries({ queryKey: ["admin-banners"] });
    void queryClient.invalidateQueries({ queryKey: ["banners"] });
  }

  if (isError) return <p className="py-8 text-center text-sm text-destructive">Could not load settings.</p>;
  if (isLoading || !values) return <p className="py-8 text-center text-sm text-muted-foreground">Loading settings…</p>;

  const activeThemeId = values[THEME_SETTING_KEY] ?? DEFAULT_THEME_ID;

  return (
    <div className="space-y-6 pb-6">
      <ThemePicker
        activeThemeId={activeThemeId}
        disabled={savingTheme !== null}
        description="Choose any of 12 three-color themes. Changes apply across the entire app for all users."
        onSelect={(id, name) => void selectTheme(id, name)}
      />

      <section className="space-y-4">
        <h2 className="font-display text-lg font-bold">Payment settings</h2>
        {FEES.map(({ key, label }) => (
          <div key={key}>
            <label htmlFor={key} className="mb-1 block text-sm font-medium">{label} (₹)</label>
            <Input id={key} type="number" min="0" step="0.01" inputMode="decimal" value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
          </div>
        ))}
        <div>
          <label htmlFor="upi-id" className="mb-1 block text-sm font-medium">UPI ID</label>
          <Input id="upi-id" value={values["upi_id"] ?? ""}
            onChange={(e) => setValues({ ...values, upi_id: e.target.value })} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">UPI QR code</p>
          {qr.data && <img src={qr.data} alt="Current UPI QR code" className="mb-3 h-36 w-36 border border-border bg-card object-contain" />}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium">
            <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : qr.data ? "Replace QR image" : "Upload QR image"}
            <input type="file" accept="image/*" disabled={uploading} className="sr-only" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadQr(file);
              e.target.value = "";
            }} />
          </label>
        </div>
      </section>
      <section className="space-y-4 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-4">
          <div><label htmlFor="night-mode" className="text-sm font-semibold">Enable Night Mode</label>
            <p className="text-xs text-muted-foreground">UPI only, with the night delivery fee.</p></div>
          <Switch id="night-mode" checked={values["night_mode_enabled"] === "true"}
            onCheckedChange={(checked) => setValues({ ...values, night_mode_enabled: String(checked) })} />
        </div>
        <div>
          <label htmlFor="start-time" className="mb-1 block text-sm font-medium">Order start time (IST)</label>
          <Input id="start-time" type="time" value={values["order_start_time"] ?? ""}
            onChange={(e) => setValues({ ...values, order_start_time: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">Before this time each day, checkout shows a live pre-order countdown. Leave blank to accept orders anytime.</p>
        </div>
        <div>
          <label htmlFor="st-time" className="mb-1 block text-sm font-medium">Sunday/Tuesday delivery time (IST)</label>
          <Input id="st-time" type="time" value={values["sunday_tuesday_delivery_time"] ?? ""}
            onChange={(e) => setValues({ ...values, sunday_tuesday_delivery_time: e.target.value })} />
        </div>
        <div>
          <label htmlFor="quick-est" className="mb-1 block text-sm font-medium">Quick delivery estimate</label>
          <Input id="quick-est" value={values["quick_delivery_estimate"] ?? ""} placeholder="15–20 min"
            onChange={(e) => setValues({ ...values, quick_delivery_estimate: e.target.value })} />
        </div>
      </section>
      <section className="space-y-3 border-t border-border pt-5">
        <div>
          <h2 className="font-display text-lg font-bold">Banner management</h2>
          <p className="mt-1 text-xs text-muted-foreground">Upload one or more images for the home carousel.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium">
          <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload banners"}
          <input type="file" accept="image/*" multiple disabled={uploading} className="sr-only" onChange={(event) => { void uploadBanners(event.target.files); event.target.value = ""; }} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(banners.data ?? []).map((banner) => (
            <div key={banner.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <img src={banner.imageUrl ?? undefined} alt={banner.alt_text} className="aspect-[16/9] w-full object-cover" />
              <div className="flex items-center gap-2 p-2">
                <span className="min-w-0 flex-1 truncate text-xs">{banner.alt_text}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${banner.alt_text}`} onClick={() => void deleteBanner(banner.id, banner.image_path)} className="h-8 w-8 text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <Button disabled={busy || uploading} onClick={() => void save()} className="w-full">
        <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save settings"}
      </Button>
      <TestPushButton />
    </div>
  );
}
function TestPushButton() {
  const send = useServerFn(sendTestPushToMe);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      className="w-full rounded-full"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await send();
          if (r.ok) toast.success(r.message);
          else toast.error(r.message, { duration: 10000 });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Test failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Sending…" : "Send test notification to me"}
    </Button>
  );
}
