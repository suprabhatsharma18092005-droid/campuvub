import { useEffect, useRef, useState } from "react";

import { catalogPublicUrl } from "@/lib/catalog-media";
import { cn } from "@/lib/utils";

/**
 * Renders a catalogue photo inside a box that already reserves its space.
 * The brand placeholder stays visible until the image is fully downloaded and
 * decoded, then the complete image fades in — never a half-painted image.
 */
export function CatalogImage({
  source,
  alt,
  className,
  priority = false,
}: {
  source: string | null | undefined;
  alt: string;
  className: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const url = catalogPublicUrl(source);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) reveal(img);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function reveal(img: HTMLImageElement) {
    const done = () => setReady(true);
    if (typeof img.decode === "function") img.decode().then(done, done);
    else done();
  }

  if (!source || !url) return null;
  if (failed) {
    return (
      <div className="grid h-full w-full place-items-center bg-brand-soft font-display text-3xl font-bold text-brand" aria-label={alt}>
        {alt.slice(0, 1)}
      </div>
    );
  }
  return (
    <span className={cn("relative block shrink-0 overflow-hidden bg-brand-soft", className)}>
      <img
        ref={ref}
        src={url}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchPriority: "high" as const } : {})}
        onLoad={(e) => reveal(e.currentTarget)}
        onError={() => setFailed(true)}
        className={cn("h-full w-full object-cover transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")}
      />
    </span>
  );
}
