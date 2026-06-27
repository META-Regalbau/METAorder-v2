import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type ProductLabelEntry = { name: string | null; id: string | null };

/**
 * Laedt Shopware-Produktbezeichnungen zu Artikelnummern (POST /api/cross-selling/product-labels).
 */
export function useCrossSellProductLabels(productNumbers: string[], enabled: boolean) {
  const sortedKey = useMemo(() => {
    const unique = Array.from(new Set(productNumbers.map((n) => n.trim()).filter(Boolean))).slice(0, 400);
    return unique.sort().join("\u0001");
  }, [productNumbers]);

  const query = useQuery({
    queryKey: ["/api/cross-selling/product-labels", sortedKey],
    queryFn: async () => {
      const unique = sortedKey ? sortedKey.split("\u0001") : [];
      const res = await apiRequest("POST", "/api/cross-selling/product-labels", {
        productNumbers: unique,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || res.statusText);
      }
      return (await res.json()) as { labels: Record<string, ProductLabelEntry> };
    },
    enabled: enabled && sortedKey.length > 0,
    staleTime: 60_000,
  });

  const labels = query.data?.labels ?? {};

  const productName = useCallback((pn: string) => labels[pn]?.name ?? "", [labels]);

  return {
    labels,
    productName,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
