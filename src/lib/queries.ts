import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/components/ProductCard";
import { catalogReference } from "@/lib/catalog-media";

export const productsQuery = queryOptions({
  queryKey: ["products"],
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  queryFn: async (): Promise<Product[]> => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, description, price, actual_price, badge_text, specs_text, tagline, image_url, image_path, in_stock, category_id, stock_quantity, delivery_types")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((product) => ({
      ...product,
      image_url: product.image_path ? catalogReference(product.image_path) : product.image_url,
    })) as Product[];
  },
});

export type Category = { id: string; name: string; emoji: string; image_url: string | null; sort_order: number };

export const categoriesQuery = queryOptions({
  queryKey: ["categories"],
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  queryFn: async (): Promise<Category[]> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, emoji, image_url, sort_order")
      .order("sort_order");
    if (error) throw error;
    return (data ?? []) as Category[];
  },
});

export const settingsQuery = queryOptions({
  queryKey: ["app_settings"],
  queryFn: async (): Promise<Record<string, string>> => {
    const { data, error } = await supabase.from("app_settings").select("key, value");
    if (error) throw error;
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  },
});
