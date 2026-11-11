import { useQuery } from "@tanstack/react-query";
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

export function HeroCarousel() {
  const banners = useQuery(bannersQuery);
  const [active, setActive] = useState(0);
  const touchStart = useRef<number | null>(null);
  const items = banners.data ?? [];

  useEffect(() => {
    if (items.length < 2) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % items.length), 3000);
    return () => window.clearInterval(timer);
  }, [items.length]);

  useEffect(() => {
    if (active >= items.length) setActive(0);
  }, [active, items.length]);

  if (banners.isLoading) return <div className="aspect-[16/7] w-full animate-pulse rounded-2xl bg-muted" />;
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Offers"
      data-no-tab-swipe
      className="relative aspect-[16/7] overflow-hidden rounded-2xl bg-muted shadow-card"
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
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
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-background/70 px-2 py-1 backdrop-blur-md">
          {items.map((banner, index) => (
            <button
              key={banner.id}
              type="button"
              aria-label={`Show offer ${index + 1}`}
              onClick={() => setActive(index)}
              className={cn("h-1.5 w-1.5 rounded-full bg-muted-foreground/40 transition-all", active === index && "w-4 bg-primary")}
            />
          ))}
        </div>
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
        "absolute inset-0 h-full w-full object-cover transition-[transform,opacity] duration-500 ease-out",
        ready ? "opacity-100" : "opacity-0",
      )}
      style={{ transform: `translateX(${offset}%)` }}
    />
  );
}
