import { supabase } from "@/integrations/supabase/client";

export const CATALOG_BUCKET = "catalog-media";
const CATALOG_PREFIX = "catalog://";

export function catalogReference(path: string) {
  return `${CATALOG_PREFIX}${path}`;
}

export function catalogPath(reference: string | null | undefined) {
  return reference?.startsWith(CATALOG_PREFIX) ? reference.slice(CATALOG_PREFIX.length) : null;
}

// `catalog-media` is a public bucket: build the URL locally so product and banner
// photos load with no network round trip, no expiry, and stay cacheable.
export function catalogPublicUrl(reference: string | null | undefined) {
  const path = catalogPath(reference);
  if (!path) return reference ?? null;
  return supabase.storage.from(CATALOG_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function resolveCatalogImage(reference: string | null | undefined) {
  return catalogPublicUrl(reference);
}

export async function uploadCatalogImage(file: File, folder: "banners" | "products") {
  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 5 MB.");
  }
  const optimized = await downscaleImage(file, folder === "banners" ? 1600 : 800);
  const upload = optimized ?? file;
  const extension = optimized
    ? optimized.type === "image/webp" ? "webp" : "jpg"
    : file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(CATALOG_BUCKET).upload(path, upload, {
    contentType: upload.type,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return path;
}

export async function removeCatalogImage(reference: string | null | undefined) {
  const path = catalogPath(reference) ?? reference;
  if (!path) return;
  const { error } = await supabase.storage.from(CATALOG_BUCKET).remove([path]);
  if (error) throw error;
}
/** Downscale to maxWidth and re-encode as WebP (JPEG fallback). Returns null if the browser can't. */
async function downscaleImage(file: File, maxWidth: number): Promise<Blob | null> {
  if (typeof document === "undefined" || file.type === "image/gif" || file.type === "image/svg+xml") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const encode = (type: string) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
    const webp = await encode("image/webp");
    if (webp && webp.type === "image/webp") return webp;
    return await encode("image/jpeg");
  } catch {
    return null;
  }
}
