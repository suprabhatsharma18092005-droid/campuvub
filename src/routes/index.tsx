import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { DeliveryModeToggle } from "@/components/DeliveryModeToggle";
import { HeroCarousel, bannersQuery } from "@/components/HeroCarousel";
import { NotificationPermissionBanner } from "@/components/NotificationPermissionBanner";
import { PopularCategoriesSection } from "@/components/PopularCategoriesSection";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { ProductCard, type Product } from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { type CatalogSelection } from "@/lib/catalog-hierarchy";
import { CATEGORY_MODES_KEY, isCategoryInMode, parseCategoryModes } from "@/lib/category-modes";
import { MODE_LABEL, deliveryInfoText, productInMode, useDeliveryMode } from "@/lib/delivery";
import { brandsQuery, categoriesQuery, productsQuery, subcategoriesQuery } from "@/lib/queries";

const PAGE_SIZE = 24;
const shuffledCache = new WeakMap<Product[], Product[]>();

function shuffleProducts(items: Product[]): Product[] {
  const cached = shuffledCache.get(items);
  if (cached) return cached;
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = shuffled[i];
    const target = shuffled[j];
    if (current && target) {
      shuffled[i] = target;
      shuffled[j] = current;
    }
  }
  shuffledCache.set(items, shuffled);
  return shuffled;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Campu — Campus Delivery in Minutes" },
      {
        name: "description",
        content:
          "Order snacks, drinks, stationery and essentials to your hostel room. Pay by UPI or cash on delivery.",
      },
      { property: "og:title", content: "Campu — Campus Delivery in Minutes" },
      {
        property: "og:description",
        content: "Order snacks, drinks and essentials to your hostel room in minutes.",
      },
    ],
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
  component: Home,
});

function Home() {
  const [q, setQ] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const products = useQuery(productsQuery);
  const categories = useQuery(categoriesQuery);
  const banners = useQuery(bannersQuery);
  const { settings, remaining } = usePreorder();
  const mode = useDeliveryMode();
  const hasBanners = banners.isLoading || (banners.data?.length ?? 0) > 0;
  const categoryModes = useMemo(
    () => parseCategoryModes(settings.data?.[CATEGORY_MODES_KEY]),
    [settings.data],
  );

  // Preserve SSR/hydration match on initial frame, then cache per-session shuffle
  // so navigating back to Home never triggers a redundant full-grid re-shuffle.
  const [randomizedProducts, setRandomizedProducts] = useState<Product[]>(() =>
    products.data ? (shuffledCache.get(products.data) ?? []) : [],
  );

  useEffect(() => {
    if (!products.data) return;
    const next = shuffleProducts(products.data);
    setRandomizedProducts((prev) => (prev === next ? prev : next));
  }, [products.data]);

  const visibleProducts = useMemo(
    () =>
      randomizedProducts.length === (products.data ?? []).length
        ? randomizedProducts
        : (products.data ?? []),
    [randomizedProducts, products.data],
  );

  const list = useMemo(() => {
    const inMode = visibleProducts.filter((p) => {
      if (!productInMode(p.delivery_types, mode)) return false;
      if (p.category_id && !isCategoryInMode(p.category_id, mode, categoryModes)) return false;
      return true;
    });
    const trimmed = q.trim();
    if (!trimmed) return inMode;
    const term = trimmed.toLowerCase();
    return inMode.filter((p) => p.name.toLowerCase().includes(term));
  }, [visibleProducts, q, mode, categoryModes]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [mode, q]);

  const renderedList = useMemo(
    () => (q.trim() ? list : list.slice(0, visibleCount)),
    [list, q, visibleCount],
  );
  const hasMore = !q.trim() && renderedList.length < list.length;

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((c) => Math.min(list.length, c + PAGE_SIZE));
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, list.length]);

  function handleSelectCategory(next: CatalogSelection) {
    if (next.category) {
      void navigate({
        to: "/categories",
        search: {
          category: next.category,
          ...(next.subcategory ? { subcategory: next.subcategory } : {}),
          ...(next.brand ? { brand: next.brand } : {}),
        },
      });
    }
  }

  return (
    <AppShell>
      <section className="px-4 pt-4 lg:flex lg:items-center lg:justify-between lg:gap-6 lg:pt-5">
        <div className="hidden min-w-0 lg:block">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            {MODE_LABEL[mode]}
          </p>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">
            {deliveryInfoText(mode, settings.data)}
          </p>
        </div>
        <div className="relative w-full lg:max-w-md xl:max-w-lg">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search snacks, drinks, essentials…"
            className="h-11 rounded-full border-border/70 bg-card pl-10 shadow-card"
          />
        </div>
      </section>

      {remaining > 0 && (
        <section className="px-4 pt-4">
          <PreorderNotice remaining={remaining} time={settings.data?.["order_start_time"]} />
        </section>
      )}

      <section className="px-4 pt-3 empty:hidden">
        <NotificationPermissionBanner />
      </section>

      <section className="px-4 pt-4">
        {hasBanners ? (
          <div className="grid gap-4 lg:grid-cols-12 lg:items-center lg:gap-5">
            <div className="min-w-0 lg:col-span-8">
              <HeroCarousel />
            </div>
            <div className="hidden min-w-0 lg:col-span-4 lg:flex lg:flex-col lg:gap-3">
              <DeliveryModeToggle variant="showcase" />
            </div>
          </div>
        ) : (
          <div className="hidden space-y-3 lg:block">
            <DeliveryModeToggle variant="showcase" className="lg:grid-cols-2 lg:gap-4" />
          </div>
        )}
      </section>

      {(categories.data ?? []).length > 0 && (
        <section className="sticky top-12 z-20 mt-4 border-b border-border/60 bg-background/95 px-4 py-2.5 md:top-16 md:mx-4 md:rounded-3xl md:border md:border-border/75 md:bg-card/95 md:px-5 md:py-3.5 md:shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold sm:text-base">Shop by category</h2>
            <Link to="/categories" className="text-xs font-semibold text-primary">
              See all
            </Link>
          </div>
          <CategoryBrowser selection={{}} onChange={handleSelectCategory} />
        </section>
      )}

      {!q.trim() && <PopularCategoriesSection />}

      <section className="px-4 pb-36 pt-5">
        <h2 className="mb-3 font-display text-lg font-bold">
          {q ? `Results for "${q}"` : "All products"}
        </h2>
        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-52 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing found. Try another search.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {renderedList.map((p, i) => (
                <ProductCard key={p.id} product={p} priority={i < 4} />
              ))}
            </div>
            {hasMore && (
              <div ref={loadMoreRef} className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => Math.min(list.length, c + PAGE_SIZE))}
                  className="rounded-full border border-border bg-card px-5 py-2 text-xs font-bold text-primary shadow-xs hover:bg-accent"
                >
                  Load more ({list.length - renderedList.length} left)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
