import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Minus, Plus, Star } from "lucide-react";
import { toast } from "sonner";

import { useCartApi, useCartQty } from "@/lib/cart";
import { toggleFavorite, useIsFavorite } from "@/lib/favorites";
import { rupees } from "@/lib/format";
import { REVIEWS_SETTING_KEY, getProductReviewStats, useLocalReviews } from "@/lib/reviews";
import { cn } from "@/lib/utils";
import { CatalogImage } from "@/components/CatalogImage";
import { useQuery } from "@tanstack/react-query";
import { deliveryInfoText, productInMode, useDeliveryMode } from "@/lib/delivery";
import { settingsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { getProductPriceDetails } from "@/lib/product-pricing";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  image_url: string | null;
  in_stock: boolean;
  category_id: string | null;
  subcategory_id?: string | null;
  brand_id?: string | null;
  stock_quantity: number;
  delivery_types?: string[] | null;
  actual_price?: number | string | null;
  badge_text?: string | null;
  specs_text?: string | null;
  tagline?: string | null;
  category_name?: string | null;
};

function ProductCardImpl({ product, priority = false }: { product: Product; priority?: boolean }) {
  const { add, setQty } = useCartApi();
  // Subscribes to just this product's quantity — a cart change elsewhere never
  // re-renders this card, so Add / + / - feel instant even on long grids.
  const qty = useCartQty(product.id);
  const mode = useDeliveryMode();
  const settings = useQuery(settingsQuery);
  const saved = useIsFavorite(product.id);
  const localReviews = useLocalReviews();
  const reviewStats = getProductReviewStats(
    product.id,
    settings.data?.[REVIEWS_SETTING_KEY],
    localReviews,
  );
  const allowed = productInMode(product.delivery_types, mode);
  const pricing = getProductPriceDetails(product.price, product.actual_price);
  const etaText = product.tagline?.trim() || deliveryInfoText(mode, settings.data);
  const descText = product.specs_text?.trim() || product.description?.trim() || null;
  const discountPct =
    pricing.actualPrice !== null && pricing.actualPrice > pricing.offerPrice
      ? Math.round(((pricing.actualPrice - pricing.offerPrice) / pricing.actualPrice) * 100)
      : 0;

  return (
    <div
      className={cn(
        "royal-card card-cv group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/75 bg-card p-1.5 shadow-card transition-colors duration-150 hover:border-primary/40 sm:p-2",
        !product.in_stock && "opacity-60 grayscale",
      )}
    >
      {/* Square Product Image Frame */}
      <div className="relative">
        <Link to="/product/$id" params={{ id: product.id }} aria-label={`View ${product.name}`}>
          <div className="grid aspect-[1/0.92] w-full place-items-center overflow-hidden rounded-xl bg-white/95">
            {product.image_url ? (
              <CatalogImage
                source={product.image_url}
                alt={product.name}
                priority={priority}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-display text-3xl font-bold text-brand">
                {product.name.slice(0, 1)}
              </span>
            )}
          </div>
        </Link>

        {/* Top-left Soft Discount / Custom Pill (like reference screenshot) */}
        {(discountPct > 0 || product.badge_text?.trim()) && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 max-w-[65%] truncate rounded-full bg-amber-100/95 px-2 py-0.5 text-[10px] font-extrabold text-amber-800 shadow-xs">
            {discountPct > 0 ? `-${discountPct}%` : product.badge_text?.trim()}
          </span>
        )}

        {/* Top-right Favorite Heart */}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={saved ? `Remove ${product.name} from saved items` : `Save ${product.name}`}
          aria-pressed={saved}
          onClick={() => {
            const next = toggleFavorite(product.id);
            toast.success(next ? "Saved to favorites" : "Removed from favorites");
          }}
          className={cn(
            "absolute right-1.5 top-1.5 h-6 w-6 rounded-full bg-card/95 shadow-xs transition-transform active:scale-90 sm:h-7 sm:w-7",
            saved ? "text-destructive" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart className={cn("h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5", saved && "scale-110 fill-current")} />
        </Button>

        {!product.in_stock && (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-foreground/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-background">
            Sold out
          </span>
        )}
      </div>

      {/* Product Body: Title + Description + Price/Add Row + ETA */}
      <div className="flex min-w-0 flex-1 flex-col px-0.5 pt-1.5">
        <Link to="/product/$id" params={{ id: product.id }} className="min-w-0">
          <div className="flex items-start justify-between gap-1">
            <h3 className="line-clamp-1 text-[13px] font-bold leading-snug text-card-foreground sm:text-sm">
              {product.name}
            </h3>
            {reviewStats.count > 0 && (
              <span className="inline-flex shrink-0 items-center gap-0.5 pt-0.5 text-[10px] font-bold text-foreground">
                <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-500" />
                <span className="tabular-nums">{reviewStats.avg.toFixed(1)}</span>
              </span>
            )}
          </div>
          {descText && (
            <p className="mt-0.5 line-clamp-1 text-[10.5px] leading-tight text-muted-foreground">
              {descText}
            </p>
          )}
        </Link>

        {/* Bottom Price Left + ADD Pill Right (replacing the + circle in screenshot) */}
        <div className="mt-auto flex items-end justify-between gap-1.5 pt-1.5">
          <Link to="/product/$id" params={{ id: product.id }} className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1">
              <span className="font-display text-[14px] font-extrabold leading-none tabular-nums text-foreground sm:text-[15px]">
                {rupees(pricing.offerPrice)}
              </span>
              {pricing.actualPrice !== null && (
                <span className="truncate text-[10px] text-muted-foreground line-through">
                  {rupees(pricing.actualPrice)}
                </span>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-1 text-[9.5px] font-medium leading-tight text-muted-foreground">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
              <span className="min-w-0 truncate">{etaText}</span>
            </p>
          </Link>

          {!allowed ? null : product.in_stock ? (
            qty === 0 ? (
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={() =>
                  add({
                    id: product.id,
                    name: product.name,
                    price: Number(product.price),
                    image_url: product.image_url,
                  })
                }
                className="h-7 shrink-0 rounded-full bg-brand px-3 text-[11px] font-extrabold text-primary-foreground shadow-xs transition-transform active:scale-90"
                aria-label={`Add ${product.name} to cart`}
              >
                Add
              </Button>
            ) : (
              <div className="flex h-7 shrink-0 items-center rounded-full bg-brand text-primary-foreground shadow-xs">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => setQty(product.id, qty - 1)}
                  aria-label={`Remove one ${product.name}`}
                  className="h-7 w-6 rounded-full text-primary-foreground hover:bg-white/15 hover:text-primary-foreground active:scale-90"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="min-w-3.5 text-center text-[11px] font-extrabold tabular-nums">
                  {qty}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => setQty(product.id, qty + 1)}
                  disabled={qty >= product.stock_quantity}
                  aria-label={`Add one more ${product.name}`}
                  className="h-7 w-6 rounded-full text-primary-foreground hover:bg-white/15 hover:text-primary-foreground active:scale-90 disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Memoized: a card re-renders only when its own product or quantity changes. */
export const ProductCard = memo(ProductCardImpl);
