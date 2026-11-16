import type { DeliveryMode } from "@/lib/delivery";
import type { useVip } from "@/lib/vip";

type Vip = ReturnType<typeof useVip>;

export function formatVipDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** VIP membership UI is disabled on the user site. */
export function VipActiveBadge(_props: {
  vip: Vip;
  mode?: DeliveryMode;
  className?: string;
}) {
  return null;
}

/** VIP membership hints are disabled on the user site. */
export function VipCartHint(_props: {
  vip: Vip;
  mode: DeliveryMode | string;
  subtotal?: number;
}) {
  return null;
}

/** VIP home banners are disabled on the user site. */
export function VipHomeBanner(_props: { vip: Vip; mode?: DeliveryMode }) {
  return null;
}

/** VIP popup modal is disabled on the user site. */
export function VipPopup(_props: { vip: Vip }) {
  return null;
}
