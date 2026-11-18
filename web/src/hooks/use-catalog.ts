import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Catalog } from "@/models";
import { DEFAULT_CATALOG } from "@/lib/catalog";

/** The model menu from the API (costs, defaults, which models have a key); the static mirror covers first paint. */
export function useCatalog(): Catalog {
  const q = useQuery({
    queryKey: ["catalog"],
    queryFn: async () => (await api.get<Catalog>("/catalog")).data,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_CATALOG,
  });
  return q.data ?? DEFAULT_CATALOG;
}
