import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  POPULAR_ORDER_SETTING_KEY,
  parsePopularOrder,
  savePopularOrder,
} from "@/lib/popular-order";
import { categoriesQuery, settingsQuery, subcategoriesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type SequenceItem = {
  key: string;
  name: string;
  subcategoryCount: number;
  productCount: number;
  sortOrder: number;
};

export function PopularSequenceCard({
  products,
}: {
  products: { category_id?: string | null; subcategory_id?: string | null }[];
}) {
  const queryClient = useQueryClient();
  const categoriesData = useQuery(categoriesQuery).data;
  const subcategoriesData = useQuery(subcategoriesQuery).data;
  const settings = useQuery(settingsQuery);
  const configuredKeys = useMemo(
    () => parsePopularOrder(settings.data?.[POPULAR_ORDER_SETTING_KEY]),
    [settings.data],
  );

  const availableItems = useMemo<SequenceItem[]>(() => {
    const categories = categoriesData ?? [];
    const subcategories = subcategoriesData ?? [];
    const list: SequenceItem[] = categories.map((cat) => {
      const subcategoryCount = subcategories.filter(
        (s) => s.is_active && s.category_id === cat.id,
      ).length;
      const productCount = products.filter((p) => p.category_id === cat.id).length;
      return {
        key: `cat:${cat.id}`,
        name: cat.name,
        subcategoryCount,
        productCount,
        sortOrder: cat.sort_order,
      };
    });

    const orderIdx = new Map(configuredKeys.map((k, idx) => [k, idx]));
    return list.sort((a, b) => {
      const ia = orderIdx.get(a.key);
      const ib = orderIdx.get(b.key);
      if (ia !== undefined && ib !== undefined) return ia - ib;
      if (ia !== undefined) return -1;
      if (ib !== undefined) return 1;
      return a.sortOrder - b.sortOrder;
    });
  }, [categoriesData, subcategoriesData, products, configuredKeys]);

  const [ordered, setOrdered] = useState<SequenceItem[]>(availableItems);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    setOrdered(availableItems);
  }, [availableItems]);

  async function persistOrder(nextList: SequenceItem[], message?: string) {
    setOrdered(nextList);
    setSaving(true);
    try {
      await savePopularOrder(nextList.map((i) => i.key));
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      if (message) toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save sequence");
    } finally {
      setSaving(false);
    }
  }

  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) {
      return;
    }
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    void persistOrder(next, "Popular sequence updated");
  }

  async function resetOrder() {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .delete()
      .eq("key", POPULAR_ORDER_SETTING_KEY);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    toast.success("Sequence reset to default category order");
  }

  function onTouchDragMove(clientY: number) {
    if (draggingIdx === null || !listRef.current) return;
    const rows = Array.from(listRef.current.querySelectorAll<HTMLLIElement>("[data-seq-idx]"));
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const idx = Number(row.dataset["seqIdx"]);
        if (!Number.isNaN(idx)) setHoverIdx(idx);
        break;
      }
    }
  }

  if (ordered.length === 0) return null;

  return (
    <section className="space-y-2.5 rounded-3xl border border-primary/25 bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 font-display text-base font-bold sm:text-lg">
            <Sparkles className="h-4 w-4 text-primary" />
            Popular Right Now Sequence
          </h2>
          <p className="text-xs text-muted-foreground">
            Drag & drop (or use arrows) to arrange categories. Top 6 appear on Home & Categories (each showing up to 4 subcategories inside).
          </p>
        </div>
        {configuredKeys.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void resetOrder()}
            className="h-8 shrink-0 rounded-full text-[11px]"
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Auto
          </Button>
        )}
      </div>

      {saving && (
        <p className="text-[11px] font-semibold text-primary">Saving sequence…</p>
      )}

      <ul ref={listRef} className="space-y-1.5">
        {ordered.map((item, idx) => {
          const isTopSix = idx < 6;
          const isDragging = draggingIdx === idx;
          const isDropTarget = hoverIdx === idx && draggingIdx !== null && draggingIdx !== idx;

          return (
            <li
              key={item.key}
              data-seq-idx={idx}
              draggable
              onDragStart={(e) => {
                setDraggingIdx(idx);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (hoverIdx !== idx) setHoverIdx(idx);
              }}
              onDragLeave={() => {
                if (hoverIdx === idx) setHoverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingIdx !== null) moveItem(draggingIdx, idx);
                setDraggingIdx(null);
                setHoverIdx(null);
              }}
              onDragEnd={() => {
                setDraggingIdx(null);
                setHoverIdx(null);
              }}
              className={cn(
                "flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition-all select-none",
                isDragging && "scale-[0.98] border-primary bg-accent/70 opacity-75",
                isDropTarget && "border-2 border-primary bg-accent/50",
                !isDragging &&
                  !isDropTarget &&
                  (isTopSix
                    ? "border-border bg-background"
                    : "border-border/50 bg-muted/40 opacity-75"),
              )}
            >
              <button
                type="button"
                aria-label={`Drag ${item.name}`}
                onTouchStart={() => {
                  setDraggingIdx(idx);
                  setHoverIdx(idx);
                }}
                onTouchMove={(e) => {
                  const touch = e.touches[0];
                  if (touch) onTouchDragMove(touch.clientY);
                }}
                onTouchEnd={() => {
                  if (draggingIdx !== null && hoverIdx !== null) {
                    moveItem(draggingIdx, hoverIdx);
                  }
                  setDraggingIdx(null);
                  setHoverIdx(null);
                }}
                className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" />
              </button>

              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold tabular-nums",
                  isTopSix
                    ? "bg-brand text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {idx + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground sm:text-sm">
                  {item.name}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {item.subcategoryCount}{" "}
                  {item.subcategoryCount === 1 ? "subcategory" : "subcategories"} ·{" "}
                  {item.productCount} {item.productCount === 1 ? "item" : "items"}
                </p>
              </div>

              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold",
                  isTopSix ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {isTopSix ? "Shown" : "Extra"}
              </span>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={idx === 0 || saving}
                  onClick={() => moveItem(idx, idx - 1)}
                  aria-label={`Move ${item.name} up`}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border bg-card text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === ordered.length - 1 || saving}
                  onClick={() => moveItem(idx, idx + 1)}
                  aria-label={`Move ${item.name} down`}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border bg-card text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
