import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Heart, Minus, Plus, ShoppingBag, Star, Zap } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { toggleFavorite, useIsFavorite } from "@/lib/favorites";
import { rupees } from "@/lib/format";
import { getProductPriceDetails } from "@/lib/product-pricing";
import { productsQuery, settingsQuery } from "@/lib/queries";
import { REVIEWS_SETTING_KEY, getProductReviewStats, useLocalReviews } from "@/lib/reviews";
import { MODE_LABEL, deliveryInfoText, productInMode, setDeliveryMode, useDeliveryMode } from "@/lib/delivery";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();
  const { add, setQty, items } = useCart();
  const products = useQuery(productsQuery);
  const saved = useIsFavorite(id);
  const localReviews = useLocalReviews();

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
      <AppShell hideBottomNav>
        <div className="p-4">
          <div className="h-72 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!product) {
    return (
      <AppShell hideBottomNav>
        <div className="p-10 text-center text-sm text-muted-foreground">Item not found.</div>
      </AppShell>
    );
  }

  const pricing = getProductPriceDetails(product.price, product.actual_price);
  const reviewStats = getProductReviewStats(
    product.id,
    settings.data?.[REVIEWS_SETTING_KEY],
    localReviews,
  );
  const canAddMore = product.in_stock && cartQty < product.stock_quantity;
  const canBuyNow = product.in_stock && product.stock_quantity > 0;

  function handleAddToCart() {
    if (!product || !canAddMore) return;
    add(
      {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        image_url: product.image_url,
      },
      1,
    );
    toast.success(`Added ${product.name}`);
  }

  function handleBuyNow() {
    if (!product || !canBuyNow) return;
    if (cartQty === 0) {
      add(
        {
          id: product.id,
          name: product.name,
          price: Number(product.price),
          image_url: product.image_url,
        },
        1,
      );
    }
    void navigate({ to: "/checkout" });
  }

  return (
    <AppShell hideBottomNav>
      <div className="animate-product-enter mx-auto max-w-2xl px-4 pb-28 pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => router.history.back()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            aria-label={saved ? `Remove ${product.name} from favorites` : `Save ${product.name} to favorites`}
            aria-pressed={saved}
            onClick={() => {
              const next = toggleFavorite(product.id);
              toast.success(next ? "Saved to favorites" : "Removed from favorites");
            }}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold shadow-xs transition-all active:scale-95",
              saved
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Heart className={cn("h-4 w-4", saved && "fill-current")} />
            {saved ? "Saved" : "Save"}
          </button>
        </div>

        <div className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
          {product.image_url ? (
            <CatalogImage source={product.image_url} alt={product.name} priority className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-6xl font-bold text-primary">
              {product.name.slice(0, 1)}
            </span>
          )}
          {product.badge_text?.trim() && (
            <span className="absolute left-3 top-3 rounded-full bg-card/95 px-3 py-1 text-xs font-bold text-card-foreground shadow-card">
              {product.badge_text}
            </span>
          )}
        </div>

        <div className="mt-4 rounded-3xl border border-border/70 bg-card p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {product.category_name ? (
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                {product.category_name}
              </p>
            ) : (
              <span />
            )}
            <span className="inline-flex items-center gap-1 text-xs font-bold text-foreground">
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  reviewStats.count > 0
                    ? "fill-amber-400 text-amber-500"
                    : "text-muted-foreground",
                )}
              />
              <span>{reviewStats.count > 0 ? reviewStats.avg.toFixed(1) : "0.0"}</span>
              <span className="font-medium text-muted-foreground">
                ({reviewStats.count} {reviewStats.count === 1 ? "review" : "reviews"})
              </span>
            </span>
          </div>

          <div className="mt-1.5 flex items-start justify-between gap-3">
            <h1 className="font-display text-xl font-extrabold leading-snug text-foreground sm:text-2xl">
              {product.name}
            </h1>
            <div className="shrink-0 text-right">
              <p className="rounded-xl bg-price-badge px-2.5 py-1 font-display text-lg font-extrabold tabular-nums text-price-badge-foreground">
                {rupees(pricing.offerPrice)}
              </p>
              {pricing.actualPrice !== null && (
                <p className="mt-0.5 text-xs text-muted-foreground line-through">
                  {rupees(pricing.actualPrice)}
                </p>
              )}
            </div>
          </div>

          {product.specs_text?.trim() && (
            <p className="mt-2 text-xs font-semibold text-foreground/80">
              {product.specs_text}
            </p>
          )}

          {product.description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
            {allowed ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <span className="h-2 w-2 rounded-full bg-success" />
                {product.tagline?.trim() || deliveryInfoText(mode, settings.data)}
              </p>
            ) : (
              <p className="text-xs font-semibold text-muted-foreground">
                Available in {MODE_LABEL[otherMode]} only
              </p>
            )}

            {!product.in_stock && (
              <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                Out of stock
              </span>
            )}
          </div>
        </div>

        <section className="mt-4 rounded-3xl border border-border/70 bg-card p-4 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Customer Reviews</h2>
            <span className="text-xs font-semibold text-primary">
              {reviewStats.count > 0 ? `${reviewStats.avg.toFixed(1)} ★ (${reviewStats.count})` : "No reviews yet"}
            </span>
          </div>
          {reviewStats.recent.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Reviews open right after delivery OTP verification. Be the first to rate this item!
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {reviewStats.recent.map((rev, i) => (
                <li key={i} className="rounded-2xl border border-border/60 bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold">{rev.userName}</span>
                    <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-600">
                      {"★".repeat(rev.rating)}
                      <span className="text-muted-foreground/40">{"★".repeat(5 - rev.rating)}</span>
                    </span>
                  </div>
                  {rev.comment && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {rev.comment}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {similar.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 font-display text-lg font-bold">Similar items</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3">
              {similar.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Dedicated sticky action bar (bottom navigation is hidden on product pages) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/80 px-4 py-3 pb-safe shadow-float backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5">
          {!allowed ? (
            <Button
              type="button"
              className="h-12 w-full rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-float hover:opacity-95"
              onClick={() => setDeliveryMode(otherMode)}
            >
              Switch to {MODE_LABEL[otherMode]}
            </Button>
          ) : (
            <>
              {cartQty === 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canAddMore}
                  onClick={handleAddToCart}
                  className="h-12 flex-1 rounded-full border-2 border-primary bg-background text-sm font-bold text-primary hover:bg-accent disabled:opacity-45"
                >
                  <ShoppingBag className="mr-1.5 h-4 w-4" />
                  Add to Cart
                </Button>
              ) : (
                <div className="flex h-12 flex-1 items-center justify-between rounded-full border-2 border-primary bg-accent px-2 text-primary shadow-xs">
                  <button
                    type="button"
                    aria-label={`Remove one ${product.name}`}
                    onClick={() => setQty(product.id, cartQty - 1)}
                    className="grid h-9 w-9 place-items-center rounded-full bg-card text-primary shadow-xs transition-transform active:scale-90"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="font-display text-sm font-extrabold tabular-nums">
                    {cartQty} in cart
                  </span>
                  <button
                    type="button"
                    aria-label={`Add one more ${product.name}`}
                    disabled={cartQty >= product.stock_quantity}
                    onClick={() => setQty(product.id, cartQty + 1)}
                    className="grid h-9 w-9 place-items-center rounded-full bg-brand text-primary-foreground shadow-xs transition-transform active:scale-90 disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
              <Button
                type="button"
                disabled={!canBuyNow}
                onClick={handleBuyNow}
                className="h-12 flex-1 rounded-full bg-brand text-sm font-bold text-primary-foreground shadow-float hover:opacity-95 disabled:opacity-45"
              >
                <Zap className="mr-1.5 h-4 w-4" />
                Buy Now · {rupees(pricing.offerPrice * (cartQty > 0 ? cartQty : 1))}
              </Button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
