import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: true, retry: 1 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    dehydrate: () => ({ queryCache: JSON.stringify(dehydrate(queryClient)) }),
    hydrate: (dehydrated) => {
      hydrate(queryClient, JSON.parse(dehydrated.queryCache));
    },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
