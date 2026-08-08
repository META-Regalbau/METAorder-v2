import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  MapPin,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BarcodeLiveScanner } from "@/components/BarcodeLiveScanner";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";
import type { ErpProductLabel } from "@shared/productVariantLabel";

type CountLine = {
  id: string;
  productNumber: string;
  expectedQty: number;
  countedQty: number | null;
  difference: number | null;
};

type CountRow = {
  id: string;
  warehouseId: string;
  status: string;
  notes?: string | null;
  createdAt?: string;
};

type CountDetail = CountRow & { lines: CountLine[] };

type ScanResult =
  | { kind: "location"; location: { id: string; code: string; name?: string | null } }
  | { kind: "product"; product: ErpProductLabel }
  | { kind: "unknown"; code: string };

function progressOf(lines: CountLine[]) {
  const counted = lines.filter((l) => l.countedQty != null).length;
  const diffs = lines.filter((l) => l.countedQty != null && l.countedQty !== l.expectedQty).length;
  return { counted, total: lines.length, diffs };
}

function MobileInventoryList({
  counts,
  warehouseById,
  warehouses,
}: {
  counts: CountRow[];
  warehouseById: Map<string, string>;
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const open = counts.filter((c) => c.status !== "completed");

  const startCount = useMutation({
    mutationFn: async () => {
      const warehouseId =
        warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || "";
      if (!warehouseId) throw new Error(t("erp.mobileInventory.noWarehouse"));
      const res = await apiRequest("POST", "/api/erp/inventory-counts", { warehouseId });
      const data = (await res.json()) as { count: CountRow };
      // Positionen direkt aus dem ERP-Bestand vorbelegen — sonst startet man im Lager
      // mit einer leeren Liste und muss jede Position erst erscannen.
      await apiRequest("POST", `/api/erp/inventory-counts/${data.count.id}/seed-from-stock`, {});
      return data.count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts"] });
      setLocation(`/mobile/inventory/${count.id}`);
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {open.length === 0 ? (
        <p className="text-muted-foreground text-center py-12 px-4">
          {t("erp.mobileInventory.empty")}
        </p>
      ) : (
        <ul className="divide-y border-t">
          {open.map((c) => {
            const wh = warehouseById.get(c.warehouseId) || c.warehouseId.slice(0, 8);
            return (
              <li key={c.id}>
                <Link
                  href={`/mobile/inventory/${c.id}`}
                  className="block px-4 py-4 active:bg-muted/60 hover:bg-muted/40"
                >
                  <div className="font-medium">{wh}</div>
                  {c.createdAt ? (
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(c.createdAt).toLocaleString()}
                    </div>
                  ) : null}
                  {c.notes ? (
                    <div className="text-sm text-muted-foreground truncate">{c.notes}</div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="p-3 mt-auto border-t">
        <Button
          className="w-full h-12 text-base"
          disabled={startCount.isPending || warehouses.length === 0}
          onClick={() => startCount.mutate()}
          data-testid="mobile-inventory-start"
        >
          <Plus className="h-5 w-5 mr-2" />
          {t("erp.mobileInventory.start")}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center mt-2">
          {t("erp.mobileInventory.startHint")}
        </p>
      </div>
    </div>
  );
}

function MobileInventoryDetail({
  count,
  labels,
  warehouseLabel,
}: {
  count: CountDetail;
  labels: Record<string, ErpProductLabel>;
  warehouseLabel: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const scanBusyRef = useRef(false);
  const [binFilter, setBinFilter] = useState<{ id: string; code: string } | null>(null);
  const [binProducts, setBinProducts] = useState<Set<string> | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const lines = count.lines || [];
  const { counted, total, diffs } = progressOf(lines);
  const done = count.status === "completed";

  const visibleLines = useMemo(() => {
    let list = lines;
    if (binProducts) list = list.filter((l) => binProducts.has(l.productNumber));
    if (onlyOpen) list = list.filter((l) => l.countedQty == null);
    return list;
  }, [lines, binProducts, onlyOpen]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", count.id] });

  const updateLine = useMutation({
    mutationFn: async (args: { lineId: string; countedQty: number | null }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/erp/inventory-counts/${count.id}/lines/${args.lineId}`,
        { countedQty: args.countedQty },
      );
      return (await res.json()) as { line: CountLine };
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const addLine = useMutation({
    mutationFn: async (args: { productNumber: string; countedQty: number }) => {
      const res = await apiRequest("POST", `/api/erp/inventory-counts/${count.id}/lines`, args);
      return (await res.json()) as { line: CountLine };
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const completeCount = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/erp/inventory-counts/${count.id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      toast({ title: t("erp.mobileInventory.completed") });
      setLocation("/mobile/inventory");
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  /** Artikelnummern, die auf einem Lagerplatz liegen — für den Filter nach Regal-Scan. */
  async function loadBinProducts(locationId: string) {
    try {
      const res = await apiRequest(
        "GET",
        `/api/erp/stock?warehouseId=${encodeURIComponent(count.warehouseId)}`,
      );
      const data = (await res.json()) as {
        stock: Array<{ productNumber: string; locationId?: string | null }>;
      };
      setBinProducts(
        new Set(
          data.stock.filter((s) => s.locationId === locationId).map((s) => s.productNumber),
        ),
      );
    } catch {
      setBinProducts(null);
      toast({ title: t("erp.mobileInventory.binFilterFailed"), variant: "destructive" });
    }
  }

  async function bumpCount(line: CountLine, delta: 1 | -1) {
    const next = Math.max(0, (line.countedQty ?? 0) + delta);
    await updateLine.mutateAsync({ lineId: line.id, countedQty: next });
  }

  async function handleScan(raw: string) {
    if (done || scanBusyRef.current) return;
    const code = normalizeScanCode(raw) || raw.trim();
    if (!code) return;
    scanBusyRef.current = true;
    try {
      const res = await apiRequest(
        "GET",
        `/api/erp/scan/resolve?code=${encodeURIComponent(code)}&warehouseId=${encodeURIComponent(count.warehouseId)}`,
      );
      const result = (await res.json()) as ScanResult;

      if (result.kind === "location") {
        setBinFilter({ id: result.location.id, code: result.location.code });
        await loadBinProducts(result.location.id);
        toast({ title: t("erp.mobileInventory.binSet", { code: result.location.code }) });
        return;
      }

      const productNumber =
        result.kind === "product" ? result.product.productNumber : code;

      const existing = lines.find((l) => l.productNumber === productNumber);
      if (existing) {
        const next = (existing.countedQty ?? 0) + 1;
        await updateLine.mutateAsync({ lineId: existing.id, countedQty: next });
        toast({
          title: t("erp.mobileInventory.counted", { productNumber, qty: next }),
        });
      } else if (result.kind === "product") {
        await addLine.mutateAsync({ productNumber, countedQty: 1 });
        toast({ title: t("erp.mobileInventory.lineAdded", { productNumber }) });
      } else {
        toast({
          title: t("erp.mobileInventory.unknownCode", { code }),
          variant: "destructive",
        });
        return;
      }

      try {
        navigator.vibrate?.(40);
      } catch {
        // ignore
      }
    } catch (e: any) {
      toast({
        title: t("errors.failed"),
        description: e?.message || String(e),
        variant: "destructive",
      });
    } finally {
      scanBusyRef.current = false;
    }
  }

  function handleComplete() {
    const uncounted = total - counted;
    const message =
      uncounted > 0
        ? t("erp.mobileInventory.confirmWithUncounted", { uncounted, diffs })
        : t("erp.mobileInventory.confirmComplete", { diffs });
    if (!window.confirm(message)) return;
    completeCount.mutate();
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="shrink-0 border-b bg-background">
        <BarcodeLiveScanner active={!done} onScan={(c) => void handleScan(c)} />
      </div>

      <div className="px-3 py-2 flex items-center justify-between gap-2 border-b bg-muted/30">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{warehouseLabel}</div>
          <div className="text-xs text-muted-foreground">
            {t("erp.mobileInventory.progress", { counted, total })}
            {diffs > 0 ? ` · ${t("erp.mobileInventory.diffCount", { count: diffs })}` : ""}
          </div>
        </div>
        <Badge variant={counted >= total && total > 0 ? "success" : "warning"}>
          {counted}/{total}
        </Badge>
      </div>

      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b">
        {binFilter ? (
          <Badge variant="secondary" className="gap-1 py-1.5 pl-2 pr-1 text-sm">
            <MapPin className="h-3.5 w-3.5" />
            <span className="font-mono">{binFilter.code}</span>
            <button
              type="button"
              className="ml-1 rounded p-0.5 hover:bg-background/60"
              onClick={() => {
                setBinFilter(null);
                setBinProducts(null);
              }}
              aria-label={t("erp.mobileInventory.clearBin")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("erp.mobileInventory.binHint")}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant={onlyOpen ? "default" : "outline"}
          className="ml-auto h-8"
          onClick={() => setOnlyOpen((v) => !v)}
        >
          {t("erp.mobileInventory.onlyOpen")}
        </Button>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y pb-28">
        {visibleLines.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("erp.mobileInventory.noLines")}
          </li>
        ) : null}
        {visibleLines.map((line) => {
          const label = labels[line.productNumber];
          const isCounted = line.countedQty != null;
          const diff = isCounted ? (line.countedQty as number) - line.expectedQty : null;
          return (
            <li
              key={line.id}
              className={`px-3 py-3 ${
                isCounted && diff === 0 ? "bg-emerald-50 dark:bg-emerald-950/30" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold flex items-center gap-1.5">
                    {isCounted && diff === 0 ? (
                      <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    ) : null}
                    <span className="truncate">{line.productNumber}</span>
                  </div>
                  {label?.name ? (
                    <div className="text-sm text-muted-foreground truncate">{label.name}</div>
                  ) : null}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t("erp.mobileInventory.expected", { qty: line.expectedQty })}
                    {diff != null && diff !== 0 ? (
                      <span
                        className={
                          diff > 0
                            ? " text-emerald-700 dark:text-emerald-400 font-medium"
                            : " text-destructive font-medium"
                        }
                      >
                        {` · ${diff > 0 ? "+" : ""}${diff}`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11"
                    disabled={done || (line.countedQty ?? 0) <= 0}
                    onClick={() => void bumpCount(line, -1)}
                    aria-label={t("erp.mobileInventory.decrement")}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    disabled={done}
                    value={line.countedQty ?? ""}
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0));
                      void updateLine.mutateAsync({ lineId: line.id, countedQty: next });
                    }}
                    className="h-11 w-16 text-center text-base font-semibold tabular-nums border rounded-md bg-background"
                    aria-label={t("erp.mobileInventory.countedField")}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11"
                    disabled={done}
                    onClick={() => void bumpCount(line, 1)}
                    aria-label={t("erp.mobileInventory.increment")}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="fixed bottom-0 inset-x-0 p-3 border-t bg-background/95 backdrop-blur safe-pb space-y-2">
        <p className="text-[11px] text-muted-foreground text-center">
          {t("erp.mobileInventory.completeHint")}
        </p>
        <Button
          className="w-full h-12 text-base"
          disabled={completeCount.isPending || done}
          onClick={handleComplete}
          data-testid="mobile-inventory-complete"
        >
          {t("erp.mobileInventory.complete")}
        </Button>
      </div>
    </div>
  );
}

export default function MobileInventoryPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/mobile/inventory/:id");
  const countId = params?.id;

  const { data: countsData, isLoading } = useQuery<{ counts: CountRow[] }>({
    queryKey: ["/api/erp/inventory-counts"],
  });
  const counts = countsData?.counts ?? [];

  const { data: whData } = useQuery<{
    warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
  }>({ queryKey: ["/api/erp/warehouses"] });
  const warehouses = useMemo(() => whData?.warehouses ?? [], [whData]);
  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses) map.set(w.id, `${w.code} — ${w.name}`);
    return map;
  }, [warehouses]);

  const { data: detailData, isLoading: detailLoading } = useQuery<{
    count: CountDetail;
    labels?: Record<string, ErpProductLabel>;
  }>({
    queryKey: ["/api/erp/inventory-counts", countId],
    enabled: Boolean(countId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/erp/inventory-counts/${countId}`);
      return res.json();
    },
  });

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-3 bg-background">
        {countId ? (
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" asChild>
            <Link href="/mobile/inventory" aria-label={t("erp.mobileInventory.backToList")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        ) : (
          <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold truncate">
            {countId ? t("erp.mobileInventory.detailTitle") : t("erp.mobileInventory.title")}
          </h1>
          {!countId ? (
            <p className="text-xs text-muted-foreground truncate">
              {t("erp.mobileInventory.subtitle")}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/warehouse">{t("erp.mobileInventory.toDesktop")}</Link>
        </Button>
      </header>

      {countId ? (
        detailLoading ? (
          <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
        ) : detailData?.count ? (
          <MobileInventoryDetail
            count={detailData.count}
            labels={detailData.labels ?? {}}
            warehouseLabel={
              warehouseById.get(detailData.count.warehouseId) ||
              detailData.count.warehouseId.slice(0, 8)
            }
          />
        ) : (
          <div className="p-4 space-y-3">
            <p className="text-destructive">{t("erp.mobileInventory.notFound")}</p>
            <Button asChild variant="outline">
              <Link href="/mobile/inventory">{t("erp.mobileInventory.backToList")}</Link>
            </Button>
          </div>
        )
      ) : isLoading ? (
        <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
      ) : (
        <MobileInventoryList
          counts={counts}
          warehouseById={warehouseById}
          warehouses={warehouses}
        />
      )}
    </div>
  );
}
