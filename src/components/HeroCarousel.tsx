import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { catalogReference, resolveCatalogImage } from "@/lib/catalog-media";
import { cn } from "@/lib/utils";

type Banner = { id: string; image_path: string; alt_text: string; sort_order: number };

export const bannersQuery = {
  staleTime: 5 * 60_000,
  queryKey: ["banners"] as const,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("banners")
      .select("id, image_path, alt_text, sort_order")
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at");
    if (error) throw error;
    return Promise.all(
      ((data ?? []) as Banner[]).map(async (banner) => ({
        ...banner,
        imageUrl: await resolveCatalogImage(catalogReference(banner.image_path)),
      })),
    );
  },
};

export function HeroCarousel({ className }: { className?: string }) {
  const banners = useQuery(bannersQuery);
  const [active, setActive] = useState(0);
  const touchStart = useRef<number | null>(null);
  const items = banners.data ?? [];

  useEffect(() => {
    if (items.length < 2) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % items.length), 3500);
    return () => window.clearInterval(timer);
  }, [items.length]);

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [active, items.length]);

  if (banners.isLoading) {
    return (
      <div
        className={cn(
          "aspect-[16/7] w-full animate-pulse rounded-2xl bg-muted md:aspect-[16/8.5] md:rounded-3xl",
          className,
        )}
      />
    );
  }
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Offers"
      data-no-tab-swipe
      className={cn(
        "group relative aspect-[16/7] w-full overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-card md:aspect-[16/8.5] md:rounded-3xl",
        className,
      )}
      onTouchStart={(event) => {
        touchStart.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientX;
        const start = touchStart.current;
        if (start === null || end === undefined || Math.abs(end - start) < 35) return;
        setActive((current) => (end < start ? current + 1 : current - 1 + items.length) % items.length);
        touchStart.current = null;
      }}
    >
      {items[0]?.imageUrl && <link rel="preload" as="image" href={items[0].imageUrl} fetchPriority="high" />}
      {items.map((banner, index) => (
        <BannerImage
          key={banner.id}
          src={banner.imageUrl ?? undefined}
          alt={banner.alt_text}
          priority={index === 0}
          offset={(index - active) * 100}
        />
      ))}

      {items.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous offer"
            onClick={() => setActive((current) => (current - 1 + items.length) % items.length)}
            className="hidden sm:grid absolute left-3 top-1/2 h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-card opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next offer"
            onClick={() => setActive((current) => (current + 1) % items.length)}
            className="hidden sm:grid absolute right-3 top-1/2 h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-card opacity-0 transition-opacity hover:bg-background group-hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-background/90 px-2.5 py-1 shadow-xs">
            {items.map((banner, index) => (
              <button
                key={banner.id}
                type="button"
                aria-label={`Show offer ${index + 1}`}
                onClick={() => setActive(index)}
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-muted-foreground/40 transition-all",
                  active === index && "w-4 bg-primary",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BannerImage({ src, alt, priority, offset }: { src: string | undefined; alt: string; priority: boolean; offset: number }) {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const reveal = (img: HTMLImageElement) => {
    const done = () => setReady(true);
    if (typeof img.decode === "function") img.decode().then(done, done);
    else done();
  };
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) reveal(img);
  }, [src]);
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      onLoad={(e) => reveal(e.currentTarget)}
      className={cn(
        "absolute inset-0 h-full w-full object-cover transition-[transform,opacity] duration-300 ease-out will-change-transform",
        ready ? "opacity-100" : "opacity-0",
      )}
      style={{ transform: `translateX(${offset}%)` }}
    />
  );
}
