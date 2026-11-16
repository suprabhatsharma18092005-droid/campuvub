import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { HeroCarousel, bannersQuery } from "@/components/HeroCarousel";
import { NotificationPermissionBanner } from "@/components/NotificationPermissionBanner";
import { PopularCategoriesSection } from "@/components/PopularCategoriesSection";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { ProductCard, type Product } from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { VipHomeBanner, VipPopup } from "@/components/VipBanner";
import { type CatalogSelection } from "@/lib/catalog-hierarchy";
import { CATEGORY_MODES_KEY, isCategoryInMode, parseCategoryModes } from "@/lib/category-modes";
import { productInMode, useDeliveryMode } from "@/lib/delivery";
import { brandsQuery, categoriesQuery, productsQuery, subcategoriesQuery } from "@/lib/queries";
import { useVip } from "@/lib/vip";

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
  const navigate = useNavigate();
  const products = useQuery(productsQuery);
  const categories = useQuery(categoriesQuery);
  const { settings, remaining } = usePreorder();
  const mode = useDeliveryMode();
  const categoryModes = useMemo(
    () => parseCategoryModes(settings.data?.[CATEGORY_MODES_KEY]),
    [settings.data],
  );

  const [randomizedProducts, setRandomizedProducts] = useState<Product[]>([]);
  useEffect(() => {
    const shuffled = [...(products.data ?? [])];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const current = shuffled[i];
      const target = shuffled[j];
      if (current && target) {
        shuffled[i] = target;
        shuffled[j] = current;
      }
    }
    setRandomizedProducts(shuffled);
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
    if (!q.trim()) return inMode;
    const term = q.toLowerCase();
    return inMode.filter((p) => p.name.toLowerCase().includes(term));
  }, [visibleProducts, q, mode, categoryModes]);

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
      <HomeVip />
      <section className="px-4 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search snacks, drinks, essentials…"
            className="h-11 rounded-full border-border/70 bg-card pl-9 shadow-card"
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

      <HomeVipBanner />
      <section className="px-4 pt-4">
        <HeroCarousel />
      </section>

      {(categories.data ?? []).length > 0 && (
        <section className="sticky top-12 z-20 mt-4 border-b border-border/60 bg-background/80 px-4 py-2.5 backdrop-blur-xl">
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
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {list.map((p, i) => (
              <ProductCard key={p.id} product={p} priority={i < 6} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function HomeVip() {
  const vip = useVip();
  return <VipPopup vip={vip} />;
}

function HomeVipBanner() {
  const vip = useVip();
  if (vip.loading || vip.pending) return null;
  return (
    <section className="px-4 pt-4">
      <VipHomeBanner vip={vip} />
    </section>
  );
}
