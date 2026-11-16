import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Product } from "@/components/ProductCard";
import { catalogReference } from "@/lib/catalog-media";
import {
  PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY,
  parseSubcategoriesSnapshot,
} from "@/lib/popular-order";

export const productsQuery = queryOptions({
  queryKey: ["products"],
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  queryFn: async (): Promise<Product[]> => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, description, price, actual_price, badge_text, specs_text, tagline, image_url, image_path, in_stock, category_id, subcategory_id, brand_id, stock_quantity, delivery_types")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((product) => ({
      ...product,
      image_url: product.image_path ? catalogReference(product.image_path) : product.image_url,
    })) as Product[];
  },
});

export type Category = { id: string; name: string; emoji: string | null; image_url: string | null; sort_order: number };

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

export type Subcategory = {
  id: string;
  category_id: string;
  name: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

/** Storefront hides inactive rows itself; admins receive them too (RLS) so they can re-enable them. */
export const subcategoriesQuery = queryOptions({
  queryKey: ["subcategories"],
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  queryFn: async (): Promise<Subcategory[]> => {
    const { data, error } = await supabase
      .from("subcategories")
      .select("id, category_id, name, image_url, sort_order, is_active")
      .order("sort_order")
      .order("name");
    if (error) {
      if (error.code === "42501") {
        const snap = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", PUBLIC_SUBCATEGORIES_SNAPSHOT_KEY)
          .maybeSingle();
        return parseSubcategoriesSnapshot(snap.data?.value);
      }
      throw error;
    }
    return data ?? [];
  },
});

export type Brand = {
  id: string;
  subcategory_id: string;
  category_id: string | null;
  name: string;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export const brandsQuery = queryOptions({
  queryKey: ["brands"],
  staleTime: 5 * 60_000,
  placeholderData: keepPreviousData,
  queryFn: async (): Promise<Brand[]> => {
    const { data, error } = await supabase
      .from("brands")
      .select("id, subcategory_id, category_id, name, image_url, sort_order, is_active")
      .order("sort_order")
      .order("name");
    if (error) {
      if (error.code === "42501") return [];
      throw error;
    }
    return data ?? [];
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
