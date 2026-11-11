import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const QR_BUCKET = "payment-assets";

/** Resolves the admin-uploaded QR image (stored privately) to a viewable URL. */
export function useUpiQrImage(path: string | undefined) {
  return useQuery({
    queryKey: ["upi-qr", path],
    enabled: Boolean(path),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from(QR_BUCKET)
        .createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

/** Signed URL for any private payment-assets object (refund proofs etc.). */
export function useSignedAsset(path: string | null | undefined) {
  return useQuery({
    queryKey: ["signed-asset", path],
    enabled: Boolean(path),
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from(QR_BUCKET)
        .createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}

export function fallbackQrUrl(upiId: string, amount: number) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
    `upi://pay?pa=${upiId}&pn=Campu&am=${amount}&cu=INR`,
  )}`;
}
