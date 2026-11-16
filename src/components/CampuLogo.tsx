import { cn } from "@/lib/utils";

/** Theme-adaptive Campu logo using the uploaded transparent mark inside a theme-colored badge. */
export function CampuLogo({
  className,
  iconClassName,
}: {
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden rounded-xl bg-brand text-primary-foreground shadow-xs",
        className,
      )}
    >
      <img
        src="/assets/aistudio/campu_icon_transparent_9aabb4d1.png"
        alt="Campu"
        className={cn("h-[74%] w-[74%] object-contain", iconClassName)}
      />
    </span>
  );
}
