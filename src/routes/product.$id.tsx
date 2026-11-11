import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { rupees } from "@/lib/format";
import { productsQuery, settingsQuery } from "@/lib/queries";
import { MODE_LABEL, deliveryInfoText, productInMode, setDeliveryMode, useDeliveryMode } from "@/lib/delivery";

export const Route = createFileRoute("/product/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Product — Campu" },
      { name: "description", content: "Product details and similar items on Campu campus delivery." },
      { property: "og:title", content: "Product — Campu" },
      { property: "og:description", content: "Product details and similar items on Campu." },
    ],
  }),
  component: ProductDetail,
});

function ProductDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { add, items } = useCart();
  const [qty, setQty] = useState(1);
  const products = useQuery(productsQuery);

  const product = (products.data ?? []).find((p) => p.id === id);
  const cartQty = items.find((item) => item.id === id)?.qty ?? 0;
  const mode = useDeliveryMode();
  const settings = useQuery(settingsQuery);
  const allowed = product ? productInMode(product.delivery_types, mode) : false;
  const otherMode = mode === "quick" ? "sunday_tuesday" : "quick";
  const similar = (products.data ?? []).filter(
    (p) => p.id !== id && p.category_id === product?.category_id && productInMode(p.delivery_types, mode),
  );

  if (products.isLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="h-72 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!product) {
    return (
      <AppShell>
        <div className="p-10 text-center text-sm text-muted-foreground">Item not found.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 pt-4">
        <button
          onClick={() => router.history.back()}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="animate-fly-in grid aspect-square w-full place-items-center overflow-hidden rounded-3xl bg-brand-soft">
          {product.image_url ? (
            <CatalogImage source={product.image_url} alt={product.name} priority className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-6xl font-bold text-brand">
              {product.name.slice(0, 1)}
            </span>
          )}
        </div>

        <div className="mt-4">
          <h1 className="font-display text-2xl font-bold">{product.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{product.description}</p>
          <p className="mt-3 font-display text-2xl font-extrabold text-brand">
            {rupees(product.price)}
          </p>
          {allowed && <p className="mt-2 text-sm font-semibold text-primary">{deliveryInfoText(mode, settings.data)}</p>}
          {!product.in_stock && (
            <p className="mt-2 inline-block rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              Currently out of stock
            </p>
          )}
        </div>

        {!allowed ? (
          <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-sm font-semibold">Available in {MODE_LABEL[otherMode]} only</p>
            <Button className="mt-3 h-11 w-full rounded-full bg-brand font-semibold text-primary-foreground" onClick={() => setDeliveryMode(otherMode)}>
              Switch to {MODE_LABEL[otherMode]}
            </Button>
          </div>
        ) : (
        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-full border border-border px-3 py-2">
            <button onClick={() => setQty((n) => Math.max(1, n - 1))} aria-label="Decrease" disabled={qty <= 1}>
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center font-semibold">{qty}</span>
            <button onClick={() => setQty((n) => Math.min(Math.max(1, product.stock_quantity - cartQty), n + 1))} aria-label="Increase" disabled={qty >= Math.max(1, product.stock_quantity - cartQty)}>
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <Button
            disabled={!product.in_stock || cartQty >= product.stock_quantity}
            className="h-12 flex-1 rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float hover:opacity-95"
            onClick={() => {
              add(
                {
                  id: product.id,
                  name: product.name,
                  price: Number(product.price),
                  image_url: product.image_url,
                },
                Math.min(qty, Math.max(0, product.stock_quantity - cartQty)),
              );
              toast.success(`Added ${Math.min(qty, Math.max(0, product.stock_quantity - cartQty))} × ${product.name}`);
            }}
          >
            Add to cart
          </Button>
        </div>
        )}

        {similar.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-display text-lg font-bold">Similar items</h2>
            <div className="grid grid-cols-2 gap-3">
              {similar.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
