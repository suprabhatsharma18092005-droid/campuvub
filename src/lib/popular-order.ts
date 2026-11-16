import { supabase } from "@/integrations/supabase/client";

export const POPULAR_ORDER_SETTING_KEY = "popular_right_now_order";
export const PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY = "public_subcategories_snapshot";

export type PublicSubcategoryItem = {
  id: string;
  category_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export function parsePopularOrder(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export async function savePopularOrder(keys: string[]): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: POPULAR_ORDER_SETTING_KEY, value: JSON.stringify(keys) },
      { onConflict: "key" },
    );
  if (error) throw error;
}

export function parseSubcategoriesSnapshot(raw?: string | null): PublicSubcategoryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PublicSubcategoryItem =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as PublicSubcategoryItem).id === "string" &&
        typeof (item as PublicSubcategoryItem).category_id === "string" &&
        typeof (item as PublicSubcategoryItem).name === "string",
    );
  } catch {
    return [];
  }
}

export async function syncSubcategoriesSnapshot(items: PublicSubcategoryItem[]): Promise<void> {
  const active = items
    .filter((s) => s.is_active)
    .map((s) => ({
      id: s.id,
      category_id: s.category_id,
      name: s.name,
      image_url: s.image_url,
      sort_order: s.sort_order,
      is_active: true,
    }));
  const payload = JSON.stringify(active);
  const { error } = await supabase
    .from("app_settings")
    .upsert(
      { key: PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY, value: payload },
      { onConflict: "key" },
    );
  if (error) throw error;
}
