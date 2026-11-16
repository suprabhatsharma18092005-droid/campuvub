import { LayoutGrid } from "lucide-react";

import { CatalogImage } from "@/components/CatalogImage";
import { cn } from "@/lib/utils";

/** Rounded catalogue thumbnail: styled All graphic, uploaded image, else emoji, else initial letter. */
export function CategoryThumb({
  image,
  emoji,
  name,
  className,
  all = false,
  priority = false,
}: {
  image?: string | null | undefined;
  emoji?: string | null | undefined;
  name: string;
  className?: string | undefined;
  all?: boolean;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-brand-soft text-primary",
        all && "bg-gradient-to-br from-accent via-secondary to-accent",
        className,
      )}
    >
      {all ? (
        <span className="flex flex-col items-center justify-center gap-0.5 text-primary">
          <LayoutGrid className="h-[1.15em] w-[1.15em]" strokeWidth={2.2} aria-hidden />
          <span className="rounded-full bg-primary/15 px-1.5 py-[1px] text-[8px] font-extrabold uppercase leading-none tracking-wider text-primary">
            ALL
          </span>
        </span>
      ) : image ? (
        <CatalogImage source={image} alt={name} priority={priority} className="h-full w-full" />
      ) : emoji?.trim() ? (
        <span className="text-[1.6em] leading-none" aria-hidden>{emoji}</span>
      ) : (
        <span className="font-display font-bold text-primary" aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
