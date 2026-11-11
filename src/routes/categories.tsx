import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { CategoryBrowser } from "@/components/CategoryBrowser";
import { ProductCard } from "@/components/ProductCard";
import { brandsQuery, categoriesQuery, productsQuery, subcategoriesQuery } from "@/lib/queries";
import { productInMode, useDeliveryMode } from "@/lib/delivery";
import { productMatchesSelection, type CatalogSelection } from "@/lib/catalog-hierarchy";
import { bannersQuery } from "@/components/HeroCarousel";

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
  const selection = Route.useSearch();
  const navigate = Route.useNavigate();
  const mode = useDeliveryMode();
  const list = (products.data ?? []).filter((p) => productMatchesSelection(p, selection) && productInMode(p.delivery_types, mode));

  function select(next: CatalogSelection) {
    void navigate({
      search: { category: next.category, subcategory: next.subcategory, brand: next.brand },
      replace: true,
      resetScroll: false,
    });
  }

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <p className="text-xs font-semibold uppercase text-primary">Browse</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Categories</h1>
        <div className="mt-4">
          <CategoryBrowser selection={selection} onChange={select} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 pb-36 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {list.length === 0 && <p className="col-span-2 py-10 text-center text-sm text-muted-foreground">No products in this category yet.</p>}
          {list.map((p, i) => (
            <ProductCard key={p.id} product={p} priority={i < 6} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
