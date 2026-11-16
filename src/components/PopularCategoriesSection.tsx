import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { CatalogImage } from "@/components/CatalogImage";
import { type Product } from "@/components/ProductCard";
import { CATEGORY_MODES_KEY, isCategoryInMode, parseCategoryModes } from "@/lib/category-modes";
import { productInMode, useDeliveryMode } from "@/lib/delivery";
import {
  POPULAR_ORDER_SETTING_KEY,
  PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY,
  parsePopularOrder,
  parseSubcategoriesSnapshot,
} from "@/lib/popular-order";
import { categoriesQuery, productsQuery, settingsQuery, subcategoriesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type MiniTile = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type PopularCategoryBox = {
  key: string;
  categoryId: string;
  title: string;
  fallbackImage: string | null;
  tiles: MiniTile[];
  pillLabel: string;
  sortOrder: number;
};

/**
 * 3-column x 2-row (6 boxes) "Popular right now" category showcase.
 * Each category box shows up to 4 of its subcategories in a 2x2 collage
 * (falling back to category products or category image when no subcategories exist yet).
 * Respects Admin's drag-and-drop sequence (`cat:<id>`), then category sort_order.
 */
export function PopularCategoriesSection({ className }: { className?: string }) {
  const categories = useQuery(categoriesQuery);
  const subcategories = useQuery(subcategoriesQuery);
  const products = useQuery(productsQuery);
  const settings = useQuery(settingsQuery);
  const mode = useDeliveryMode();

  const categoryModes = useMemo(
    () => parseCategoryModes(settings.data?.[CATEGORY_MODES_KEY]),
    [settings.data],
  );
  const configuredOrder = useMemo(
    () => parsePopularOrder(settings.data?.[POPULAR_ORDER_SETTING_KEY]),
    [settings.data],
  );
  const snapshotSubcategories = useMemo(
    () => parseSubcategoriesSnapshot(settings.data?.[PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY]),
    [settings.data],
  );

  const popularBoxes = useMemo<PopularCategoryBox[]>(() => {
    const activeCats = (categories.data ?? []).filter((cat) =>
      isCategoryInMode(cat.id, mode, categoryModes),
    );
    if (activeCats.length === 0) return [];

    const liveSubs = subcategories.data ?? [];
    const effectiveSubs = (liveSubs.length > 0 ? liveSubs : snapshotSubcategories).filter(
      (s) => s.is_active,
    );

    const inModeProducts = (products.data ?? []).filter((p) =>
      productInMode(p.delivery_types, mode),
    );

    const orderMap = new Map(configuredOrder.map((k, idx) => [k, idx]));

    const boxes: PopularCategoryBox[] = activeCats.map((cat) => {
      const catSubs = effectiveSubs
        .filter((s) => s.category_id === cat.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

      const catProducts = inModeProducts.filter((p) => p.category_id === cat.id);

      let tiles: MiniTile[] = [];
      let pillLabel = "Explore";

      if (catSubs.length > 0) {
        tiles = catSubs.slice(0, 4).map((sub) => {
          const fallbackProdImg =
            catProducts.find((p) => p.subcategory_id === sub.id && p.image_url)?.image_url ?? null;
          return {
            id: sub.id,
            name: sub.name,
            imageUrl: sub.image_url ?? fallbackProdImg,
          };
        });
        pillLabel =
          catSubs.length > 4
            ? `+${catSubs.length - 4} more`
            : `${catSubs.length} ${catSubs.length === 1 ? "item" : "items"}`;
      } else if (catProducts.length > 0) {
        tiles = catProducts.slice(0, 4).map((p: Product) => ({
          id: p.id,
          name: p.name,
          imageUrl: p.image_url,
        }));
        pillLabel =
          catProducts.length > 4
            ? `+${catProducts.length - 4} more`
            : `${catProducts.length} ${catProducts.length === 1 ? "item" : "items"}`;
      }

      return {
        key: `cat:${cat.id}`,
        categoryId: cat.id,
        title: cat.name,
        fallbackImage: cat.image_url,
        tiles,
        pillLabel,
        sortOrder: cat.sort_order,
      };
    });

    boxes.sort((a, b) => {
      const ia = orderMap.get(a.key);
      const ib = orderMap.get(b.key);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return a.sortOrder - b.sortOrder;
    });

    return boxes.slice(0, 6);
  }, [
    categories.data,
    subcategories.data,
    snapshotSubcategories,
    products.data,
    mode,
    categoryModes,
    configuredOrder,
  ]);

  if (popularBoxes.length === 0) return null;

  return (
    <section className={cn("px-4 pt-4", className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Popular right now</h2>
        <Link to="/categories" className="text-xs font-semibold text-primary">
          Explore all
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {popularBoxes.map((box) => (
          <Link
            key={box.key}
            to="/categories"
            search={{ category: box.categoryId }}
            className="group flex min-w-0 flex-col items-center rounded-[20px] border border-border/60 bg-category-tile/85 p-1.5 pb-2.5 shadow-card transition-all duration-200 hover:-translate-y-0.5 active:scale-95 sm:rounded-3xl sm:p-2 sm:pb-3"
          >
            {/* Square 2x2 collage of subcategories inside this category + overlapping bottom-center pill */}
            <div className="relative w-full pb-2.5">
              <div className="aspect-square w-full overflow-hidden rounded-2xl">
                {box.tiles.length >= 2 ? (
                  <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-1">
                    {Array.from({ length: 4 }).map((_, idx) => {
                      const tile = box.tiles[idx];
                      if (!tile) {
                        return (
                          <div
                            key={idx}
                            className="grid place-items-center rounded-[10px] bg-card/75"
                          />
                        );
                      }
                      return (
                        <div
                          key={tile.id}
                          className="grid place-items-center overflow-hidden rounded-[10px] bg-card shadow-2xs"
                        >
                          {tile.imageUrl ? (
                            <CatalogImage
                              source={tile.imageUrl}
                              alt={tile.name}
                              priority
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          ) : (
                            <span className="px-1 text-center font-display text-[10px] font-bold leading-tight text-primary line-clamp-2">
                              {tile.name}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : box.tiles[0]?.imageUrl || box.fallbackImage ? (
                  <div className="grid h-full w-full place-items-center overflow-hidden rounded-2xl bg-card shadow-2xs">
                    <CatalogImage
                      source={box.tiles[0]?.imageUrl ?? box.fallbackImage}
                      alt={box.tiles[0]?.name ?? box.title}
                      priority
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl bg-card">
                    <span className="font-display text-2xl font-bold text-primary">
                      {box.title.slice(0, 1)}
                    </span>
                  </div>
                )}
              </div>

              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border/80 bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-xs sm:px-2.5 sm:text-[11px]">
                {box.pillLabel}
              </span>
            </div>

            <p className="mt-1 line-clamp-2 min-h-[2rem] px-0.5 text-center text-[11.5px] leading-tight font-bold text-foreground sm:min-h-[2.25rem] sm:text-[13px]">
              {box.title}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
