import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { CategoryThumb } from "@/components/CategoryThumb";
import { brandsQuery, categoriesQuery, subcategoriesQuery } from "@/lib/queries";
import { chooseBrand, chooseCategory, chooseSubcategory, type CatalogSelection } from "@/lib/catalog-hierarchy";
import { cn } from "@/lib/utils";

const ROW = "flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible";

/** Category → Subcategory → Brand browser. Each level appears once its parent is picked. */
export function CategoryBrowser({
  selection,
  onChange,
}: {
  selection: CatalogSelection;
  onChange: (next: CatalogSelection) => void;
}) {
  const categories = useQuery(categoriesQuery).data ?? [];
  const subcategories = (useQuery(subcategoriesQuery).data ?? []).filter(
    (s) => s.is_active && s.category_id === selection.category,
  );
  const brands = (useQuery(brandsQuery).data ?? []).filter(
    (b) => b.is_active && b.subcategory_id === selection.subcategory,
  );
  const category = categories.find((c) => c.id === selection.category);
  const subcategory = subcategories.find((s) => s.id === selection.subcategory);

  if (categories.length === 0) return null;

  return (
    <div className="space-y-3">
      <div data-horizontal-scroll className={ROW}>
        <Tile label="All" all active={!selection.category} onClick={() => onChange(chooseCategory(selection, undefined))} />
        {categories.map((c, i) => (
          <Tile
            key={c.id}
            label={c.name}
            image={c.image_url}
            emoji={c.emoji}
            priority={i < 8}
            active={selection.category === c.id}
            onClick={() => onChange(chooseCategory(selection, c.id))}
          />
        ))}
      </div>

      {category && subcategories.length > 0 && (
        <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-card">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {category.name}
            {subcategory && (
              <>
                <ChevronRight className="h-3 w-3" aria-hidden /> {subcategory.name}
              </>
            )}
          </p>
          <div data-horizontal-scroll className={cn(ROW, "mt-2 gap-2.5")}>
            <Tile small label="All" all active={!selection.subcategory} onClick={() => onChange(chooseSubcategory(selection, undefined))} />
            {subcategories.map((s) => (
              <Tile
                key={s.id}
                small
                label={s.name}
                image={s.image_url}
                active={selection.subcategory === s.id}
                onClick={() => onChange(chooseSubcategory(selection, s.id))}
              />
            ))}
          </div>

          {subcategory && brands.length > 0 && (
            <div className="mt-3 border-t border-border/70 pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Brands</p>
              <div data-horizontal-scroll className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:flex-wrap">
                <BrandChip label="All brands" active={!selection.brand} onClick={() => onChange(chooseBrand(selection, undefined))} />
                {brands.map((b) => (
                  <BrandChip
                    key={b.id}
                    label={b.name}
                    image={b.image_url}
                    active={selection.brand === b.id}
                    onClick={() => onChange(chooseBrand(selection, b.id))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  image,
  emoji,
  active,
  onClick,
  small = false,
  all = false,
  priority = false,
}: {
  label: string;
  image?: string | null;
  emoji?: string | null;
  active: boolean;
  onClick: () => void;
  small?: boolean;
  all?: boolean;
  priority?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("flex shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95", small ? "w-16" : "w-[4.5rem]")}
    >
      <CategoryThumb
        image={image}
        emoji={emoji}
        name={label}
        all={all}
        priority={priority}
        className={cn(
          "rounded-2xl border-2 shadow-card transition-colors",
          small ? "h-12 w-12 text-sm" : "h-16 w-16 text-base",
          active ? "border-primary" : "border-transparent",
        )}
      />
      <span className={cn("line-clamp-2 w-full text-center text-[11px] leading-tight", active ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
        {label}
      </span>
    </button>
  );
}

function BrandChip({ label, image, active, onClick }: { label: string; image?: string | null; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border py-1 pr-3 text-xs font-semibold transition-colors active:scale-95",
        image ? "pl-1" : "pl-3",
        active ? "border-transparent bg-brand text-primary-foreground" : "border-border bg-background text-foreground",
      )}
    >
      {image && <CategoryThumb image={image} name={label} className="h-6 w-6 rounded-full bg-card text-[10px]" />}
      {label}
    </button>
  );
}
