import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Plus,
  Save,
  Trash2,
  UserRound,
  FileText,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import DiscountTrafficLight from "@/components/cpq/DiscountTrafficLight";
import { OfferDraftReviewModal } from "@/components/OfferDraftReviewModal";
import { fetchOfferDraftForReview } from "@/lib/refreshReviewDraft";
import type { Product, OfferDraftWithCrossSelling } from "@shared/schema";

type ShopwareCustomer = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
};

type BuilderLine = {
  key: string;
  productId: string;
  productNumber: string;
  name: string;
  quantity: number;
  /** Netto-Katalog-Stückpreis */
  unitNetCatalog: number;
  /** Rabatt in Prozent auf den Katalogpreis */
  discountPercent: number;
};

const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function newKey(): string {
  return `line-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function customerLabel(c: ShopwareCustomer): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const parts = [c.company, name].filter(Boolean);
  const head = parts.join(" · ") || c.email || c.id;
  return c.email && head !== c.email ? `${head} (${c.email})` : head;
}

function CustomerSearch({
  value,
  onChange,
}: {
  value: ShopwareCustomer | null;
  onChange: (c: ShopwareCustomer | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ customers: ShopwareCustomer[] }>({
    queryKey: ["/api/offer-drafts/customer-search", search],
    enabled: open && search.trim().length >= 2,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/offer-drafts/customer-search?q=${encodeURIComponent(search.trim())}`,
      );
      return res.json();
    },
  });

  const customers = data?.customers ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          <span className="truncate flex items-center gap-2">
            <UserRound className="h-4 w-4 opacity-60" />
            {value ? customerLabel(value) : "Kunde suchen (Name, Firma, E-Mail)"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px] p-0" align="start">
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
                  <Check className={cn("mr-2 h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{customerLabel(c)}</span>
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

function ProductSearch({ onAdd }: { onAdd: (product: Product) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ products: Product[]; total: number }>({
    queryKey: ["/api/products/search", "offer-builder", search],
    enabled: open && search.trim().length >= 2,
    // Ergebnisse 6h cachen (serverseitiger Cache) – kein Live-Shopware-Abruf pro Tastendruck.
    staleTime: 6 * 60 * 60 * 1000,
    queryFn: async () => {
      const params = new URLSearchParams({ search: search.trim(), limit: "50", page: "1" });
      const res = await apiRequest("GET", `/api/products/search?${params.toString()}`);
      return res.json();
    },
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between sm:w-auto">
          <span className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Position hinzufügen
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Artikelnummer oder Name (min. 2 Zeichen)"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {search.trim().length < 2
                ? "Bitte mindestens 2 Zeichen eingeben"
                : isLoading
                  ? "Suche…"
                  : "Keine Produkte gefunden"}
            </CommandEmpty>
            <CommandGroup heading="Katalog">
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={product.id}
                  onSelect={() => {
                    onAdd(product);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-medium">{product.productNumber || "Ohne Nummer"}</span>
                      <span className="truncate text-xs text-muted-foreground">{product.name}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {eur.format(product.netPrice ?? 0)} netto
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {total > products.length ? (
              <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                {products.length} von {total} Treffern – Suche verfeinern für genauere Ergebnisse
              </div>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function OfferBuilderPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [customer, setCustomer] = useState<ShopwareCustomer | null>(null);
  const [lines, setLines] = useState<BuilderLine[]>([]);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState<string>(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );

  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<OfferDraftWithCrossSelling | null>(null);

  const totals = useMemo(() => {
    let catalogNet = 0;
    let discountedNet = 0;
    for (const line of lines) {
      const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
      const unit = Number.isFinite(line.unitNetCatalog) ? line.unitNetCatalog : 0;
      const disc = Math.min(100, Math.max(0, Number.isFinite(line.discountPercent) ? line.discountPercent : 0));
      catalogNet += qty * unit;
      discountedNet += qty * round2(unit * (1 - disc / 100));
    }
    catalogNet = round2(catalogNet);
    discountedNet = round2(discountedNet);
    const discountPercent = catalogNet > 0 ? round2(((catalogNet - discountedNet) / catalogNet) * 100) : 0;
    return { catalogNet, discountedNet, discountPercent };
  }, [lines]);

  const addProduct = (product: Product) => {
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        productId: product.id,
        productNumber: product.productNumber || "",
        name: product.name || product.productNumber || "Produkt",
        quantity: 1,
        unitNetCatalog: round2(product.netPrice ?? 0),
        discountPercent: 0,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<BuilderLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const buildPayload = () => {
    const items = lines.map((line) => {
      const qty = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
      const disc = Math.min(100, Math.max(0, Number.isFinite(line.discountPercent) ? line.discountPercent : 0));
      const unitDiscounted = round2(line.unitNetCatalog * (1 - disc / 100));
      return {
        extractedProductName: line.name,
        extractedProductNumber: line.productNumber,
        quantity: qty,
        matchedProduct: {
          id: line.productId,
          productNumber: line.productNumber,
          name: line.name,
          catalogPrice: round2(line.unitNetCatalog),
          suggestedPrice: unitDiscounted,
          suggestedDiscount: disc,
          manualUnitPriceNet: unitDiscounted,
        },
        confidence: 100,
        status: "matched" as const,
        productScreen: { likelihood: "likely_product" as const, reasons: ["Manueller Angebots-Builder"] },
      };
    });

    const matchingResults = {
      items,
      overallConfidence: 100,
      pricingRecommendations: {
        totalCatalogValue: totals.catalogNet,
        totalSuggestedValue: totals.discountedNet,
        totalDiscountPercentage: totals.discountPercent,
        reasoning: "Manueller Angebots-Builder (Nettopreise)",
      },
    };

    const extractedData = {
      manualBuilder: true,
      offerNotes: notes,
      validUntil,
      customer: customer
        ? {
            firstName: customer.firstName,
            lastName: customer.lastName,
            company: customer.company,
            email: customer.email,
          }
        : undefined,
    };

    return { matchingResults, extractedData };
  };

  const ensureDraftSaved = async (): Promise<string | null> => {
    if (lines.length === 0) {
      toast({ variant: "destructive", title: "Keine Positionen", description: "Bitte mindestens ein Produkt hinzufügen." });
      return null;
    }
    setSaving(true);
    try {
      let id = draftId;
      if (!id) {
        const res = await apiRequest("POST", "/api/offer-drafts/blank", { offerNotes: notes });
        const created = await res.json();
        id = created.id as string;
        setDraftId(id);
      }
      const { matchingResults, extractedData } = buildPayload();
      await apiRequest("PATCH", `/api/offer-drafts/${id}`, {
        matchingResults,
        extractedData,
        shopwareCustomerId: customer?.id ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      return id;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Speichern fehlgeschlagen",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const id = await ensureDraftSaved();
    if (id) {
      toast({ title: "Entwurf gespeichert", description: "Das Angebot wurde als Entwurf gesichert." });
    }
  };

  const handleProceed = async () => {
    if (!customer) {
      toast({ variant: "destructive", title: "Kunde fehlt", description: "Bitte zuerst einen Shopware-Kunden zuordnen." });
      return;
    }
    const id = await ensureDraftSaved();
    if (!id) return;
    try {
      const full = await fetchOfferDraftForReview(id);
      setReviewDraft(full);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Konnte Review nicht öffnen",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Angebot erstellen</h1>
          <p className="text-sm text-muted-foreground">
            Positionen manuell zusammenstellen, Rabatt setzen und als Angebot anlegen. Alle Preise sind Nettopreise.
          </p>
        </div>
      </div>

      <Card className="space-y-3 p-4">
        <Label>Kunde</Label>
        <CustomerSearch value={customer} onChange={setCustomer} />
        {!customer ? (
          <p className="text-xs text-muted-foreground">
            Für die Angebotserstellung in Shopware ist ein zugeordneter Kunde erforderlich.
          </p>
        ) : null}
      </Card>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Positionen</h2>
          <ProductSearch onAdd={addProduct} />
        </div>

        {lines.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Noch keine Positionen. Über „Position hinzufügen" Produkte aus dem Katalog wählen.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produkt</TableHead>
                <TableHead className="w-24 text-right">Menge</TableHead>
                <TableHead className="w-36 text-right">Netto-Stückpreis</TableHead>
                <TableHead className="w-28 text-right">Rabatt %</TableHead>
                <TableHead className="w-36 text-right">Positionswert</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const disc = Math.min(100, Math.max(0, line.discountPercent || 0));
                const unitDiscounted = round2(line.unitNetCatalog * (1 - disc / 100));
                const lineTotal = round2((line.quantity || 0) * unitDiscounted);
                return (
                  <TableRow key={line.key}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{line.productNumber || "Ohne Nummer"}</span>
                        <span className="text-xs text-muted-foreground">{line.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: parseInt(e.target.value, 10) || 0 })}
                        className="h-8 text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unitNetCatalog}
                        onChange={(e) => updateLine(line.key, { unitNetCatalog: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        value={line.discountPercent}
                        onChange={(e) => updateLine(line.key, { discountPercent: parseFloat(e.target.value) || 0 })}
                        className="h-8 text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">{eur.format(lineTotal)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeLine(line.key)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {lines.length > 0 ? (
          <div className="flex flex-col items-end gap-1 border-t pt-3 text-sm">
            <div className="flex w-64 justify-between">
              <span className="text-muted-foreground">Katalogwert (netto)</span>
              <span>{eur.format(totals.catalogNet)}</span>
            </div>
            {totals.discountPercent > 0 ? (
              <div className="flex w-64 justify-between text-muted-foreground">
                <span>Rabatt ({totals.discountPercent.toFixed(1)}%)</span>
                <span>- {eur.format(round2(totals.catalogNet - totals.discountedNet))}</span>
              </div>
            ) : null}
            <div className="flex w-64 justify-between text-base font-semibold">
              <span>Angebotswert (netto)</span>
              <span>{eur.format(totals.discountedNet)}</span>
            </div>
          </div>
        ) : null}
      </Card>

      {lines.length > 0 && totals.catalogNet > 0 ? (
        <DiscountTrafficLight
          listPrice={totals.catalogNet}
          discountedPrice={totals.discountedNet}
          orderValue={totals.discountedNet}
        />
      ) : null}

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="offer-valid-until">Gültig bis</Label>
          <Input
            id="offer-valid-until"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="offer-notes">Notiz (optional)</Label>
          <Textarea
            id="offer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Interne Notiz oder Hinweis für das Angebot"
            rows={3}
          />
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" onClick={handleSave} disabled={saving || lines.length === 0}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Als Entwurf speichern
        </Button>
        <Button onClick={handleProceed} disabled={saving || lines.length === 0}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
          Zur Angebotserstellung
        </Button>
      </div>

      {reviewDraft ? (
        <OfferDraftReviewModal
          draft={reviewDraft}
          open={!!reviewDraft}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setReviewDraft(null);
              void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
            }
          }}
          onUpdate={() => {
            if (draftId) {
              void fetchOfferDraftForReview(draftId).then(setReviewDraft).catch(() => undefined);
            }
          }}
        />
      ) : null}
    </div>
  );
}
