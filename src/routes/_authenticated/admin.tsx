import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Check,
  IndianRupee,
  Megaphone,
  Package,
  Plus,
  Settings2,
  Trash2,
  TriangleAlert,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deliveryLabel, formatDeliveryDate } from "@/lib/delivery";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { AdminSettings } from "@/components/AdminSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { rupees, STATUS_LABELS } from "@/lib/format";
import { notifyBroadcast, updateOrderWithPush } from "@/lib/push.functions";
import { brandsQuery, categoriesQuery, productsQuery, subcategoriesQuery } from "@/lib/queries";
import { CatalogHierarchyManager } from "@/components/admin/CatalogHierarchyManager";
import { OrderSiren } from "@/components/admin/OrderSiren";
import { useRoles, useSession } from "@/lib/session";
import { QR_BUCKET } from "@/lib/upi";
import { catalogReference, removeCatalogImage, uploadCatalogImage } from "@/lib/catalog-media";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Admin Dashboard — Campu" },
      {
        name: "description",
        content: "Live order radar, payment verification and inventory control.",
      },
      { property: "og:title", content: "Admin Dashboard — Campu" },
      {
        property: "og:description",
        content: "Live order radar, payment verification and inventory.",
      },
    ],
  }),
  component: Admin,
});

type OrderRow = {
  id: string;
  student_id: string;
  cart_items: unknown;
  total: number | string;
  subtotal: number | string;
  status: string;
  payment_method: string;
  utr_number: string | null;
  delivery_address: string | null;
  phone_number: string | null;
  delivery_otp: string | null;
  refund_status: string;
  refund_proof_url: string | null;
  created_at: string;
  cancelled_at: string | null;
  delivery_type?: string | null;
  delivery_date?: string | null;
};

type Item = { id?: string; name: string; qty: number; price: number; image_url?: string | null };

const NEXT_ACTION: Record<string, { label: string; status: string } | undefined> = {
  pending: { label: "Accept order", status: "accepted" },
  payment_review: { label: "Verify & accept", status: "accepted" },
  accepted: { label: "Out for delivery", status: "out_for_delivery" },
};

function Admin() {
  const { session } = useSession();
  const { data: roles, isLoading: rolesLoading } = useRoles();
  const queryClient = useQueryClient();
  const updateOrder = useServerFn(updateOrderWithPush);
  const [sound, setSound] = useState(true);
  const seen = useRef<Set<string>>(new Set());

  const isStaff = roles?.includes("admin") ?? false;

  const orders = useQuery({
    queryKey: ["admin-orders"],
    enabled: Boolean(isStaff),
    // Catch-up safety net if a realtime event is missed (sleep, network drop).
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<OrderRow[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const products = useQuery({ ...productsQuery, enabled: Boolean(isStaff) });

  const customers = useQuery({
    queryKey: ["admin-profiles"],
    enabled: Boolean(isStaff),
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, phone_number");
      if (error) throw error;
      return Object.fromEntries(
        (data ?? []).map((p) => [p.id, p.full_name ?? "Student"]),
      ) as Record<string, string>;
    },
  });

  useEffect(() => {
    if (!isStaff) return;
    const channel = supabase
      .channel("admin-radar")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
        const row = payload.new as { id: string };
        if (!seen.current.has(row.id)) {
          seen.current.add(row.id);
          toast.success("New order received!");
        }
        void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaff, queryClient, sound]);

  async function updateStatus(id: string, status: string) {
    try {
      await updateOrder({ data: { orderId: id, status } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update order");
      return;
    }
    toast.success(`Order marked ${STATUS_LABELS[status]}`);
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  /** Marks delivered after OTP match and deducts the sold quantities from stock. */
  async function deliverWithOtp(order: OrderRow, typed: string) {
    if (!order.delivery_otp || typed.trim() !== order.delivery_otp) {
      toast.error("Delivery code does not match. Ask the student to read it again.");
      return false;
    }
    try {
      await updateOrder({ data: { orderId: order.id, status: "delivered", otp: typed.trim() } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not deliver order");
      return false;
    }
    toast.success("Delivered — stock updated");
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    return true;
  }

  async function toggleStock(id: string, inStock: boolean) {
    const { error } = await supabase.from("products").update({ in_stock: inStock }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  if (rolesLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!isStaff) {
    return (
      <AppShell>
        <div className="p-10 text-center">
          <h1 className="font-display text-xl font-bold">Staff only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This dashboard is only available to the Campu administrator. Signed in as {session?.user.email}.
          </p>
        </div>
      </AppShell>
    );
  }

  const all = orders.data ?? [];
  const names = customers.data ?? {};
  const queue = all.filter((o) => o.status === "payment_review");
  const pending = all.filter((o) => ["pending", "payment_review"].includes(o.status));
  const active = all.filter((o) => ["accepted", "out_for_delivery"].includes(o.status));
  const completed = all.filter((o) => o.status === "delivered");
  const cancelled = all.filter((o) => o.status === "cancelled");

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Admin</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSound((s) => !s)}
            className="rounded-full text-xs"
          >
            {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {sound ? "Alerts on" : "Alerts off"}
          </Button>
        </div>

        <OrderSiren orders={all} enabled={sound} />

        <Tabs defaultValue="dashboard" className="mt-4">
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto">
            <TabsTrigger value="dashboard">Stats</TabsTrigger>
            <TabsTrigger value="queue">
              Payments {queue.length > 0 && `(${queue.length})`}
            </TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
            <TabsTrigger value="stock">Inventory</TabsTrigger>
            <TabsTrigger value="blast">Blast</TabsTrigger>
            <TabsTrigger value="settings"><Settings2 className="mr-1 h-4 w-4" /> Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4">
            <Dashboard orders={all} products={products.data ?? []} />
          </TabsContent>

          <TabsContent value="queue" className="mt-4 space-y-3">
            {queue.length === 0 && (
              <Empty icon={Bell} text="No payments waiting for verification." />
            )}
            {queue.map((o) => (
              <div
                key={o.id}
                className="rounded-3xl border-2 border-warning/50 bg-warning/10 p-4 shadow-card"
              >
                <OrderCard order={o} name={names[o.student_id]} />
                <div className="mt-3 rounded-2xl bg-card p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    UTR / Reference
                  </p>
                  <p className="font-display text-xl font-extrabold tracking-widest">
                    {o.utr_number}
                  </p>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() => updateStatus(o.id, "accepted")}
                    className="h-11 flex-1 rounded-full bg-success text-success-foreground hover:opacity-90"
                  >
                    <Check className="mr-1.5 h-4 w-4" /> Verify & Accept
                  </Button>
                  <Button
                    onClick={() => updateStatus(o.id, "cancelled")}
                    variant="outline"
                    className="h-11 flex-1 rounded-full border-destructive text-destructive"
                  >
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

      <TabsContent value="orders" className="mt-4">
            <Tabs defaultValue="active">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="done">Completed</TabsTrigger>
                <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
              </TabsList>

              <TabsContent value="pending" className="mt-4 space-y-3">
                {pending.length === 0 && <Empty icon={Package} text="No pending orders right now." />}
                {pending.map((o) => (
                  <ActiveOrder key={o.id} order={o} name={names[o.student_id]} onAdvance={updateStatus} onDeliver={deliverWithOtp} />
                ))}
              </TabsContent>

              <TabsContent value="active" className="mt-4 space-y-3">
                {active.length === 0 && <Empty icon={Package} text="No active orders right now." />}
                {active.map((o) => (
                  <ActiveOrder
                    key={o.id}
                    order={o}
                    name={names[o.student_id]}
                    onAdvance={updateStatus}
                    onDeliver={deliverWithOtp}
                  />
                ))}
              </TabsContent>

              <TabsContent value="done" className="mt-4 space-y-3">
                {completed.length === 0 && <Empty icon={Check} text="No completed orders yet." />}
                {completed.map((o) => (
                  <div key={o.id} className="rounded-3xl border border-border bg-card p-4 shadow-card">
                    <OrderCard order={o} name={names[o.student_id]} />
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="cancelled" className="mt-4 space-y-3">
                {cancelled.length === 0 && <Empty icon={X} text="No cancelled orders." />}
                {cancelled.map((o) => (
                  <CancelledOrder key={o.id} order={o} name={names[o.student_id]} />
                ))}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="stock" className="mt-4">
            <Inventory products={products.data ?? []} onToggle={toggleStock} />
          </TabsContent>

          <TabsContent value="blast" className="mt-4">
            <BroadcastForm />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <AdminSettings />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function OrderCard({ order, name }: { order: OrderRow; name: string | undefined }) {
  const items = (order.cart_items as Item[]) ?? [];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            #{order.id.slice(0, 8)} ·{" "}
            <span className={cn(order.payment_method === "UPI" ? "text-primary" : "text-warning-foreground")}>
              {order.payment_method}
            </span>
          </p>
          <p className="mt-1">
            <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold", order.delivery_type === "sunday_tuesday" ? "bg-warning/20 text-warning-foreground" : "bg-primary/15 text-primary")}>
              {deliveryLabel(order.delivery_type, order.delivery_date)}
              {order.delivery_type === "sunday_tuesday" && order.delivery_date ? ` · ${formatDeliveryDate(order.delivery_date)}` : ""}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-medium">{name ?? "Student"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {order.delivery_address} · +91 {order.phone_number}
          </p>
        </div>
        <span className="font-display font-bold">{rupees(order.total)}</span>
      </div>

      <ul className="mt-3 space-y-2">
        {items.map((i, idx) => (
          <li key={idx} className="flex items-center gap-2.5">
            {i.image_url ? (
              <CatalogImage source={i.image_url} alt={i.name} className="h-10 w-10 rounded-xl border border-border object-cover" />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-xs">🛍️</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{i.name}</span>
            <span className="text-sm font-semibold">×{i.qty}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        {STATUS_LABELS[order.status]} · {new Date(order.created_at).toLocaleString()}
      </p>
    </div>
  );
}

function ActiveOrder({
  order,
  name,
  onAdvance,
  onDeliver,
}: {
  order: OrderRow;
  name: string | undefined;
  onAdvance: (id: string, status: string) => Promise<void>;
  onDeliver: (order: OrderRow, otp: string) => Promise<boolean>;
}) {
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const next = NEXT_ACTION[order.status];

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <OrderCard order={order} name={name} />

      {order.status === "out_for_delivery" && (
      <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Delivery code from student
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="4-digit code"
            className="h-11 flex-1 rounded-xl text-center font-display text-lg tracking-[0.3em]"
          />
          <Button
            disabled={otp.length !== 4 || busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onDeliver(order, otp);
              setBusy(false);
              if (ok) setOtp("");
            }}
            className="h-11 rounded-full bg-success text-success-foreground hover:opacity-90"
          >
            Mark delivered
          </Button>
        </div>
      </div>
      )}

      <div className="mt-3 flex gap-2">
        {next && (
          <Button
            onClick={() => void onAdvance(order.id, next.status)}
            className="h-10 flex-1 rounded-full bg-brand text-primary-foreground hover:opacity-95"
          >
            {next.label}
          </Button>
        )}
        <Button
          onClick={() => void onAdvance(order.id, "cancelled")}
          variant="ghost"
          className="h-10 rounded-full text-destructive"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CancelledOrder({ order, name }: { order: OrderRow; name: string | undefined }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const isUpi = order.payment_method === "UPI";
  const refunded = order.refund_status === "refunded";

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image of the refund confirmation.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Refund screenshot must be smaller than 5 MB.");
      return;
    }
    setBusy(true);
    const path = `refunds/${order.id}-${Date.now()}-${file.name.replace(/[^\w.-]/g, "")}`;
    const { error: upErr } = await supabase.storage.from(QR_BUCKET).upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg",
    });
    if (upErr) {
      setBusy(false);
      toast.error(upErr.message);
      return;
    }
    const { error } = await supabase
      .from("orders")
      .update({
        refund_status: "refunded",
        refund_proof_url: path,
        refunded_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Refund marked as processed");
    void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <OrderCard order={order} name={name} />
      {isUpi && (
        <div className="mt-3 rounded-2xl border border-border bg-muted/40 p-3">
          {refunded ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-success">
              <Check className="h-4 w-4" /> Refund processed
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Refund {rupees(order.total)} by UPI, then upload the payment screenshot.
              </p>
              <label className="mt-2 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-brand text-sm font-semibold text-primary-foreground">
                <Upload className="h-4 w-4" />
                {busy ? "Uploading…" : "Process refund"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Dashboard({
  orders,
  products,
}: {
  orders: OrderRow[];
  products: { id: string; name: string }[];
}) {
  const today = new Date().toDateString();
  const isToday = (d: string) => new Date(d).toDateString() === today;
  const delivered = orders.filter((o) => o.status === "delivered");
  const totalRevenue = delivered.reduce((s, o) => s + Number(o.total), 0);
  const todayRevenue = delivered
    .filter((o) => isToday(o.created_at))
    .reduce((s, o) => s + Number(o.total), 0);
  const ordersToday = orders.filter((o) => isToday(o.created_at)).length;
  const cancelsToday = orders.filter(
    (o) => o.status === "cancelled" && isToday(o.cancelled_at ?? o.created_at),
  ).length;

  const low = products.filter(
    (p) => ((p as { stock_quantity?: number }).stock_quantity ?? 99) < 5,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total revenue" value={rupees(totalRevenue)} />
        <Stat label="Today's revenue" value={rupees(todayRevenue)} />
        <Stat label="Orders today" value={String(ordersToday)} />
        <Stat label="Cancellations today" value={String(cancelsToday)} />
      </div>
      {low.length > 0 && (
        <div className="rounded-3xl border border-warning/50 bg-warning/10 p-4">
          <p className="flex items-center gap-2 font-display text-sm font-bold">
            <TriangleAlert className="h-4 w-4" /> Low stock
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {low.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span className="font-semibold">
                  {(p as { stock_quantity?: number }).stock_quantity} left
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <IndianRupee className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
    </div>
  );
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  in_stock: boolean;
  image_url?: string | null;
  image_path?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  brand_id?: string | null;
  stock_quantity: number;
  delivery_types?: string[] | null;
};

const NONE = "none";

function Inventory({
  products,
  onToggle,
}: {
  products: ProductRow[];
  onToggle: (id: string, inStock: boolean) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery);
  const allSubcategories = useQuery(subcategoriesQuery).data ?? [];
  const allBrands = useQuery(brandsQuery).data ?? [];
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", category_id: "", subcategory_id: "", brand_id: "", price: "", stock: "10" });
  const subcategoryOptions = allSubcategories.filter((s) => s.category_id === form.category_id);
  const brandOptions = allBrands.filter((b) => b.subcategory_id === form.subcategory_id);
  const [deliveryTypes, setDeliveryTypes] = useState<string[]>(["quick"]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function openAdd() {
    setEditing(null);
    setPhoto(null);
    setForm({ name: "", description: "", category_id: categories.data?.[0]?.id ?? "", subcategory_id: "", brand_id: "", price: "", stock: "10" });
    setDeliveryTypes(["quick"]);
    setAdding(true);
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setPhoto(null);
    setForm({ name: product.name, description: product.description ?? "", category_id: product.category_id ?? "", subcategory_id: product.subcategory_id ?? "", brand_id: product.brand_id ?? "", price: String(product.price), stock: String(product.stock_quantity) });
    setDeliveryTypes(product.delivery_types?.length ? product.delivery_types : ["quick"]);
    setAdding(true);
  }

  async function saveProduct() {
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
      toast.error("Enter a product name, valid price, and whole-number stock quantity.");
      return;
    }
    if (deliveryTypes.length === 0) {
      toast.error("Choose at least one delivery option.");
      return;
    }
    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      if (photo) uploadedPath = await uploadCatalogImage(photo, "products");
      const values = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        brand_id: form.brand_id || null,
        price,
        stock_quantity: stock,
        in_stock: stock > 0,
        delivery_types: deliveryTypes,
        ...(uploadedPath ? { image_path: uploadedPath, image_url: catalogReference(uploadedPath) } : {}),
      };
      const result = editing
        ? await supabase.from("products").update(values).eq("id", editing.id)
        : await supabase.from("products").insert(values);
      if (result.error) throw result.error;
      if (uploadedPath && editing?.image_path) await removeCatalogImage(editing.image_path).catch(() => undefined);
      toast.success(editing ? "Product updated" : "Product added");
      setAdding(false);
      setEditing(null);
      setPhoto(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      if (uploadedPath) await removeCatalogImage(uploadedPath).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const product = products.find((item) => item.id === id);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (product?.image_path) await removeCatalogImage(product.image_path).catch(() => undefined);
    toast.success("Product removed");
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  return (
    <div className="space-y-3">
      <CatalogHierarchyManager products={products} />
      {adding ? (
        <div className="space-y-2 rounded-3xl border border-border bg-card p-4 shadow-card">
          <h2 className="font-display text-lg font-bold">{editing ? "Edit product" : "Add product"}</h2>
          <label className="block text-xs font-medium" htmlFor="product-name">Product Name</label>
          <Input
            id="product-name"
            value={form.name}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            className="h-11 rounded-xl"
          />
          <label className="block text-xs font-medium" htmlFor="product-description">Description</label>
          <Textarea id="product-description" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} className="min-h-20 rounded-xl" />
          <fieldset className="space-y-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-medium">Delivery option (choose at least one)</legend>
            {([["quick", "Quick Delivery"], ["sunday_tuesday", "Sunday/Tuesday Delivery"]] as const).map(([value, label]) => (
              <label key={value} className="flex items-center justify-between gap-3 text-sm">
                <span>{label}</span>
                <Switch
                  checked={deliveryTypes.includes(value)}
                  onCheckedChange={(on) =>
                    setDeliveryTypes((cur) => (on ? Array.from(new Set([...cur, value])) : cur.filter((v) => v !== value)))
                  }
                />
              </label>
            ))}
          </fieldset>
          <label className="block text-xs font-medium">Category</label>
          {(categories.data ?? []).length === 0 ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
              <span>Add a category first</span>
              <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => document.getElementById("category-manager")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Add category
              </Button>
            </div>
          ) : <>
            <Select value={form.category_id} onValueChange={(category_id) => setForm((current) => ({ ...current, category_id, subcategory_id: "", brand_id: "" }))}>
              <SelectTrigger className="h-11 rounded-xl" aria-label="Category"><SelectValue placeholder="Choose category" /></SelectTrigger>
              <SelectContent>{(categories.data ?? []).map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium">Subcategory <span className="text-muted-foreground">(optional)</span></label>
                <Select
                  value={form.subcategory_id || NONE}
                  disabled={subcategoryOptions.length === 0}
                  onValueChange={(value) => setForm((current) => ({ ...current, subcategory_id: value === NONE ? "" : value, brand_id: "" }))}
                >
                  <SelectTrigger className="h-11 rounded-xl" aria-label="Subcategory"><SelectValue placeholder={subcategoryOptions.length ? "None" : "No subcategories"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {subcategoryOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_active ? "" : " (hidden)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium">Brand <span className="text-muted-foreground">(optional)</span></label>
                <Select
                  value={form.brand_id || NONE}
                  disabled={brandOptions.length === 0}
                  onValueChange={(value) => setForm((current) => ({ ...current, brand_id: value === NONE ? "" : value }))}
                >
                  <SelectTrigger className="h-11 rounded-xl" aria-label="Brand"><SelectValue placeholder={brandOptions.length ? "None" : "No brands"} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {brandOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.is_active ? "" : " (hidden)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs font-medium" htmlFor="product-price">Price</label><Input id="product-price" value={form.price} onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))} inputMode="decimal" className="h-11 rounded-xl" /></div>
            <div><label className="block text-xs font-medium" htmlFor="product-stock">Stock Quantity</label><Input id="product-stock" value={form.stock} onChange={(e) => setForm((current) => ({ ...current, stock: e.target.value }))} inputMode="numeric" className="h-11 rounded-xl" /></div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-input px-3 py-3 text-sm font-medium">
            <Upload className="h-4 w-4" /> {photo?.name ?? (editing?.image_path || editing?.image_url ? "Replace product photo" : "Upload product photo")}
            <input type="file" accept="image/*" className="sr-only" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
          </label>
          <div className="flex gap-2">
            <Button
              disabled={saving}
              onClick={() => void saveProduct()}
              className="h-11 flex-1 rounded-full bg-brand text-primary-foreground"
            >
              {saving ? "Saving…" : "Save product"}
            </Button>
            <Button variant="ghost" className="h-11 rounded-full" onClick={() => { setAdding(false); setEditing(null); setPhoto(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={openAdd}
          className="h-11 w-full rounded-full bg-brand text-primary-foreground"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add product
        </Button>
      )}

      {products.map((p) => (
        <div
          key={p.id}
          className="rounded-3xl border border-border bg-card p-3 shadow-card"
        >
          <div className="flex items-center gap-3">
            {p.image_path || p.image_url ? (
              <CatalogImage source={p.image_path ? catalogReference(p.image_path) : p.image_url} alt={p.name} className="h-11 w-11 rounded-xl object-cover" />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted">🛍️</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{p.name}</p>
              <p className="text-xs text-muted-foreground">{rupees(p.price)}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => openEdit(p)} className="h-8 rounded-full px-3 text-xs">Edit</Button>
            <Switch checked={p.in_stock} onCheckedChange={(v) => void onToggle(p.id, v)} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void remove(p.id)}
              aria-label={`Delete ${p.name}`}
              className="h-9 w-9 rounded-full text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{p.stock_quantity} in stock</span>
            {(p.stock_quantity ?? 0) < 5 && (
              <span className="ml-auto rounded-full bg-warning/20 px-2 py-1 text-[11px] font-bold text-warning-foreground">
                Low stock
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Bell; text: string }) {
  return (
    <div className="grid place-items-center gap-2 py-12 text-center text-sm text-muted-foreground">
      <Icon className="h-6 w-6" />
      {text}
    </div>
  );
}

function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const sendBroadcastPush = useServerFn(notifyBroadcast);

  async function send() {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    try {
      const result = await sendBroadcastPush({ data: { title: title.trim(), body: body.trim() } });
      setTitle("");
      setBody("");
      toast.success(result.sent > 0 ? `Announcement saved; push sent to ${result.sent} device(s)` : "Announcement saved; no device push was sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send announcement");
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-card">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Megaphone className="h-5 w-5 text-primary" /> Broadcast center
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Announce flash sales and offers. Students see it instantly in the app.
      </p>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={80}
        placeholder="Title — e.g. Flat 20% off snacks"
        className="mt-3 h-11 rounded-xl"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={300}
        placeholder="Message body"
        className="mt-2 min-h-24 rounded-xl"
      />
      <Button
        onClick={send}
        disabled={busy || !title.trim() || !body.trim()}
        className="mt-3 h-11 w-full rounded-full bg-brand text-primary-foreground hover:opacity-95"
      >
        Send to all
      </Button>
    </div>
  );
}
