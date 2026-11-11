import { LayoutGrid } from "lucide-react";

import { CatalogImage } from "@/components/CatalogImage";
import { cn } from "@/lib/utils";

/** Rounded catalogue thumbnail: uploaded image, else emoji, else the name's first letter. */
export function CategoryThumb({
  image,
  emoji,
  name,
  className,
  all = false,
  priority = false,
}: {
  image?: string | null;
  emoji?: string | null;
  name: string;
  className?: string;
  all?: boolean;
  priority?: boolean;
}) {
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden bg-brand-soft text-brand", className)}>
      {all ? (
        <LayoutGrid className="h-1/2 w-1/2" aria-hidden />
      ) : image ? (
        <CatalogImage source={image} alt={name} priority={priority} className="h-full w-full" />
      ) : emoji?.trim() ? (
        <span className="text-[1.6em] leading-none" aria-hidden>{emoji}</span>
      ) : (
        <span className="font-display font-bold" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
