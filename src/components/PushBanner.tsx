import { CampuLogo } from "@/components/CampuLogo";

/** iOS/Android-style glassmorphism heads-up banner used for foreground push. */
export function PushBanner({
  title,
  body,
  onClick,
}: {
  title: string;
  body?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="animate-push-banner pointer-events-auto flex w-[min(92vw,26rem)] items-center gap-3 rounded-2xl border border-white/40 bg-white/30 p-4 text-left text-gray-900 shadow-2xl backdrop-blur-xl"
    >
      <CampuLogo className="h-10 w-10 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight">{title}</span>
        {body ? (
          <span className="mt-0.5 block line-clamp-2 text-[13px] leading-snug text-gray-900/70">
            {body}
          </span>
        ) : null}
      </span>
    </button>
  );
}
