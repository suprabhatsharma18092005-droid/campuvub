import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated/vip")({
  head: () => ({
    meta: [
      { title: "Campu — Campus Delivery in Minutes" },
    ],
  }),
  component: VipRedirectPage,
});

function VipRedirectPage() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}
