import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Product } from "@shared/schema";

interface ProductAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}

export default function ProductAutocomplete({
  value,
  onChange,
  placeholder,
  testId,
}: ProductAutocompleteProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ products: Product[] }>({
    queryKey: ["/api/products", "staging-autocomplete", search],
    enabled: open && search.trim().length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams({
        search: search.trim(),
        limit: "20",
        page: "1",
      });
      const response = await fetch(`/api/products?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || response.statusText);
      }
      return response.json();
    },
  });

  const products = data?.products ?? [];

  const handleSelect = (productNumber: string) => {
    onChange(productNumber);
    setOpen(false);
    setSearch("");
  };

  const displayValue = value || placeholder || t("rules.stagingSelectTarget", "Zielprodukt wählen");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          data-testid={testId}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={t("rules.stagingSearchProducts", "Suche nach Artikelnummer oder Name")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {search.trim().length < 2
                ? t("rules.stagingSearchMin", "Bitte mindestens 2 Zeichen eingeben")
                : t("rules.stagingNoProducts", "Keine Produkte gefunden")}
            </CommandEmpty>
            <CommandGroup heading={t("rules.stagingResults", "Ergebnisse")}>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.productNumber}
                  onSelect={() => handleSelect(product.productNumber || "")}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === product.productNumber ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium font-mono">
                      {product.productNumber || t("rules.stagingUnknownNumber", "Ohne Nummer")}
                    </span>
                    {product.name && <span className="text-xs text-muted-foreground">{product.name}</span>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {isLoading && (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                {t("common.loading")}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
