import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ErpProductLabel } from "@shared/productVariantLabel";
import { buildErpProductLabel } from "@shared/productVariantLabel";

const LABEL_CHUNK_SIZE = 300;

export function useErpProductLabels(productNumbers: string[]) {
  const numbers = useMemo(() => {
    return Array.from(new Set(productNumbers.map((n) => n.trim()).filter(Boolean))).sort();
  }, [productNumbers]);

  const { data, isLoading, isFetching } = useQuery<{ labels: Record<string, ErpProductLabel> }>({
    queryKey: ["/api/erp/product-labels", numbers],
    enabled: numbers.length > 0,
    queryFn: async () => {
      const labels: Record<string, ErpProductLabel> = {};
      for (let i = 0; i < numbers.length; i += LABEL_CHUNK_SIZE) {
        const chunk = numbers.slice(i, i + LABEL_CHUNK_SIZE);
        const res = await apiRequest("POST", "/api/erp/product-labels", { productNumbers: chunk });
        const body = (await res.json()) as { labels: Record<string, ErpProductLabel> };
        Object.assign(labels, body.labels || {});
      }
      return { labels };
    },
    staleTime: 15_000,
  });

  const labels = data?.labels ?? {};

  const getLabel = (productNumber: string): ErpProductLabel => {
    const pn = productNumber.trim();
    return labels[pn] || buildErpProductLabel({ productNumber: pn });
  };

  return { labels, getLabel, isLoading: isLoading || isFetching };
}
