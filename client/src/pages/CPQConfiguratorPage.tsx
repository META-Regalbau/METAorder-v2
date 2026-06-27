import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Package, Save, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import Shelf3DViewer from "@/components/cpq/Shelf3DViewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";

type CpqSystem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
};

type ConfigStep = "system" | "dimensions" | "levels" | "accessories" | "summary";
const STEP_ORDER: ConfigStep[] = ["system", "dimensions", "levels", "accessories", "summary"];

const SUMMARY_CONFIG_DEFAULTS: Record<string, unknown> = {
  height: 2000,
  depth: 600,
  field_count: 1,
  level_count: 2,
  width: 1000,
};

type BomLineItem = {
  productId: string;
  productNumber: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  componentType: string;
};

type BomResult = {
  items: BomLineItem[];
  totalPrice: number;
  errors: string[];
  warnings: string[];
};

type CpqCoreDecision = {
  classification: "A" | "B" | "C";
  status: "accepted" | "review_required" | "invalid";
  requiresReview: boolean;
  reviewStatus: "pending" | "not_required";
  disclaimers: string[];
  errors: string[];
};

type CpqCorePriceResult = CpqCoreDecision & {
  totals: { net: number; gross: number };
};

type CpqCoreSubmitTransferResult = {
  configurationId: string;
  classification: "A" | "B" | "C";
  status: "accepted" | "review_required";
  requiresReview: boolean;
  reviewStatus: "pending" | "not_required";
  transfer?: {
    status: "prepared" | "skipped" | "blocked";
    reason?: string;
    message?: string;
    offerId?: string;
  };
};

export default function CPQConfiguratorPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<ConfigStep>("system");
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveConfigName, setSaveConfigName] = useState("");
  const [savedCpqConfigurationId, setSavedCpqConfigurationId] = useState<string | null>(null);
  const [coreValidation, setCoreValidation] = useState<CpqCoreDecision | null>(null);
  const [corePrice, setCorePrice] = useState<CpqCorePriceResult | null>(null);
  const [submitResult, setSubmitResult] = useState<CpqCoreSubmitTransferResult | null>(null);

  const { data: systems = [], isLoading: systemsLoading } = useQuery<CpqSystem[]>({
    queryKey: ["/api/cpq/systems"],
  });

  const { data: optionsData, isLoading: optionsLoading } = useQuery<{
    options: Record<string, unknown>;
    availableOptions?: {
      heights: number[];
      depths: number[];
      widths: number[];
      field_counts: number[];
      level_counts: number[];
    };
    messages: string[];
    errors: string[];
    warnings: string[];
  }>({
    queryKey: ["/api/cpq/systems", selectedSystemId, "options", step, config],
    queryFn: async () => {
      if (!selectedSystemId) return { options: {}, messages: [], errors: [], warnings: [] };
      const res = await fetch(
        `/api/cpq/systems/${selectedSystemId}/options?step=${STEP_ORDER.indexOf(step) + 1}&config=${encodeURIComponent(JSON.stringify(config))}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    enabled: !!selectedSystemId,
  });

  const getCsrfHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    return headers;
  };

  const buildCoreRequestPayload = () => {
    const frameHeight = Number(config.height ?? SUMMARY_CONFIG_DEFAULTS.height ?? 2000);
    const frameDepth = Number(config.depth ?? SUMMARY_CONFIG_DEFAULTS.depth ?? 600);
    const frameWidth = Number(config.width ?? SUMMARY_CONFIG_DEFAULTS.width ?? 1000);
    const fieldCount = Math.max(1, Number(config.field_count ?? SUMMARY_CONFIG_DEFAULTS.field_count ?? 1));
    const levelCount = Math.max(1, Number(config.level_count ?? SUMMARY_CONFIG_DEFAULTS.level_count ?? 2));

    return {
      context: { customerGroup: "b2b_standard" as const },
      configuration: {
        frame: {
          heightMm: frameHeight,
          depthMm: frameDepth,
          widthMm: frameWidth,
          anchoringIncluded: frameHeight / Math.max(frameDepth, 1) <= 4,
        },
        shelves: [
          {
            material: "stahl_verzinkt",
            maxFachlastKg: 150,
            depthMm: frameDepth,
            widthMm: frameWidth,
            count: fieldCount * levelCount,
          },
        ],
        accessories: [],
        application: "werkstatt",
      },
    };
  };

  const { data: bom, isLoading: bomLoading, error: bomError } = useQuery<BomResult>({
    queryKey: ["/api/cpq/systems", selectedSystemId, "bill-of-materials", config],
    queryFn: async () => {
      if (!selectedSystemId) return { items: [], totalPrice: 0, errors: [], warnings: [] };
      const res = await fetch(`/api/cpq/systems/${selectedSystemId}/bill-of-materials`, {
        method: "POST",
        headers: getCsrfHeaders(),
        body: JSON.stringify({ config }),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = "Fehler beim Laden der Stückliste";
        try {
          const body = text ? JSON.parse(text) : {};
          if (typeof (body as { error?: string }).error === "string") msg = (body as { error: string }).error;
          else if (text) msg = text;
        } catch {
          if (text) msg = text;
        }
        throw new Error(msg);
      }
      return res.json();
    },
    enabled: !!selectedSystemId && step === "summary",
  });

  const saveConfigurationMutation = useMutation({
    mutationFn: async (name: string) => {
      if (!selectedSystemId) throw new Error("Kein System");
      const res = await fetch("/api/cpq/configurations", {
        method: "POST",
        headers: getCsrfHeaders(),
        body: JSON.stringify({
          systemId: selectedSystemId,
          name: name.trim(),
          configData: config,
          validationStatus: bom?.errors?.length ? "errors" : bom?.warnings?.length ? "warnings" : "valid",
          totalPrice: bom?.totalPrice ?? null,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Speichern fehlgeschlagen");
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (row) => {
      setSavedCpqConfigurationId(row.id);
      setSaveDialogOpen(false);
      toast({ title: "Gespeichert", description: "Konfiguration wurde in der Datenbank abgelegt." });
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const createOfferDraftMutation = useMutation({
    mutationFn: async () => {
      const systemName = systems.find((s) => s.id === selectedSystemId)?.name;
      const res = await fetch("/api/offer-drafts/from-cpq", {
        method: "POST",
        headers: getCsrfHeaders(),
        body: JSON.stringify({
          systemId: selectedSystemId,
          systemName,
          config,
          billOfMaterials: bom,
          ...(savedCpqConfigurationId ? { cpqConfigurationId: savedCpqConfigurationId } : {}),
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Fehler beim Erstellen des Angebots");
      }
      return res.json();
    },
    onSuccess: (draft) => {
      toast({ title: "Angebot erstellt", description: `Angebotsentwurf ${draft.originalFileName} wurde angelegt. Kunde zuordnen und Angebot erstellen unter Angebotsentwürfe.` });
      window.location.href = "/offers";
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const validateCoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSystemId) throw new Error("Kein System ausgewählt");
      const res = await apiRequest("POST", "/api/cpq-core/validate", {
        systemId: selectedSystemId,
        ...buildCoreRequestPayload(),
      });
      return res.json() as Promise<CpqCoreDecision>;
    },
    onSuccess: (result) => {
      setCoreValidation(result);
      toast({ title: "Validierung erfolgreich", description: `Klasse ${result.classification}` });
    },
    onError: (e: Error) => toast({ title: "Validierung fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const priceCoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSystemId) throw new Error("Kein System ausgewählt");
      const res = await apiRequest("POST", "/api/cpq-core/price", {
        systemId: selectedSystemId,
        ...buildCoreRequestPayload(),
      });
      return res.json() as Promise<CpqCorePriceResult>;
    },
    onSuccess: (result) => {
      setCorePrice(result);
      setCoreValidation(result);
      toast({ title: "Preis berechnet", description: `Netto ${result.totals.net.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}` });
    },
    onError: (e: Error) => toast({ title: "Preisberechnung fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const submitCoreMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSystemId) throw new Error("Kein System ausgewählt");
      const cartItems = (bom?.items ?? []).map((item) => ({
        product_id: item.productId,
        product_number: item.productNumber,
        quantity: item.quantity,
      }));
      const res = await apiRequest("POST", "/api/cpq-core/adapter/submit-transfer", {
        systemId: selectedSystemId,
        name: saveConfigName.trim() || `CPQ ${new Date().toISOString().slice(0, 10)}`,
        ...buildCoreRequestPayload(),
        cartTransfer: {
          cart_items: cartItems,
          create_offer: false,
        },
      });
      return res.json() as Promise<CpqCoreSubmitTransferResult>;
    },
    onSuccess: (result) => {
      setSubmitResult(result);
      toast({
        title: result.requiresReview ? "Review erforderlich" : "Submit erfolgreich",
        description: result.requiresReview
          ? "Klasse C wurde in die Review Queue eingesteuert."
          : "Cart/Checkout-Transfer wurde vorbereitet.",
      });
    },
    onError: (e: Error) => toast({ title: "Submit fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const currentStepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-cpq-configurator">Regal-Konfigurator</h1>
        <p className="text-muted-foreground">Stellen Sie Ihr Regal nach Maß zusammen</p>
      </div>

      <div className="flex gap-4">
        <Card className="flex-1 p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex gap-2">
              {STEP_ORDER.map((s, i) => (
                <Badge
                  key={s}
                  variant={s === step ? "default" : i < currentStepIndex ? "secondary" : "outline"}
                  className="cursor-pointer"
                  data-testid={`cpq-step-${s}`}
                  onClick={() => {
                    if (i <= currentStepIndex || (s === "system" && i === 0)) {
                      if (s === "summary") setConfig((prev) => ({ ...SUMMARY_CONFIG_DEFAULTS, ...prev }));
                      setStep(s);
                    }
                  }}
                >
                  {s === "system" && "System"}
                  {s === "dimensions" && "Maße"}
                  {s === "levels" && "Ebenen"}
                  {s === "accessories" && "Zubehör"}
                  {s === "summary" && "Zusammenfassung"}
                </Badge>
              ))}
            </div>
            <div className="text-sm text-muted-foreground">
              Schritt {currentStepIndex + 1} von {STEP_ORDER.length}
            </div>
          </div>

          {step === "system" && (
            <div className="space-y-4">
              <h3 className="font-semibold">Regalsystem wählen</h3>
              {systemsLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : systems.length === 0 ? (
                <p className="text-muted-foreground">Keine Regalsysteme verfügbar. Bitte wenden Sie sich an den Administrator.</p>
              ) : (
                <div className="grid gap-3">
                  {systems.map((sys) => (
                    <Card
                      key={sys.id}
                      className={`p-4 cursor-pointer transition-colors ${selectedSystemId === sys.id ? "ring-2 ring-primary" : "hover:bg-muted/50"}`}
                      data-testid={`cpq-system-card-${sys.slug}`}
                      onClick={() => setSelectedSystemId(sys.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Package className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{sys.name}</div>
                          {sys.description && <div className="text-sm text-muted-foreground">{sys.description}</div>}
                        </div>
                        {selectedSystemId === sys.id && <Badge>Ausgewählt</Badge>}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "dimensions" && selectedSystemId && (
            <div className="space-y-4">
              <h3 className="font-semibold">Grundmaße</h3>
              <p className="text-sm text-muted-foreground">Höhe, Tiefe und Felder definieren.</p>
              <div className="grid gap-4 max-w-md">
                <div>
                  <label className="text-sm font-medium">Höhe (mm)</label>
                  <Select
                    value={config.height != null ? String(config.height) : ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, height: parseInt(v, 10) }))}
                  >
                    <SelectTrigger data-testid="cpq-select-height"><SelectValue placeholder="Wählen" /></SelectTrigger>
                    <SelectContent>
                      {(optionsData?.availableOptions?.heights ?? [1800, 2000, 2200, 2500, 3000]).map((h) => (
                        <SelectItem key={h} value={String(h)}>{h} mm</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Tiefe (mm)</label>
                  <Select
                    value={config.depth != null ? String(config.depth) : ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, depth: parseInt(v, 10) }))}
                  >
                    <SelectTrigger data-testid="cpq-select-depth"><SelectValue placeholder="Wählen" /></SelectTrigger>
                    <SelectContent>
                      {(optionsData?.availableOptions?.depths ?? [400, 500, 600, 800]).map((d) => (
                        <SelectItem key={d} value={String(d)}>{d} mm</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Anzahl Felder</label>
                  <Select
                    value={config.field_count != null ? String(config.field_count) : ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, field_count: parseInt(v, 10) }))}
                  >
                    <SelectTrigger data-testid="cpq-select-field-count"><SelectValue placeholder="Wählen" /></SelectTrigger>
                    <SelectContent>
                      {(optionsData?.availableOptions?.field_counts ?? [1, 2, 3, 4, 5, 6, 8, 10]).map((f) => (
                        <SelectItem key={f} value={String(f)}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Feldbreite / Bodenbreite (mm)</label>
                  <Select
                    value={config.width != null ? String(config.width) : ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, width: parseInt(v, 10) }))}
                  >
                    <SelectTrigger data-testid="cpq-select-width"><SelectValue placeholder="Standard: 1000" /></SelectTrigger>
                    <SelectContent>
                      {(optionsData?.availableOptions?.widths ?? [1000, 1200, 800]).map((w) => (
                        <SelectItem key={w} value={String(w)}>{w} mm</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === "levels" && selectedSystemId && (
            <div className="space-y-4">
              <h3 className="font-semibold">Ebenen</h3>
              <p className="text-sm text-muted-foreground">Anzahl der Fachebenen und Bodentyp.</p>
              <div className="max-w-md space-y-4">
                <div>
                  <label className="text-sm font-medium">Anzahl Ebenen</label>
                  <Select
                    value={config.level_count != null ? String(config.level_count) : ""}
                    onValueChange={(v) => setConfig((c) => ({ ...c, level_count: parseInt(v, 10) }))}
                  >
                    <SelectTrigger data-testid="cpq-select-level-count"><SelectValue placeholder="Wählen" /></SelectTrigger>
                    <SelectContent>
                      {(optionsData?.availableOptions?.level_counts ?? [2, 3, 4, 5, 6, 8, 10]).map((l) => (
                        <SelectItem key={l} value={String(l)}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === "accessories" && selectedSystemId && (
            <div className="space-y-4">
              <h3 className="font-semibold">Zubehör</h3>
              <p className="text-sm text-muted-foreground">Optionales Zubehör wie Fußplatten, Rückwände.</p>
              <p className="text-muted-foreground text-sm">Pflicht-Zubehör wird automatisch vorausgewählt.</p>
            </div>
          )}

          {step === "summary" && selectedSystemId && (
            <div className="space-y-4">
              <h3 className="font-semibold">Zusammenfassung</h3>
              <p className="text-sm text-muted-foreground">Stückliste und Gesamtpreis.</p>

              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => validateCoreMutation.mutate()}
                    disabled={validateCoreMutation.isPending}
                    data-testid="cpq-button-validate-core"
                  >
                    {validateCoreMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Validate (CPQ Core)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => priceCoreMutation.mutate()}
                    disabled={priceCoreMutation.isPending}
                    data-testid="cpq-button-price-core"
                  >
                    {priceCoreMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Price (CPQ Core)
                  </Button>
                  <Button
                    type="button"
                    onClick={() => submitCoreMutation.mutate()}
                    disabled={submitCoreMutation.isPending || !bom || bom.items.length === 0 || bom.errors.length > 0}
                    data-testid="cpq-button-submit-transfer"
                  >
                    {submitCoreMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    Submit + Cart-Transfer vorbereiten
                  </Button>
                </div>

                {coreValidation && (
                  <div className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Validierung:</span>
                      <Badge variant={coreValidation.requiresReview ? "destructive" : "default"}>
                        Klasse {coreValidation.classification} / {coreValidation.status}
                      </Badge>
                    </div>
                    {coreValidation.disclaimers.length > 0 && (
                      <div className="mt-2 text-amber-600 dark:text-amber-400">
                        {coreValidation.disclaimers.map((text, i) => (
                          <div key={`disc-${i}`}>• {text}</div>
                        ))}
                      </div>
                    )}
                    {coreValidation.errors.length > 0 && (
                      <div className="mt-2 text-destructive">
                        {coreValidation.errors.map((text, i) => (
                          <div key={`err-${i}`}>• {text}</div>
                        ))}
                      </div>
                    )}
                    {coreValidation.requiresReview && (
                      <p className="mt-2 text-sm text-destructive">
                        Klasse C erkannt: Submit liefert immer <span className="font-mono">review_required</span> und erfordert Vertriebs-Review.
                      </p>
                    )}
                  </div>
                )}

                {corePrice && (
                  <div className="text-sm text-muted-foreground">
                    Preisvorschau: Netto {corePrice.totals.net.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} /
                    Brutto {corePrice.totals.gross.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                  </div>
                )}

                {submitResult && (
                  <div className="rounded border p-3 text-sm">
                    <div className="font-medium">
                      Submit: Klasse {submitResult.classification}, Status {submitResult.status}
                    </div>
                    <div className="text-muted-foreground">
                      Konfigurations-ID: <span className="font-mono">{submitResult.configurationId}</span>
                    </div>
                    {submitResult.transfer && (
                      <div className="mt-1 text-muted-foreground">
                        Transfer: {submitResult.transfer.status}
                        {submitResult.transfer.reason ? ` (${submitResult.transfer.reason})` : ""}
                      </div>
                    )}
                  </div>
                )}
              </Card>

              {bomError ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
                  {bomError.message}
                </div>
              ) : bomLoading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stückliste wird berechnet…
                </div>
              ) : bom && bom.items.length > 0 ? (
                <>
                  <div className="rounded-lg border overflow-hidden">
                    <Table data-testid="cpq-bom-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pos.</TableHead>
                          <TableHead>Artikelnummer / Produktname</TableHead>
                          <TableHead className="text-right">Menge</TableHead>
                          <TableHead className="text-right">Einzelpreis</TableHead>
                          <TableHead className="text-right">Summe</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bom.items.map((item, i) => (
                        <TableRow key={item.productId + i}>
                            <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">{item.productNumber}</span>
                              {item.name && <span className="text-muted-foreground block text-xs font-normal mt-0.5">{item.name}</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono">{item.quantity}</TableCell>
                            <TableCell className="text-right font-mono">
                              {item.unitPrice.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              {item.lineTotal.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="font-semibold">Gesamtpreis (Brutto)</div>
                    <div className="text-lg font-bold">
                      {bom.totalPrice.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                    </div>
                  </div>
                  {bom.warnings.length > 0 && (
                    <div className="text-sm text-amber-600 dark:text-amber-400">
                      {bom.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                  {bom.errors.length > 0 && (
                    <div className="text-sm text-destructive">
                      {bom.errors.map((e, i) => (
                        <div key={i}>• {e}</div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const sys = systems.find((s) => s.id === selectedSystemId)?.name ?? "Konfiguration";
                        setSaveConfigName(`${sys} ${new Date().toISOString().slice(0, 10)}`);
                        setSaveDialogOpen(true);
                      }}
                      disabled={bom.errors.length > 0 || saveConfigurationMutation.isPending}
                      data-testid="cpq-button-save-configuration"
                    >
                      {saveConfigurationMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Konfiguration speichern
                    </Button>
                    <Button
                      onClick={() => createOfferDraftMutation.mutate()}
                      disabled={createOfferDraftMutation.isPending || bom.errors.length > 0}
                      className="w-full sm:w-auto"
                      data-testid="cpq-button-create-offer-draft"
                    >
                      {createOfferDraftMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Package className="h-4 w-4 mr-2" />
                      )}
                      In den Warenkorb (Angebotsentwurf)
                    </Button>
                  </div>
                  {savedCpqConfigurationId && (
                    <p className="text-xs text-muted-foreground">
                      Verknüpfte Konfigurations-ID: <span className="font-mono">{savedCpqConfigurationId}</span>
                    </p>
                  )}
                </>
              ) : bom && (bom.errors.length > 0 || (bom.items.length === 0 && (bom.warnings?.length ?? 0) > 0)) ? (
                <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
                  {bom.errors.map((e, i) => (
                    <div key={i}>• {e}</div>
                  ))}
                  {bom.items.length === 0 && (bom.warnings?.length ?? 0) > 0 && (
                    <div className="mt-2 text-amber-600 dark:text-amber-400">
                      {bom.warnings!.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-muted-foreground">Bitte im CPQ Admin prüfen: gleiches System auswählen → Tab Produkt-Mappings → Komponententypen anlegen und Shopware-Produkte zuordnen. Rollen der Komponententypen müssen „frame“, „beam“ oder „shelf“ heißen (für Stücklistenberechnung).</p>
                  <p className="mt-2 text-muted-foreground">Falls Produkte fehlen: Shopware-Sync in den Einstellungen ausführen (Admin → Einstellungen → Shopware).</p>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/50 p-6 text-center text-muted-foreground">
                  {bom && bom.items.length === 0 ? (
                    <>
                      Keine Stückliste berechnet. Bitte im CPQ Admin für <strong>dieses System</strong> Komponententypen und Produkt-Mappings anlegen.
                      <p className="mt-2 text-sm">Falls Produkte fehlen: Shopware-Sync in den Einstellungen ausführen (Admin → Einstellungen → Shopware).</p>
                      {(bom.warnings?.length ?? 0) > 0 && (
                        <div className="mt-3 text-left text-sm text-amber-600 dark:text-amber-400">
                          {bom.warnings!.map((w, i) => (
                            <div key={i}>• {w}</div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    "Keine Stückliste verfügbar. Bitte legen Sie Komponententypen und Produkt-Mappings im CPQ Admin an."
                  )}
                  <pre className="mt-3 text-left text-xs overflow-auto max-h-32 bg-background p-3 rounded">
                    {JSON.stringify(config, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between mt-8 pt-4 border-t">
            <Button variant="outline" disabled={currentStepIndex === 0} onClick={() => setStep(STEP_ORDER[currentStepIndex - 1]!)}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Zurück
            </Button>
            <Button
              data-testid="cpq-button-next-step"
              disabled={step === "system" && !selectedSystemId}
              onClick={() => {
                if (currentStepIndex < STEP_ORDER.length - 1) {
                  const nextStep = STEP_ORDER[currentStepIndex + 1]!;
                  if (nextStep === "summary") {
                    setConfig((prev) => ({ ...SUMMARY_CONFIG_DEFAULTS, ...prev }));
                  }
                  setStep(nextStep);
                }
              }}
            >
              Weiter
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </Card>

        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Konfiguration speichern</DialogTitle>
              <DialogDescription>
                Name für diese Konfiguration (wiederauffindbar im System, optional für Angebotsentwurf).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="cpq-save-name">Name</Label>
              <Input
                id="cpq-save-name"
                value={saveConfigName}
                onChange={(e) => setSaveConfigName(e.target.value)}
                placeholder="z. B. META CLIP Lager 2026-04-02"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button
                type="button"
                disabled={!saveConfigName.trim() || saveConfigurationMutation.isPending}
                onClick={() => saveConfigurationMutation.mutate(saveConfigName)}
                data-testid="cpq-button-confirm-save"
              >
                Speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card className="w-80 p-6 shrink-0">
          <h3 className="font-semibold mb-4">Live-Vorschau</h3>
          {selectedSystemId ? (
            <Shelf3DViewer systemId={selectedSystemId} config={config} />
          ) : (
            <div className="aspect-square bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">
              System wählen für Vorschau
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
