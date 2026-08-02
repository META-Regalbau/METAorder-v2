import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export type ShopwareCustomer = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  salesChannelId?: string;
  salesChannelName?: string;
};

export function customerLabel(c: ShopwareCustomer): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const parts = [c.company, name].filter(Boolean);
  const head = parts.join(" · ") || c.email || c.id;
  return c.email && head !== c.email ? `${head} (${c.email})` : head;
}

export function ShopwareCustomerSearch({
  value,
  onChange,
  endpoint,
  placeholder = "Kunde suchen (Name, Firma, E-Mail)",
  className,
}: {
  value: ShopwareCustomer | null;
  onChange: (c: ShopwareCustomer | null) => void;
  /** GET endpoint that accepts ?q=<term> and returns { customers: ShopwareCustomer[] } */
  endpoint: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ customers: ShopwareCustomer[] }>({
    queryKey: [endpoint, search],
    enabled: open && search.trim().length >= 2,
    queryFn: async () => {
      const res = await apiRequest("GET", `${endpoint}?q=${encodeURIComponent(search.trim())}`);
      return res.json();
    },
  });

  const customers = data?.customers ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn("w-full justify-between", className)}>
          <span className="truncate flex items-center gap-2">
            <UserRound className="h-4 w-4 opacity-60 shrink-0" />
            {value ? customerLabel(value) : placeholder}
            {value?.salesChannelName && (
              <span className="text-xs text-muted-foreground truncate">· {value.salesChannelName}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Mindestens 2 Zeichen…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {search.trim().length < 2
                ? "Bitte mindestens 2 Zeichen eingeben"
                : isLoading
                  ? "Suche…"
                  : "Keine Kunden gefunden"}
            </CommandEmpty>
            <CommandGroup heading="Shopware-Kunden">
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex flex-col min-w-0">
                    <span className="truncate">{customerLabel(c)}</span>
                    {c.salesChannelName && (
                      <span className="truncate text-xs text-muted-foreground">{c.salesChannelName}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {value ? (
              <CommandGroup>
                <CommandItem
                  className="text-destructive"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  Kunde entfernen
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
