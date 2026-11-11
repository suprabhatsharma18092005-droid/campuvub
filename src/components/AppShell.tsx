import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, LayoutGrid, ShoppingBag, ReceiptText, User } from "lucide-react";
import { useEffect, useState } from "react";

import { toast } from "sonner";

import campuLogo from "@/assets/campu-logo.png";
import { CartBar } from "@/components/CartBar";
import { PushBanner } from "@/components/PushBanner";


import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { useLiveSync, usePushRegistration } from "@/lib/live-sync";
import { listenForForegroundPush } from "@/lib/push";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", icon: Home },
  { to: "/categories", label: "Categories", icon: LayoutGrid },
  { to: "/orders", label: "Orders", icon: ReceiptText },
  { to: "/profile", label: "Profile", icon: User },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const { count, bump } = useCart();
  const [pop, setPop] = useState(false);
  const navigate = useNavigate();
  useLiveSync();
  usePushRegistration();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
              if (path) void navigate({ to: path });
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

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="flex h-11 items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-1.5">
            <img src={campuLogo} alt="Campu" className="h-6 w-6 rounded-md object-contain" />
            <span className="font-display text-[17px] font-semibold tracking-tight text-brand">
              Campu
            </span>
          </Link>
          <Link
            to="/cart"
            aria-label="Cart"
            className={cn(
              "ml-auto relative grid h-8 w-8 place-items-center rounded-full text-primary",
              pop && "animate-cart-bounce",
            )}
          >
            <ShoppingBag className="h-[18px] w-[18px]" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {count}
              </span>
            )}
          </Link>
        </div>
      </header>

      <main className="flex-1 pb-40">{children}</main>

      <CartBar />

      <nav className="fixed bottom-2 left-1/2 z-30 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-border/70 bg-background/90 px-1 pb-safe shadow-float backdrop-blur-xl">
        <div className="grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors data-[status=active]:text-primary"
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
