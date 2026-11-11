import { memo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Minus, Plus } from "lucide-react";

import { useCartApi, useCartQty } from "@/lib/cart";
import { rupees } from "@/lib/format";
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
  const [saved, setSaved] = useState(false);
  const allowed = productInMode(product.delivery_types, mode);
  const pricing = getProductPriceDetails(product.price, product.actual_price);

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-2.5 shadow-card transition-all sm:p-3",
        !product.in_stock && "opacity-55 grayscale",
      )}
    >
      <div className="relative">
        <Link to="/product/$id" params={{ id: product.id }} aria-label={`View ${product.name}`}>
        <div className="grid aspect-square place-items-center overflow-hidden rounded-xl bg-muted">
          {product.image_url ? (
            <CatalogImage source={product.image_url} alt={product.name} priority={priority} className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-3xl font-bold text-brand">
              {product.name.slice(0, 1)}
            </span>
          )}
        </div>
        </Link>
        {product.badge_text?.trim() && <span className="absolute left-2 top-2 max-w-[70%] truncate rounded-full bg-card/95 px-2.5 py-1 text-[10px] font-semibold text-card-foreground shadow-card">{product.badge_text}</span>}
        <Button type="button" variant="secondary" size="icon" aria-label={saved ? `Remove ${product.name} from saved items` : `Save ${product.name}`} aria-pressed={saved} onClick={() => setSaved((value) => !value)} className={cn("absolute right-2 top-2 h-8 w-8 rounded-full bg-card/95 shadow-card", saved && "text-destructive")}>
          <Heart className={cn("h-4 w-4", saved && "fill-current")} />
        </Button>
        <span className="absolute bottom-2 right-2 rounded-xl bg-price-badge px-2.5 py-1.5 text-sm font-extrabold tabular-nums text-price-badge-foreground shadow-card">{rupees(pricing.offerPrice)}</span>
      </div>

      <Link to="/product/$id" params={{ id: product.id }} className="flex min-w-0 flex-1 flex-col pt-2">
        {product.category_name && <p className="truncate text-[9px] font-bold uppercase leading-4 text-muted-foreground sm:text-[10px]">{product.category_name}</p>}
        <h3 className="line-clamp-2 min-h-9 text-[13px] font-bold leading-[1.2] text-card-foreground sm:text-sm">{product.name}</h3>
        {product.specs_text?.trim() ? <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{product.specs_text}</p> : <p className="mt-1 line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{product.description}</p>}
        <div className="mt-auto border-t border-border/70 pt-2.5">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-display text-base font-extrabold tabular-nums">{rupees(pricing.offerPrice)}</span>
            {pricing.actualPrice !== null && <span className="truncate text-[10px] text-muted-foreground line-through">{rupees(pricing.actualPrice)}</span>}
          </div>
          <p className="mt-1 flex min-w-0 items-start gap-1 text-[10px] leading-[1.25] text-muted-foreground">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
            <span className="line-clamp-2">{product.tagline?.trim() || deliveryInfoText(mode, settings.data)}</span>
          </p>
        </div>
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
            className="absolute bottom-2 right-2 h-8 rounded-full bg-foreground px-3 text-xs font-bold text-background shadow-float transition-transform active:scale-90"
            aria-label={`Add ${product.name} to cart`}
          >
            Add
          </Button>
        ) : (
          <div className="absolute bottom-2 right-2 flex h-8 items-center rounded-full bg-foreground text-background shadow-float">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => setQty(product.id, qty - 1)}
              aria-label={`Remove one ${product.name}`}
              className="h-8 w-8 rounded-full text-background hover:bg-background/10 hover:text-background active:scale-90"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-4 text-center text-xs font-bold tabular-nums">{qty}</span>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => setQty(product.id, qty + 1)}
              disabled={qty >= product.stock_quantity}
              aria-label={`Add one more ${product.name}`}
              className="h-8 w-8 rounded-full text-background hover:bg-background/10 hover:text-background active:scale-90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      ) : (
        <span className="absolute right-3 top-3 rounded-full bg-foreground/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-background">
          Out of stock
        </span>
      )}
    </div>
  );
}

/** Memoized: a card re-renders only when its own product or quantity changes. */
export const ProductCard = memo(ProductCardImpl);
