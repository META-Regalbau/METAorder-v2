import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { ErpProductLabel } from "@shared/productVariantLabel";

interface ErpProductAutocompleteProps {
  value: string;
  onChange: (productNumber: string, label?: ErpProductLabel) => void;
  onSelectProduct?: (productNumber: string, label?: ErpProductLabel) => void;
  placeholder?: string;
  testId?: string;
}

export default function ErpProductAutocomplete({
  value,
  onChange,
  onSelectProduct,
  placeholder,
  testId,
}: ErpProductAutocompleteProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<ErpProductLabel | null>(null);

  const { data, isLoading } = useQuery<{ products: ErpProductLabel[] }>({
    queryKey: ["/api/erp/products/search", search],
    enabled: open && search.trim().length >= 2,
    queryFn: async () => {
      const params = new URLSearchParams({
        search: search.trim(),
        limit: "25",
      });
      const response = await fetch(`/api/erp/products/search?${params.toString()}`, {
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

  const handleSelect = (product: ErpProductLabel) => {
    setSelectedLabel(product);
    onChange(product.productNumber, product);
    onSelectProduct?.(product.productNumber, product);
    setOpen(false);
    setSearch("");
  };

  const displayLabel =
    selectedLabel && selectedLabel.productNumber === value
      ? selectedLabel
      : value
        ? products.find((p) => p.productNumber === value) || selectedLabel
        : null;

  const displayText = displayLabel?.label
    ? displayLabel.label
    : value
      ? value
      : placeholder || t("erp.warehouse.searchProduct");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-auto min-h-10 py-2"
          data-testid={testId}
        >
          <span className="truncate text-left whitespace-normal">{displayText}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(560px,90vw)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("erp.warehouse.searchProduct")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {search.trim().length < 2
                ? t("erp.warehouse.searchMinChars")
                : t("erp.warehouse.noProductsFound")}
            </CommandEmpty>
            <CommandGroup heading={t("erp.warehouse.productResults")}>
              {products.map((product) => (
                <CommandItem
                  key={product.productNumber}
                  value={product.productNumber}
                  onSelect={() => handleSelect(product)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === product.productNumber ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-medium">{product.productNumber}</span>
                      {product.active === false ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {t("erp.inactive")}
                        </Badge>
                      ) : null}
                    </div>
                    {product.name ? (
                      <span className="text-sm truncate">{product.name}</span>
                    ) : null}
                    {(product.size || product.color) ? (
                      <span className="text-xs text-muted-foreground">
                        {[
                          product.size && `${t("erp.size")}: ${product.size}`,
                          product.color && `${t("erp.color")}: ${product.color}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : product.optionsLabel ? (
                      <span className="text-xs text-muted-foreground truncate">
                        {product.optionsLabel}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {isLoading ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
