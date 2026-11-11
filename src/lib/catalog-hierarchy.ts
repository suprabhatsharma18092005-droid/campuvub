/** Browser-safe Category → Subcategory → Brand selection rules shared by storefront pages. */
export type CatalogSelection = { category?: string | undefined; subcategory?: string | undefined; brand?: string | undefined };

type Linked = { category_id: string | null; subcategory_id?: string | null; brand_id?: string | null };

export function productMatchesSelection(product: Linked, selection: CatalogSelection) {
  if (selection.category && product.category_id !== selection.category) return false;
  if (selection.subcategory && product.subcategory_id !== selection.subcategory) return false;
  if (selection.brand && product.brand_id !== selection.brand) return false;
  return true;
}

/** Picking a level clears every level below it. */
export function chooseCategory(_selection: CatalogSelection, id: string | undefined): CatalogSelection {
  return id ? { category: id } : {};
}

export function chooseSubcategory(selection: CatalogSelection, id: string | undefined): CatalogSelection {
  return { category: selection.category, subcategory: id };
}

export function chooseBrand(selection: CatalogSelection, id: string | undefined): CatalogSelection {
  return { category: selection.category, subcategory: selection.subcategory, brand: id };
}
