import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { useMemo } from "react";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { CategoryThumb } from "@/components/CategoryThumb";
import { bannersQuery } from "@/components/HeroCarousel";
import { PopularCategoriesSection } from "@/components/PopularCategoriesSection";
import { ProductCard } from "@/components/ProductCard";
import { productMatchesSelection, type CatalogSelection } from "@/lib/catalog-hierarchy";
import { CATEGORY_MODES_KEY, isCategoryInMode, parseCategoryModes } from "@/lib/category-modes";
import { MODE_LABEL, productInMode, useDeliveryMode } from "@/lib/delivery";
import {
  brandsQuery,
  categoriesQuery,
  productsQuery,
  settingsQuery,
  subcategoriesQuery,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Browse Categories — Campu" },
      {
        name: "description",
        content: "Browse snacks, beverages, stationery and daily essentials available on campus.",
      },
      { property: "og:title", content: "Browse Categories — Campu" },
      {
        property: "og:description",
        content: "Browse snacks, beverages, stationery and daily essentials available on campus.",
      },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): CatalogSelection => ({
    category: text(search["category"]),
    subcategory: text(search["subcategory"]),
    brand: text(search["brand"]),
  }),
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.prefetchQuery(productsQuery),
      context.queryClient.prefetchQuery(categoriesQuery),
      context.queryClient.prefetchQuery(subcategoriesQuery),
      context.queryClient.prefetchQuery(brandsQuery),
      context.queryClient.prefetchQuery(bannersQuery),
    ]).then(() => undefined);
  },
  component: Categories,
});

function Categories() {
  const products = useQuery(productsQuery);
  const categories = useQuery(categoriesQuery);
  const subcategories = useQuery(subcategoriesQuery);
  const brands = useQuery(brandsQuery);
  const settings = useQuery(settingsQuery);
  const selection = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode = useDeliveryMode();

  const categoryModes = useMemo(
    () => parseCategoryModes(settings.data?.[CATEGORY_MODES_KEY]),
    [settings.data],
  );

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => isCategoryInMode(c.id, mode, categoryModes)),
    [categories.data, mode, categoryModes],
  );

  const selectedCategory = activeCategories.find((c) => c.id === selection.category)
    ?? (categories.data ?? []).find((c) => c.id === selection.category);

  function select(next: CatalogSelection) {
    void navigate({
      search: {
        ...(next.category ? { category: next.category } : {}),
        ...(next.subcategory ? { subcategory: next.subcategory } : {}),
        ...(next.brand ? { brand: next.brand } : {}),
      },
      replace: true,
      resetScroll: false,
    });
  }

  // ---- Mode 2: Blinkit-style Split Explorer when a Category is selected ----
  if (selectedCategory) {
    const categorySubcategories = (subcategories.data ?? []).filter(
      (s) => s.is_active && s.category_id === selectedCategory.id,
    );
    const activeSubcategory = categorySubcategories.find((s) => s.id === selection.subcategory);

    const activeBrands = (brands.data ?? []).filter((b) => {
      if (!b.is_active) return false;
      if (selection.subcategory) return b.subcategory_id === selection.subcategory;
      return categorySubcategories.some((s) => s.id === b.subcategory_id);
    });

    const filteredProducts = (products.data ?? []).filter(
      (p) =>
        productMatchesSelection(p, {
          category: selectedCategory.id,
          subcategory: selection.subcategory,
          brand: selection.brand,
        }) && productInMode(p.delivery_types, mode),
    );

    const firstBatch = filteredProducts.slice(0, 4);
    const restBatch = filteredProducts.slice(4);

    return (
      <AppShell>
        <div className="animate-product-enter">
          {/* Sticky Category Top Bar */}
          <div className="sticky top-12 z-20 border-b border-border/60 bg-background/95 px-3 py-2.5 md:top-14 md:mx-4 md:mt-3 md:rounded-3xl md:border md:border-border/75 md:bg-card/95 md:px-4 md:shadow-card">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                aria-label="Back to all categories"
                onClick={() => select({})}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground shadow-xs transition-transform active:scale-90"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate font-display text-base font-extrabold leading-tight sm:text-lg">
                  {selectedCategory.name}
                </h1>
                <p className="truncate text-[11px] font-medium text-muted-foreground">
                  {activeSubcategory ? `${activeSubcategory.name} · ` : ""}
                  {MODE_LABEL[mode]} ({filteredProducts.length})
                </p>
              </div>
              {activeCategories.length > 1 && (
                <div className="hidden items-center gap-1.5 overflow-x-auto sm:flex">
                  {activeCategories.slice(0, 5).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => select({ category: cat.id })}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                        cat.id === selectedCategory.id
                          ? "bg-brand text-primary-foreground"
                          : "bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start">
            {/* Left Vertical Subcategory Rail */}
            <aside
              aria-label="Subcategories"
              className="sticky top-[6.6rem] max-h-[calc(100vh-11rem)] w-[4.5rem] shrink-0 overflow-y-auto border-r border-border/60 bg-card/70 py-2 [scrollbar-width:none] sm:w-28"
            >
              <button
                type="button"
                onClick={() => select({ category: selectedCategory.id })}
                className={cn(
                  "relative flex w-full flex-col items-center gap-1 px-1.5 py-2.5 text-center transition-colors",
                  !selection.subcategory ? "bg-accent/70 text-primary" : "text-muted-foreground",
                )}
              >
                {!selection.subcategory && (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                )}
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-primary/20 bg-accent text-primary shadow-xs sm:h-12 sm:w-12">
                  <LayoutGrid className="h-5 w-5" />
                </div>
                <span className="line-clamp-2 text-[10px] font-bold leading-tight sm:text-xs">
                  All
                </span>
              </button>

              {categorySubcategories.map((sub) => {
                const active = selection.subcategory === sub.id;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() =>
                      select({
                        category: selectedCategory.id,
                        subcategory: sub.id,
                      })
                    }
                    className={cn(
                      "relative flex w-full flex-col items-center gap-1 px-1.5 py-2.5 text-center transition-colors",
                      active ? "bg-accent/70 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                    )}
                    <CategoryThumb
                      image={sub.image_url}
                      name={sub.name}
                      className={cn(
                        "h-11 w-11 rounded-2xl border shadow-xs transition-transform sm:h-12 sm:w-12",
                        active ? "scale-105 border-primary" : "border-border/50",
                      )}
                    />
                    <span
                      className={cn(
                        "line-clamp-2 text-[10px] leading-tight sm:text-xs",
                        active ? "font-extrabold text-primary" : "font-medium",
                      )}
                    >
                      {sub.name}
                    </span>
                  </button>
                );
              })}
            </aside>

            {/* Right Main Feed: 2-4 Products -> Brands Showcase -> Remaining Products */}
            <div className="min-w-0 flex-1 px-2 pb-36 pt-2.5 sm:px-4 sm:pt-3">
              {filteredProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No products in this selection right now.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                    {firstBatch.map((p, i) => (
                      <ProductCard key={p.id} product={p} priority={i < 4} />
                    ))}
                  </div>

                  {activeBrands.length > 0 && (
                    <section className="my-4 rounded-2xl border border-border/70 bg-card/85 p-3 shadow-card">
                      <div className="mb-2 flex items-center justify-between">
                        <h2 className="font-display text-sm font-bold">Shop by brand</h2>
                        {selection.brand && (
                          <button
                            type="button"
                            onClick={() =>
                              select({
                                category: selectedCategory.id,
                                subcategory: selection.subcategory,
                              })
                            }
                            className="text-[11px] font-semibold text-primary"
                          >
                            Show all
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {activeBrands.map((b) => {
                          const isActiveBrand = selection.brand === b.id;
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() =>
                                select({
                                  category: selectedCategory.id,
                                  subcategory: selection.subcategory ?? b.subcategory_id,
                                  brand: isActiveBrand ? undefined : b.id,
                                })
                              }
                              aria-pressed={isActiveBrand}
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition-all active:scale-95",
                                isActiveBrand
                                  ? "border-primary bg-accent text-primary shadow-xs"
                                  : "border-border/70 bg-background hover:border-primary/40",
                              )}
                            >
                              <div className="grid aspect-square w-12 place-items-center overflow-hidden rounded-xl bg-accent/50">
                                {b.image_url ? (
                                  <CatalogImage
                                    source={b.image_url}
                                    alt={b.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span className="font-display text-base font-extrabold text-primary">
                                    {b.name.slice(0, 1)}
                                  </span>
                                )}
                              </div>
                              <span className="line-clamp-1 text-[11px] font-bold">{b.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {restBatch.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
                      {restBatch.map((p) => (
                        <ProductCard key={p.id} product={p} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // ---- Mode 1: Category Overview Page (Sticky Categories bar + Popular Right Now + 3-col Square Subcategories, NO products) ----
  return (
    <AppShell>
      {/* Sticky Categories Header & Quick Jump Strip */}
      <section className="sticky top-12 z-20 border-b border-border/60 bg-background/95 px-4 py-2.5 md:top-14 md:mx-4 md:mt-3 md:rounded-3xl md:border md:border-border/75 md:bg-card/95 md:px-5 md:py-3.5 md:shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              {MODE_LABEL[mode]}
            </p>
            <h1 className="font-display text-lg font-extrabold leading-tight">Categories</h1>
          </div>
        </div>
        {activeCategories.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {activeCategories.map((cat) => (
              <Link
                key={cat.id}
                to="/categories"
                search={{ category: cat.id }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:border-primary/50 hover:text-primary active:scale-95"
              >
                <span>{cat.name}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Popular Right Now (3-col square rounded) */}
      <PopularCategoriesSection />

      {/* Category Sections: Category Name -> 3-column Square Rounded Subcategory Grid (no loose products) */}
      <div className="space-y-6 px-4 pb-36 pt-5">
        {activeCategories.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No categories available for {MODE_LABEL[mode]} right now.
          </p>
        ) : (
          activeCategories.map((cat) => {
            const subs = (subcategories.data ?? []).filter(
              (s) => s.is_active && s.category_id === cat.id,
            );
            return (
              <section key={cat.id} className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-base font-extrabold text-foreground sm:text-lg">
                    {cat.name}
                  </h2>
                  <Link
                    to="/categories"
                    search={{ category: cat.id }}
                    className="text-xs font-semibold text-primary"
                  >
                    Explore →
                  </Link>
                </div>

                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
                  {subs.length > 0 ? (
                    subs.map((sub) => (
                      <Link
                        key={sub.id}
                        to="/categories"
                        search={{ category: cat.id, subcategory: sub.id }}
                        className="royal-card card-cv group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-2 shadow-card transition-colors duration-150 active:scale-95"
                      >
                        <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-accent/55">
                          {sub.image_url ? (
                            <CatalogImage
                              source={sub.image_url}
                              alt={sub.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="font-display text-2xl font-bold text-primary">
                              {sub.name.slice(0, 1)}
                            </span>
                          )}
                        </div>
                        <span className="mt-1.5 line-clamp-1 text-center text-xs font-bold text-foreground">
                          {sub.name}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <Link
                      to="/categories"
                      search={{ category: cat.id }}
                      className="royal-card card-cv group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-2 shadow-card transition-colors duration-150 active:scale-95"
                    >
                      <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-accent/55">
                        {cat.image_url ? (
                          <CatalogImage
                            source={cat.image_url}
                            alt={cat.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-display text-2xl font-bold text-primary">
                            {cat.emoji ?? cat.name.slice(0, 1)}
                          </span>
                        )}
                      </div>
                      <span className="mt-1.5 line-clamp-1 text-center text-xs font-bold text-foreground">
                        {cat.name}
                      </span>
                    </Link>
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
