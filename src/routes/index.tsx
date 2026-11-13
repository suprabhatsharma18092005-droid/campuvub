import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { ProductCard, type Product } from "@/components/ProductCard";
import { Input } from "@/components/ui/input";
import { HeroCarousel } from "@/components/HeroCarousel";
import { brandsQuery, categoriesQuery, productsQuery, subcategoriesQuery } from "@/lib/queries";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { productMatchesSelection, type CatalogSelection } from "@/lib/catalog-hierarchy";
import { bannersQuery } from "@/components/HeroCarousel";
import { DeliveryModeToggle } from "@/components/DeliveryModeToggle";
import { productInMode, useDeliveryMode } from "@/lib/delivery";
import { VipHomeBanner, VipPopup } from "@/components/VipBanner";
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
  const products = useQuery(productsQuery);
  const categories = useQuery(categoriesQuery);
  const subcategories = useQuery(subcategoriesQuery);
  const brands = useQuery(brandsQuery);
  const [selection, setSelection] = useState<CatalogSelection>({});
  const { settings, remaining } = usePreorder();
  const mode = useDeliveryMode();

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

  const visibleProducts = randomizedProducts.length === (products.data ?? []).length
    ? randomizedProducts
    : products.data ?? [];
  const list = useMemo(() => {
    const inMode = visibleProducts.filter((p) => productInMode(p.delivery_types, mode) && productMatchesSelection(p, selection));
    if (!q.trim()) return inMode;
    const term = q.toLowerCase();
    return inMode.filter((p) => p.name.toLowerCase().includes(term));
  }, [visibleProducts, q, mode, selection]);
  const selectionName =
    brands.data?.find((b) => b.id === selection.brand)?.name ??
    subcategories.data?.find((s) => s.id === selection.subcategory)?.name ??
    categories.data?.find((c) => c.id === selection.category)?.name;

  return (
    <AppShell>
      <HomeVip />
      <section className="px-4 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search snacks, drinks, essentials…" className="h-11 rounded-full border-border/70 bg-card pl-9 shadow-card" />
        </div>
      </section>

      {remaining > 0 && <section className="px-4 pt-4"><PreorderNotice remaining={remaining} time={settings.data?.["order_start_time"]} /></section>}

      <HomeVipBanner />
      <section className="px-4 pt-4">
        <HeroCarousel />
      </section>

      {(categories.data ?? []).length > 0 && <section className="px-4 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">Shop by category</h2>
          <Link to="/categories" search={selection} className="text-xs font-semibold text-primary">See all</Link>
        </div>
        <CategoryBrowser selection={selection} onChange={setSelection} />
      </section>}

      <section className="px-4 pt-3">
        <DeliveryModeToggle />
      </section>

      <section className="px-4 pb-36 pt-4">
        <h2 className="mb-3 font-display text-lg font-bold">
          {q ? `Results for "${q}"` : selectionName ?? "Popular right now"}
        </h2>
        {products.isLoading ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{selectionName && !q ? "No products here yet." : "Nothing found. Try another search."}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
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
  if (vip.loading || vip.isVip || vip.pending) return null;
  return <section className="px-4 pt-4"><VipHomeBanner vip={vip} /></section>;
}
