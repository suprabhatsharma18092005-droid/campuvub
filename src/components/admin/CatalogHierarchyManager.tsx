import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CategoryThumb } from "@/components/CategoryThumb";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { removeCatalogImageUrl, uploadCatalogImageUrl } from "@/lib/catalog-media";
import {
  CATEGORY_MODES_KEY,
  getCategoryModeVisibility,
  parseCategoryModes,
  saveCategoryModeVisibility,
  type CategoryModeVisibility,
  type CategoryModesMap,
} from "@/lib/category-modes";
import { brandsQuery, categoriesQuery, settingsQuery, subcategoriesQuery } from "@/lib/queries";
import {
  PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY,
  syncSubcategoriesSnapshot,
} from "@/lib/popular-order";
import { PopularSequenceCard } from "@/components/admin/PopularSequenceCard";
import { cn } from "@/lib/utils";

type NodeTable = "categories" | "subcategories" | "brands";
type CatalogNode = {
  id: string;
  name: string;
  image_url: string | null;
  emoji?: string | null | undefined;
  is_active?: boolean | undefined;
};
type Parent = { category_id?: string; subcategory_id?: string };

async function writeNode(
  table: NodeTable,
  id: string | null,
  values: { name: string; image_url: string | null },
  parent: Parent,
  sortOrder: number,
) {
  switch (table) {
    case "categories":
      return id
        ? await supabase.from("categories").update(values).eq("id", id).select("id").single()
        : await supabase
            .from("categories")
            .insert({ ...values, sort_order: sortOrder })
            .select("id")
            .single();
    case "subcategories":
      return id
        ? await supabase.from("subcategories").update(values).eq("id", id).select("id").single()
        : await supabase
            .from("subcategories")
            .insert({ ...values, sort_order: sortOrder, category_id: parent.category_id! })
            .select("id")
            .single();
    case "brands":
      return id
        ? await supabase.from("brands").update(values).eq("id", id).select("id").single()
        : await supabase
            .from("brands")
            .insert({ ...values, sort_order: sortOrder, subcategory_id: parent.subcategory_id! })
            .select("id")
            .single();
  }
}

async function deleteNode(table: NodeTable, id: string) {
  return await supabase.from(table).delete().eq("id", id);
}

async function setNodeActive(table: "subcategories" | "brands", id: string, is_active: boolean) {
  return table === "subcategories"
    ? await supabase.from("subcategories").update({ is_active }).eq("id", id)
    : await supabase.from("brands").update({ is_active }).eq("id", id);
}

/** Admin manager for the Category → Subcategory → Brand tree, with image uploads and Quick / Sun-Tue Special visibility checkboxes per category. */
export function CatalogHierarchyManager({
  products,
}: {
  products: { category_id?: string | null; subcategory_id?: string | null }[];
}) {
  const queryClient = useQueryClient();
  const categories = useQuery(categoriesQuery).data ?? [];
  const subcategoriesQueryResult = useQuery(subcategoriesQuery);
  const subcategories = useMemo(
    () => subcategoriesQueryResult.data ?? [],
    [subcategoriesQueryResult.data],
  );
  const brands = useQuery(brandsQuery).data ?? [];
  const settings = useQuery(settingsQuery);
  const categoryModes = useMemo(
    () => parseCategoryModes(settings.data?.[CATEGORY_MODES_KEY]),
    [settings.data],
  );

  // Keep a public snapshot of active subcategories in app_settings so unauthenticated/SSR Popular Right Now tiles render subcategory images immediately.
  useEffect(() => {
    if (!subcategoriesQueryResult.isSuccess || !settings.isSuccess) return;
    const activeJson = JSON.stringify(
      subcategories
        .filter((s) => s.is_active)
        .map((s) => ({
          id: s.id,
          category_id: s.category_id,
          name: s.name,
          image_url: s.image_url,
          sort_order: s.sort_order,
          is_active: true,
        })),
    );
    if (settings.data?.[PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY] === activeJson) return;
    void syncSubcategoriesSnapshot(subcategories)
      .then(() => queryClient.invalidateQueries({ queryKey: ["app_settings"] }))
      .catch(() => undefined);
  }, [
    subcategories,
    subcategoriesQueryResult.isSuccess,
    settings.isSuccess,
    settings.data,
    queryClient,
  ]);

  async function updateCategoryVisibility(categoryId: string, next: CategoryModeVisibility) {
    if (!next.quick && !next.sunday_tuesday) {
      toast.error("Keep at least one delivery mode checked for a category.");
      return;
    }
    try {
      await saveCategoryModeVisibility(categoryId, next, categoryModes);
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      toast.success("Category delivery visibility updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update delivery visibility");
    }
  }

  return (
    <div className="space-y-4">
      <PopularSequenceCard products={products} />
      <div
        id="category-manager"
        className="scroll-mt-20 space-y-2 rounded-3xl border border-border bg-card p-4 shadow-card"
      >
        <h2 className="font-display text-lg font-bold">Categories, Subcategories & Delivery Modes</h2>
        <p className="text-xs text-muted-foreground">
          Create categories, check where they appear (Quick vs Sun/Tue Special & Popular Right Now),
          and expand a row to add subcategories & brands.
        </p>
      <NodeLevel
        table="categories"
        singular="category"
        items={categories}
        parent={{}}
        categoryModes={categoryModes}
        onToggleCategoryMode={updateCategoryVisibility}
        childLabel="subcategories"
        childCount={(id) => subcategories.filter((s) => s.category_id === id).length}
        blockDelete={(id) =>
          products.some((p) => p.category_id === id)
            ? "Move or delete the products in this category first."
            : null
        }
        renderChildren={(category) => (
          <NodeLevel
            table="subcategories"
            singular="subcategory"
            heading={`Subcategories in ${category.name}`}
            items={subcategories.filter((s) => s.category_id === category.id)}
            parent={{ category_id: category.id }}
            childLabel="brands"
            childCount={(id) => brands.filter((b) => b.subcategory_id === id).length}
            confirmDelete={(name) =>
              `Delete subcategory "${name}" and its brands? Its products stay in the category.`
            }
            renderChildren={(subcategory) => (
              <NodeLevel
                table="brands"
                singular="brand"
                heading={`Brands in ${subcategory.name}`}
                items={brands.filter((b) => b.subcategory_id === subcategory.id)}
                parent={{ subcategory_id: subcategory.id }}
                confirmDelete={(name) =>
                  `Delete brand "${name}"? Its products stay in the subcategory.`
                }
              />
            )}
          />
        )}
      />
      </div>
    </div>
  );
}

function NodeLevel({
  table,
  singular,
  heading,
  items,
  parent,
  categoryModes,
  onToggleCategoryMode,
  childLabel,
  childCount,
  blockDelete,
  confirmDelete,
  renderChildren,
}: {
  table: NodeTable;
  singular: string;
  heading?: string;
  items: CatalogNode[];
  parent: Parent;
  categoryModes?: CategoryModesMap;
  onToggleCategoryMode?: (categoryId: string, next: CategoryModeVisibility) => Promise<void>;
  childLabel?: string;
  childCount?: (id: string) => number;
  blockDelete?: (id: string) => string | null;
  confirmDelete?: (name: string) => string;
  renderChildren?: (node: CatalogNode) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CatalogNode | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [keptImage, setKeptImage] = useState<string | null>(null);
  const [formModes, setFormModes] = useState<CategoryModeVisibility>({
    quick: true,
    sunday_tuesday: true,
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const preview = useObjectUrl(file);
  const label = singular.charAt(0).toUpperCase() + singular.slice(1);

  function reset() {
    setEditing(null);
    setName("");
    setFile(null);
    setKeptImage(null);
    setFormModes({ quick: true, sunday_tuesday: true });
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [table] });
    if (table !== "categories") void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      toast.error(`Enter a ${singular} name (max 40 characters).`);
      return;
    }
    if (table === "categories" && !formModes.quick && !formModes.sunday_tuesday) {
      toast.error("Select at least Quick Delivery or Sun/Tue Special.");
      return;
    }
    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadCatalogImageUrl(file, table);
      const image_url = uploaded ?? keptImage;
      const { data: savedRow, error } = await writeNode(
        table,
        editing?.id ?? null,
        { name: trimmed, image_url },
        parent,
        items.length,
      );
      if (error) throw error;
      if (table === "categories" && savedRow?.id && categoryModes && onToggleCategoryMode) {
        await saveCategoryModeVisibility(savedRow.id, formModes, categoryModes);
        void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      }
      if (editing?.image_url && editing.image_url !== image_url)
        await removeCatalogImageUrl(editing.image_url).catch(() => undefined);
      toast.success(editing ? `${label} updated` : `${label} added`);
      reset();
      refresh();
    } catch (error) {
      if (uploaded) await removeCatalogImageUrl(uploaded).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : `Could not save ${singular}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(node: CatalogNode) {
    const blocked = blockDelete?.(node.id);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    if (confirmDelete && !window.confirm(confirmDelete(node.name))) return;
    const { error } = await deleteNode(table, node.id);
    if (error) {
      toast.error(`Could not delete ${singular}`);
      return;
    }
    if (node.image_url) await removeCatalogImageUrl(node.image_url).catch(() => undefined);
    toast.success(`${label} deleted`);
    if (editing?.id === node.id) reset();
    refresh();
  }

  async function toggle(node: CatalogNode, on: boolean) {
    if (table === "categories") return;
    const { error } = await setNodeActive(table, node.id, on);
    if (error) toast.error(`Could not update ${singular}`);
    else refresh();
  }

  const shownImage = preview ?? keptImage;

  return (
    <div className="space-y-2.5">
      {heading && (
        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
      )}
      <div className="space-y-2 rounded-2xl border border-border/70 bg-background/60 p-2.5">
        <div className="flex items-center gap-2">
          <div className="relative shrink-0">
            <label
              className={cn(
                "grid h-11 w-11 cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-input text-muted-foreground",
                shownImage && "border-solid",
              )}
              aria-label={`${shownImage ? "Replace" : "Upload"} ${singular} image`}
            >
              {shownImage ? (
                <CategoryThumb
                  image={shownImage}
                  name={name || label}
                  className="h-full w-full"
                />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
            </label>
            {shownImage && (
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setKeptImage(null);
                }}
                aria-label={`Remove ${singular} image`}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background shadow-card"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Input
            aria-label={`${label} name`}
            placeholder={`${label} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-xl bg-card"
          />
          <Button
            onClick={() => void save()}
            disabled={busy}
            className="h-11 shrink-0 rounded-xl bg-brand text-primary-foreground"
          >
            {busy ? (
              "Saving…"
            ) : editing ? (
              "Save"
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" /> Add
              </>
            )}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              onClick={reset}
              className="h-11 shrink-0 rounded-xl px-2"
              aria-label="Cancel edit"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {table === "categories" && (
          <div className="flex flex-wrap items-center gap-4 px-1 pt-0.5 text-xs font-medium">
            <span className="text-muted-foreground">Show in:</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={formModes.quick}
                onCheckedChange={(v) =>
                  setFormModes((prev) => ({ ...prev, quick: Boolean(v) }))
                }
              />
              <span>Quick Delivery</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={formModes.sunday_tuesday}
                onCheckedChange={(v) =>
                  setFormModes((prev) => ({ ...prev, sunday_tuesday: Boolean(v) }))
                }
              />
              <span>Sun/Tue Special</span>
            </label>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No {table} yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((node) => {
            const expanded = open === node.id;
            const count = childCount?.(node.id) ?? 0;
            const catVis =
              table === "categories" && categoryModes
                ? getCategoryModeVisibility(node.id, categoryModes)
                : null;
            return (
              <li key={node.id} className="py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  {renderChildren ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setOpen(expanded ? null : node.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Hide" : "Show"} ${childLabel} in ${node.name}`}
                      className="h-8 w-8 shrink-0 rounded-full"
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  ) : null}
                  <CategoryThumb
                    image={node.image_url}
                    emoji={node.emoji}
                    name={node.name}
                    className="h-9 w-9 rounded-xl text-sm"
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => renderChildren && setOpen(expanded ? null : node.id)}
                  >
                    <span
                      className={cn(
                        "block truncate font-semibold",
                        node.is_active === false && "text-muted-foreground line-through",
                      )}
                    >
                      {node.name}
                    </span>
                    {childLabel && (
                      <span className="block text-[11px] text-muted-foreground">
                        {count}{" "}
                        {count === 1
                          ? childLabel.replace(/ies$/, "y").replace(/s$/, "")
                          : childLabel}
                      </span>
                    )}
                  </button>
                  {table !== "categories" && (
                    <Switch
                      checked={node.is_active !== false}
                      onCheckedChange={(on) => void toggle(node, on)}
                      aria-label={`Show ${node.name} in the shop`}
                    />
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-full"
                    onClick={() => {
                      setEditing(node);
                      setName(node.name);
                      setFile(null);
                      setKeptImage(node.image_url);
                      if (table === "categories" && categoryModes) {
                        setFormModes(getCategoryModeVisibility(node.id, categoryModes));
                      }
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 rounded-full px-2 text-destructive"
                    aria-label={`Delete ${node.name}`}
                    onClick={() => void remove(node)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {table === "categories" && catVis && onToggleCategoryMode && (
                  <div className="ml-10 mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={catVis.quick}
                        onCheckedChange={(v) =>
                          void onToggleCategoryMode(node.id, {
                            ...catVis,
                            quick: Boolean(v),
                          })
                        }
                      />
                      <span>Quick Delivery</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={catVis.sunday_tuesday}
                        onCheckedChange={(v) =>
                          void onToggleCategoryMode(node.id, {
                            ...catVis,
                            sunday_tuesday: Boolean(v),
                          })
                        }
                      />
                      <span>Sun/Tue Special</span>
                    </label>
                  </div>
                )}

                {expanded && renderChildren && (
                  <div className="ml-4 mt-2 border-l-2 border-border pl-3">
                    {renderChildren(node)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}
