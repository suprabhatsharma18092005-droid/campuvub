import { useQuery } from "@tanstack/react-query";
import { SupabaseClient } from "@supabase/supabase-js";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Crown,
  Heart,
  Home,
  LayoutGrid,
  Plus,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CampuLogo } from "@/components/CampuLogo";
import { CartBar } from "@/components/CartBar";
import { CatalogImage } from "@/components/CatalogImage";
import { PushBanner } from "@/components/PushBanner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { setDeliveryMode, useDeliveryMode } from "@/lib/delivery";
import { toggleFavorite, useFavoriteIds } from "@/lib/favorites";
import { rupees } from "@/lib/format";
import { useLiveSync, usePushRegistration } from "@/lib/live-sync";
import { listenForForegroundPush } from "@/lib/push";
import { productsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { RoyalThemeContext, useRoyalThemeState } from "@/lib/vip";

void (SupabaseClient);

export function AppShell({
  children,
  hideBottomNav = false,
}: {
  children: React.ReactNode;
  hideBottomNav?: boolean;
}) {
  const { add, count, bump } = useCart();
  const [pop, setPop] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const navigate = useNavigate();
  useLiveSync();
  usePushRegistration();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const royal = useRoyalThemeState();
  const mode = useDeliveryMode();
  const favoriteIds = useFavoriteIds();
  const products = useQuery(productsQuery);
  const savedProducts = (products.data ?? []).filter((p) => favoriteIds.includes(p.id));
  const shouldHideBottomNav = hideBottomNav || pathname.startsWith("/product/");

  useEffect(() => {
    if (bump === 0) return;
    setPop(true);
    const t = setTimeout(() => setPop(false), 500);
    return () => clearTimeout(t);
  }, [bump]);

  // Foreground: intercept the push, play a short chime and show a native-style
  // heads-up banner instead of a system notification.
  useEffect(() => {
    const stop = listenForForegroundPush(({ title, body, path }) => {
      try {
        const audio = new Audio("/notification.mp3");
        audio.volume = 0.8;
        void audio.play().catch(() => console.log("Audio blocked by browser"));
      } catch {
        console.log("Audio blocked by browser");
      }
      toast.custom(
        (id) => (
          <PushBanner
            title={title}
            body={body}
            onClick={() => {
              toast.dismiss(id);
              if (path) {
                try {
                  const url = new URL(path, window.location.origin);
                  const search = Object.fromEntries(url.searchParams.entries());
                  void navigate({
                    to: url.pathname as never,
                    ...(Object.keys(search).length > 0 ? { search: search as never } : {}),
                  });
                } catch {
                  void navigate({ to: path as never });
                }
              }
            }}
          />
        ),
        { duration: 5600, position: "top-center" },
      );
    });

    return stop;
  }, [navigate]);

  useEffect(() => {
    const channel = supabase
      .channel("broadcasts-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "broadcasts" },
        (payload) => {
          const row = payload.new as { title: string; body: string };
          toast(row.title, { description: row.body, duration: 8000 });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  function switchDeliveryMode(next: "quick" | "sunday_tuesday") {
    setDeliveryMode(next);
    if (pathname !== "/" && pathname !== "/categories") {
      void navigate({ to: "/" });
    }
  }

  return (
    <RoyalThemeContext.Provider value={royal}>
      <div
        data-royal={royal.isRoyal ? "true" : undefined}
        className="flex min-h-screen w-full flex-col bg-background"
      >
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/75 text-foreground backdrop-blur-xl transition-colors">
          <div className="flex h-12 items-center gap-2 px-4">
            <Link to="/" className="flex items-center gap-2">
              <CampuLogo className="h-7 w-7 rounded-xl" />
              <span className="font-display text-[18px] font-extrabold tracking-tight text-brand">
                Campu
              </span>
              {royal.isRoyal && (
                <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-primary-foreground shadow-xs">
                  <Crown className="h-3 w-3" />
                  {royal.isAdmin ? "Admin" : "VIP"}
                </span>
              )}
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                aria-label="Saved favorites"
                onClick={() => setFavoritesOpen(true)}
                className="relative grid h-9 w-9 place-items-center rounded-full bg-accent/80 text-primary transition-colors hover:bg-accent active:scale-95"
              >
                <Heart
                  className={cn(
                    "h-[18px] w-[18px]",
                    savedProducts.length > 0 && "fill-destructive text-destructive",
                  )}
                />
                {savedProducts.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground shadow-xs">
                    {savedProducts.length}
                  </span>
                )}
              </button>

              <Link
                to="/cart"
                aria-label="Cart"
                className={cn(
                  "relative grid h-9 w-9 place-items-center rounded-full bg-accent/80 text-primary transition-colors hover:bg-accent",
                  pop && "animate-cart-bounce",
                )}
              >
                <ShoppingBag className="h-[18px] w-[18px]" />
                {count > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-xs">
                    {count}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </header>

        <main className={cn("flex-1", shouldHideBottomNav ? "pb-28" : "pb-40")}>{children}</main>

        <CartBar />

        {!shouldHideBottomNav && (
          <nav
            aria-label="Primary navigation"
            className="fixed bottom-2.5 left-1/2 z-30 w-[calc(100%-1rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-[26px] border border-border/60 bg-background/75 px-1.5 py-1.5 pb-safe shadow-float backdrop-blur-xl transition-colors"
          >
            <div className="grid grid-cols-6 gap-0.5">
              <Link
                to="/"
                activeOptions={{ exact: true }}
                className="group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95 data-[status=active]:text-primary"
              >
                <span className="grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200 group-data-[status=active]:bg-accent group-data-[status=active]:text-primary group-data-[status=active]:shadow-xs">
                  <Home className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </span>
                <span className="text-center leading-none group-data-[status=active]:font-extrabold">
                  Home
                </span>
              </Link>

              <button
                type="button"
                aria-pressed={mode === "quick"}
                onClick={() => switchDeliveryMode("quick")}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold transition-all duration-200 active:scale-95",
                  mode === "quick"
                    ? "text-primary font-extrabold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200",
                    mode === "quick" && "bg-brand text-primary-foreground shadow-xs",
                  )}
                >
                  <QuickDeliveryIcon className="h-[19px] w-[19px]" />
                </span>
                <span className="text-center leading-tight">Quick</span>
              </button>

              <Link
                to="/categories"
                className="group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95 data-[status=active]:text-primary"
              >
                <span className="grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200 group-data-[status=active]:bg-accent group-data-[status=active]:text-primary group-data-[status=active]:shadow-xs">
                  <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </span>
                <span className="text-center leading-none group-data-[status=active]:font-extrabold">
                  Category
                </span>
              </Link>

              <button
                type="button"
                aria-pressed={mode === "sunday_tuesday"}
                onClick={() => switchDeliveryMode("sunday_tuesday")}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9px] font-semibold transition-all duration-200 active:scale-95",
                  mode === "sunday_tuesday"
                    ? "text-primary font-extrabold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200",
                    mode === "sunday_tuesday" && "bg-brand text-primary-foreground shadow-xs",
                  )}
                >
                  <SpecialDeliveryIcon className="h-[19px] w-[19px]" />
                </span>
                <span className="whitespace-normal text-center leading-[1.05]">
                  Sun/Tue Special
                </span>
              </button>

              {royal.isAdmin ? (
                <Link
                  to="/admin"
                  className="group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95 data-[status=active]:text-primary"
                >
                  <span className="grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200 group-data-[status=active]:bg-accent group-data-[status=active]:text-primary group-data-[status=active]:shadow-xs">
                    <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2.1} />
                  </span>
                  <span className="text-center leading-none group-data-[status=active]:font-extrabold">
                    Admin
                  </span>
                </Link>
              ) : (
                <Link
                  to="/orders"
                  className="group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95 data-[status=active]:text-primary"
                >
                  <span className="grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200 group-data-[status=active]:bg-accent group-data-[status=active]:text-primary group-data-[status=active]:shadow-xs">
                    <ReceiptText className="h-[18px] w-[18px]" strokeWidth={2.1} />
                  </span>
                  <span className="text-center leading-none group-data-[status=active]:font-extrabold">
                    Orders
                  </span>
                </Link>
              )}

              <Link
                to="/profile"
                className="group flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-0.5 py-1 text-[9.5px] font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-95 data-[status=active]:text-primary"
              >
                <span className="grid place-items-center rounded-full px-2.5 py-1 transition-all duration-200 group-data-[status=active]:bg-accent group-data-[status=active]:text-primary group-data-[status=active]:shadow-xs">
                  <User className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </span>
                <span className="text-center leading-none group-data-[status=active]:font-extrabold">
                  Profile
                </span>
              </Link>
            </div>
          </nav>
        )}

        <Sheet open={favoritesOpen} onOpenChange={setFavoritesOpen}>
          <SheetContent side="right" className="w-[88vw] max-w-sm">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 font-display">
                <Heart className="h-5 w-5 fill-destructive text-destructive" />
                Saved Favorites ({savedProducts.length})
              </SheetTitle>
              <SheetDescription>
                Items you liked are saved here for quick reordering.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-2.5 overflow-y-auto pb-8">
              {savedProducts.length === 0 ? (
                <div className="rounded-2xl border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                  Tap the heart icon on any product to save it here.
                </div>
              ) : (
                savedProducts.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 shadow-card"
                  >
                    <Link
                      to="/product/$id"
                      params={{ id: item.id }}
                      onClick={() => setFavoritesOpen(false)}
                      className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted"
                    >
                      {item.image_url ? (
                        <CatalogImage
                          source={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="font-display text-lg font-bold text-primary">
                          {item.name.slice(0, 1)}
                        </span>
                      )}
                    </Link>
                    <Link
                      to="/product/$id"
                      params={{ id: item.id }}
                      onClick={() => setFavoritesOpen(false)}
                      className="min-w-0 flex-1"
                    >
                      <p className="line-clamp-1 text-sm font-bold">{item.name}</p>
                      <p className="text-xs font-bold text-primary">{rupees(item.price)}</p>
                    </Link>
                    <div className="flex items-center gap-1">
                      {item.in_stock && (
                        <button
                          type="button"
                          aria-label={`Add ${item.name} to cart`}
                          onClick={() => {
                            add({
                              id: item.id,
                              name: item.name,
                              price: Number(item.price),
                              image_url: item.image_url,
                            });
                            toast.success(`Added ${item.name}`);
                          }}
                          className="grid h-8 w-8 place-items-center rounded-full bg-brand text-primary-foreground shadow-xs active:scale-90"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${item.name} from favorites`}
                        onClick={() => {
                          toggleFavorite(item.id);
                          toast.success("Removed from favorites");
                        }}
                        className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </RoyalThemeContext.Provider>
  );
}

function QuickDeliveryIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 9h4M1 13h5M3 17h4" opacity={0.7} />
      <path d="M14.5 3.5 9.5 12h4.2l-1.2 8.5L19 10.5h-4.5l0-7Z" fill="currentColor" fillOpacity={0.18} />
    </svg>
  );
}

function SpecialDeliveryIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="4" fill="currentColor" fillOpacity={0.1} />
      <path d="M8 3v3M16 3v3M3 9.5h18" />
      <path d="m12 12 1.05 2.15 2.35.34-1.7 1.66.4 2.35-2.1-1.1-2.1 1.1.4-2.35-1.7-1.66 2.35-.34L12 12Z" fill="currentColor" />
    </svg>
  );
}

