import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CategoryThumb } from "@/components/CategoryThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { removeCatalogImageUrl, uploadCatalogImageUrl } from "@/lib/catalog-media";
import { brandsQuery, categoriesQuery, subcategoriesQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

type NodeTable = "categories" | "subcategories" | "brands";
type CatalogNode = { id: string; name: string; image_url: string | null; emoji?: string | null; is_active?: boolean };
type Parent = { category_id?: string; subcategory_id?: string };

async function writeNode(table: NodeTable, id: string | null, values: { name: string; image_url: string | null }, parent: Parent, sortOrder: number) {
  switch (table) {
    case "categories":
      return id
        ? await supabase.from("categories").update(values).eq("id", id)
        : await supabase.from("categories").insert({ ...values, sort_order: sortOrder });
    case "subcategories":
      return id
        ? await supabase.from("subcategories").update(values).eq("id", id)
        : await supabase.from("subcategories").insert({ ...values, sort_order: sortOrder, category_id: parent.category_id! });
    case "brands":
      return id
        ? await supabase.from("brands").update(values).eq("id", id)
        : await supabase.from("brands").insert({ ...values, sort_order: sortOrder, subcategory_id: parent.subcategory_id! });
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

/** Admin manager for the Category → Subcategory → Brand tree, with image uploads at every level. */
export function CatalogHierarchyManager({ products }: { products: { category_id?: string | null }[] }) {
  const categories = useQuery(categoriesQuery).data ?? [];
  const subcategories = useQuery(subcategoriesQuery).data ?? [];
  const brands = useQuery(brandsQuery).data ?? [];

  return (
    <div id="category-manager" className="scroll-mt-20 space-y-2 rounded-3xl border border-border bg-card p-4 shadow-card">
      <h2 className="font-display text-lg font-bold">Categories</h2>
      <p className="text-xs text-muted-foreground">Category → Subcategory → Brand. Open a row to manage what is inside it.</p>
      <NodeLevel
        table="categories"
        singular="category"
        items={categories}
        parent={{}}
        childLabel="subcategories"
        childCount={(id) => subcategories.filter((s) => s.category_id === id).length}
        blockDelete={(id) => (products.some((p) => p.category_id === id) ? "Move or delete the products in this category first." : null)}
        renderChildren={(category) => (
          <NodeLevel
            table="subcategories"
            singular="subcategory"
            heading={`Subcategories in ${category.name}`}
            items={subcategories.filter((s) => s.category_id === category.id)}
            parent={{ category_id: category.id }}
            childLabel="brands"
            childCount={(id) => brands.filter((b) => b.subcategory_id === id).length}
            confirmDelete={(name) => `Delete subcategory "${name}" and its brands? Its products stay in the category.`}
            renderChildren={(subcategory) => (
              <NodeLevel
                table="brands"
                singular="brand"
                heading={`Brands in ${subcategory.name}`}
                items={brands.filter((b) => b.subcategory_id === subcategory.id)}
                parent={{ subcategory_id: subcategory.id }}
                confirmDelete={(name) => `Delete brand "${name}"? Its products stay in the subcategory.`}
              />
            )}
          />
        )}
      />
    </div>
  );
}

function NodeLevel({
  table,
  singular,
  heading,
  items,
  parent,
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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const preview = useObjectUrl(file);
  const label = singular.charAt(0).toUpperCase() + singular.slice(1);

  function reset() {
    setEditing(null);
    setName("");
    setFile(null);
    setKeptImage(null);
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
    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (file) uploaded = await uploadCatalogImageUrl(file, table);
      const image_url = uploaded ?? keptImage;
      const { error } = await writeNode(table, editing?.id ?? null, { name: trimmed, image_url }, parent, items.length);
      if (error) throw error;
      if (editing?.image_url && editing.image_url !== image_url) await removeCatalogImageUrl(editing.image_url).catch(() => undefined);
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
    <div className="space-y-2">
      {heading && <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</p>}
      <div className="flex items-center gap-2">
        <div className="relative shrink-0">
          <label
            className={cn(
              "grid h-11 w-11 cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-input text-muted-foreground",
              shownImage && "border-solid",
            )}
            aria-label={`${shownImage ? "Replace" : "Upload"} ${singular} image`}
          >
            {shownImage ? <CategoryThumb image={shownImage} name={name || label} className="h-full w-full" /> : <ImagePlus className="h-4 w-4" />}
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
        <Input aria-label={`${label} name`} placeholder={`${label} name`} value={name} onChange={(e) => setName(e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl" />
        <Button onClick={() => void save()} disabled={busy} className="h-11 shrink-0 rounded-xl">
          {busy ? "Saving…" : editing ? "Save" : <><Plus className="h-4 w-4" /> Add</>}
        </Button>
        {editing && (
          <Button variant="ghost" onClick={reset} className="h-11 shrink-0 rounded-xl px-2" aria-label="Cancel edit">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">No {table} yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((node) => {
            const expanded = open === node.id;
            const count = childCount?.(node.id) ?? 0;
            return (
              <li key={node.id} className="py-2">
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
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  ) : null}
                  <CategoryThumb image={node.image_url} emoji={node.emoji} name={node.name} className="h-9 w-9 rounded-xl text-sm" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => renderChildren && setOpen(expanded ? null : node.id)}>
                    <span className={cn("block truncate font-medium", node.is_active === false && "text-muted-foreground line-through")}>{node.name}</span>
                    {childLabel && <span className="block text-[11px] text-muted-foreground">{count} {count === 1 ? childLabel.replace(/ies$/, "y").replace(/s$/, "") : childLabel}</span>}
                  </button>
                  {table !== "categories" && (
                    <Switch checked={node.is_active !== false} onCheckedChange={(on) => void toggle(node, on)} aria-label={`Show ${node.name} in the shop`} />
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
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="shrink-0 rounded-full px-2 text-destructive" aria-label={`Delete ${node.name}`} onClick={() => void remove(node)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {expanded && renderChildren && <div className="ml-4 mt-2 border-l-2 border-border pl-3">{renderChildren(node)}</div>}
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
