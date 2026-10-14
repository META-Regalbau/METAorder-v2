import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type SearchProduct = { id: string; productNumber: string; name: string; price: number; netPrice?: number };

/**
 * Katalogartikel suchen und dem Entwurf hinzufügen (Bestell- und Angebots-Prüffenster).
 * Angezeigt wird der Netto-Listenpreis; `price` ist im Katalog der Bruttopreis.
 */
export function DraftManualProductAdd({
  open,
  disabled,
  pending,
  onAdd,
}: {
  open: boolean;
  disabled?: boolean;
  pending?: boolean;
  onAdd: (productId: string) => void;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isFetching } = useQuery<{ products: SearchProduct[] }>({
    queryKey: ["/api/products", "manual-add", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(debounced)}&limit=10`, { credentials: "include" });
      if (!res.ok) throw new Error(t("draftReview.productSearchFailed"));
      return res.json();
    },
    enabled: open && debounced.length >= 2,
  });
  const results = data?.products ?? [];

  return (
    <Card data-testid="card-add-product-manually">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="w-4 h-4" />
          {t("draftReview.manualAdd.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("draftReview.manualAdd.hint")}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input
          aria-label={t("draftReview.manualAdd.title")}
          placeholder={t("draftReview.manualAdd.placeholder")}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          disabled={disabled}
          data-testid="input-manual-product-search"
        />
        {debounced.length >= 2 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {isFetching && <p className="text-xs text-muted-foreground">{t("draftReview.manualAdd.searching")}</p>}
            {!isFetching && results.length === 0 && <p className="text-xs text-muted-foreground">{t("draftReview.manualAdd.noResults")}</p>}
            {results.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
                data-testid={`manual-product-result-${product.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {product.productNumber}
                    {typeof product.netPrice === "number" && product.netPrice > 0
                      ? ` • ${t("draftReview.manualAdd.netPrice", { price: fmt.currency(product.netPrice) })}`
                      : null}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || disabled}
                  onClick={() => onAdd(product.id)}
                  data-testid={`button-manual-add-product-${product.id}`}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t("draftReview.manualAdd.add")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
