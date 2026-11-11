import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ProductCard } from "@/components/ProductCard";
import { categoriesQuery, productsQuery } from "@/lib/queries";
import { productInMode, useDeliveryMode } from "@/lib/delivery";
import { bannersQuery } from "@/components/HeroCarousel";
import { cn } from "@/lib/utils";

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
  validateSearch: (search: Record<string, unknown>) => ({
    category: typeof search["category"] === "string" ? search["category"] : undefined,
  }),
  loader: ({ context }) => {
    return Promise.all([
      context.queryClient.prefetchQuery(productsQuery),
      context.queryClient.prefetchQuery(categoriesQuery),
      context.queryClient.prefetchQuery(bannersQuery),
    ]).then(() => undefined);
  },
  component: Categories,
});

function Categories() {
  const categories = useQuery(categoriesQuery);
  const products = useQuery(productsQuery);
  const { category } = Route.useSearch();
  const [active, setActive] = useState<string | null>(category ?? null);


  const mode = useDeliveryMode();
  const list = (products.data ?? []).filter((p) => (!active || p.category_id === active) && productInMode(p.delivery_types, mode));

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <p className="text-xs font-semibold uppercase text-primary">Browse</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Categories</h1>
        {(categories.data ?? []).length > 0 && <div data-horizontal-scroll className="mt-4 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] md:grid md:grid-cols-3 md:overflow-visible lg:grid-cols-5">
          <button
            onClick={() => setActive(null)}
            className={cn(
              "whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-card transition-colors",
              !active && "bg-brand text-primary-foreground border-transparent",
            )}
          >
            All
          </button>
          {(categories.data ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={cn(
                "whitespace-nowrap rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-card transition-colors",
                active === c.id && "bg-brand text-primary-foreground border-transparent",
              )}
            >
              {c.emoji} {c.name}
            </button>
          ))}
        </div>}

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
