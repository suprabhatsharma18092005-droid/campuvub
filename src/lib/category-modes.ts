import { supabase } from "@/integrations/supabase/client";
import type { DeliveryMode } from "@/lib/delivery";

export const CATEGORY_MODES_KEY = "category_delivery_modes";

export type CategoryModeVisibility = {
  quick: boolean;
  sunday_tuesday: boolean;
};

export type CategoryModesMap = Record<string, CategoryModeVisibility>;

export function parseCategoryModes(raw: string | undefined): CategoryModesMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: CategoryModesMap = {};
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        out[id] = {
          quick: record["quick"] !== false,
          sunday_tuesday: record["sunday_tuesday"] !== false,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getCategoryModeVisibility(
  categoryId: string,
  map: CategoryModesMap,
): CategoryModeVisibility {
  return map[categoryId] ?? { quick: true, sunday_tuesday: true };
}

export function isCategoryInMode(
  categoryId: string,
  mode: DeliveryMode,
  map: CategoryModesMap,
): boolean {
  const vis = getCategoryModeVisibility(categoryId, map);
  return mode === "sunday_tuesday" ? vis.sunday_tuesday : vis.quick;
}

export async function saveCategoryModeVisibility(
  categoryId: string,
  next: CategoryModeVisibility,
  currentMap: CategoryModesMap,
): Promise<CategoryModesMap> {
  const updated: CategoryModesMap = {
    ...currentMap,
    [categoryId]: next,
  };
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: CATEGORY_MODES_KEY, value: JSON.stringify(updated) }, { onConflict: "key" });
  if (error) throw error;
  return updated;
}
