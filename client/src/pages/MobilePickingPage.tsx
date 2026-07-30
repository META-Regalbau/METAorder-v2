import { useMemo, useRef } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Minus, Plus, Smartphone, AlertTriangle, PackageX, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BarcodeLiveScanner } from "@/components/BarcodeLiveScanner";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";
import {
  BrowserPrintUnavailableError,
  printShippingLabelPdf,
} from "@/lib/zebra/browserPrint";

type PickListLine = {
  id?: string;
  productNumber: string;
  quantity: number;
  pickedQuantity?: number;
  orderNumber?: string | null;
  stockQuantity?: number;
  stockReserved?: number;
  stockAvailable?: number;
  stockStatus?: "ok" | "short" | "out";
};

type PickListRow = {
  id: string;
  status: string;
  warehouseId?: string | null;
  orderRefs?: Array<{ orderId?: string; orderNumber?: string }>;
  createdAt?: string;
  lines?: PickListLine[];
};

function listProgress(lines: PickListLine[] | undefined) {
  const list = lines || [];
  let picked = 0;
  let qty = 0;
  let stockIssues = 0;
  for (const l of list) {
    picked += l.pickedQuantity ?? 0;
    qty += l.quantity;
    if ((l.stockStatus ?? "out") !== "ok") stockIssues += 1;
  }
  return { picked, qty, stockIssues };
}

function MobilePickingList({
  pickLists,
  warehouseById,
}: {
  pickLists: PickListRow[];
  warehouseById: Map<string, string>;
}) {
  const { t } = useTranslation();
  const openLists = pickLists.filter((p) => p.status === "open");

  if (openLists.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-12 px-4">
        {t("erp.mobilePicking.empty")}
      </p>
    );
  }

  return (
    <ul className="divide-y border-t">
      {openLists.map((p) => {
        const { picked, qty, stockIssues } = listProgress(p.lines);
        const orders = (p.orderRefs || [])
          .map((r) => r.orderNumber)
          .filter(Boolean)
          .slice(0, 4)
          .join(", ");
        const wh =
          (p.warehouseId && warehouseById.get(p.warehouseId)) ||
          p.warehouseId?.slice(0, 8) ||
          "—";
        return (
          <li key={p.id}>
            <Link
              href={`/mobile/picking/${p.id}`}
              className="block px-4 py-4 active:bg-muted/60 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{wh}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {orders || t("erp.mobilePicking.noOrders")}
                  </div>
                  {p.createdAt ? (
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  ) : null}
                  {stockIssues > 0 ? (
                    <div className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t("erp.mobilePicking.stockIssues", { count: stockIssues })}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                      {t("erp.mobilePicking.stockAllOk")}
                    </div>
                  )}
                </div>
                <Badge variant={picked >= qty && qty > 0 ? "default" : "secondary"}>
                  {picked} / {qty}
                </Badge>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MobilePickingDetail({
  pickList,
  warehouseLabel,
}: {
  pickList: PickListRow;
  warehouseLabel: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const scanBusyRef = useRef(false);
  const lines = pickList.lines || [];
  const productNumbers = useMemo(
    () => lines.map((l) => l.productNumber).filter(Boolean),
    [lines],
  );
  const { getLabel } = useErpProductLabels(productNumbers);
  const { picked, qty } = listProgress(lines);
  const hasUnderpick = lines.some((l) => (l.pickedQuantity ?? 0) < l.quantity);

  const scanPickLine = useMutation({
    mutationFn: async (args: { productNumber: string; delta?: 1 | -1 }) => {
      const res = await apiRequest("POST", `/api/erp/pick-lists/${pickList.id}/scan`, {
        productNumber: args.productNumber,
        delta: args.delta ?? 1,
      });
      return res.json() as Promise<{ line: PickListLine; completedLine: boolean }>;
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      const pn = data.line.productNumber;
      const p = data.line.pickedQuantity ?? 0;
      const q = data.line.quantity;
      if (vars.delta === -1) {
        toast({ title: t("erp.mobilePicking.decremented", { productNumber: pn, picked: p, qty: q }) });
        return;
      }
      try {
        navigator.vibrate?.(40);
      } catch {
        // ignore
      }
      toast({
        title: data.completedLine
          ? t("barcodeScan.pickListLineDone", { productNumber: pn, picked: p, qty: q })
          : t("barcodeScan.pickListIncremented", { productNumber: pn, picked: p, qty: q }),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const completePick = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/erp/pick-lists/${pickList.id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      toast({ title: t("erp.mobilePicking.completed") });
      setLocation("/mobile/picking");
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const createLabels = useMutation({
    mutationFn: async () => {
      const refs = (pickList.orderRefs || []).filter((r) => r.orderId);
      if (refs.length === 0) {
        throw new Error(t("erp.mobilePicking.createLabelsNone"));
      }
      const results: Array<{ orderNumber?: string; labelId?: string; error?: string }> = [];
      for (const ref of refs) {
        try {
          const res = await apiRequest("POST", "/api/erp/shipping-labels", {
            shopwareOrderId: ref.orderId,
            packageWeight: 1,
          });
          const data = (await res.json()) as { label?: { id?: string } };
          const labelId = data.label?.id;
          results.push({ orderNumber: ref.orderNumber, labelId });
          if (labelId) {
            try {
              await printShippingLabelPdf(labelId);
            } catch (printErr) {
              // Zebra oft nur am Lager-PC; PDF als Fallback
              if (!(printErr instanceof BrowserPrintUnavailableError)) {
                console.warn("Zebra print:", printErr);
              }
              window.open(`/api/erp/shipping-labels/${labelId}/pdf`, "_blank");
            }
          }
        } catch (e: any) {
          results.push({
            orderNumber: ref.orderNumber,
            error: e?.message || String(e),
          });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/shipping-labels"] });
      const ok = results.filter((r) => r.labelId).length;
      const fail = results.filter((r) => r.error).length;
      if (fail === 0) {
        toast({ title: t("erp.mobilePicking.createLabelsOk", { count: ok }) });
      } else {
        toast({
          title: t("erp.mobilePicking.createLabelsPartial", { ok, fail }),
          description: results
            .filter((r) => r.error)
            .map((r) => `${r.orderNumber || "?"}: ${r.error}`)
            .join("; ")
            .slice(0, 280),
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  async function runDelta(productNumber: string, delta: 1 | -1) {
    if (scanBusyRef.current) return;
    const pn = normalizeScanCode(productNumber) || productNumber.trim();
    if (!pn) return;
    scanBusyRef.current = true;
    try {
      await scanPickLine.mutateAsync({ productNumber: pn, delta });
    } catch {
      // toast via mutation
    } finally {
      scanBusyRef.current = false;
    }
  }

  async function handleScan(code: string) {
    await runDelta(code, 1);
  }

  function handleComplete() {
    if (hasUnderpick) {
      const ok = window.confirm(t("erp.mobilePicking.confirmUnderpick"));
      if (!ok) return;
    }
    completePick.mutate();
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="shrink-0 border-b bg-background">
        <BarcodeLiveScanner active={pickList.status === "open"} onScan={handleScan} />
      </div>

      <div className="px-4 py-2 flex items-center justify-between gap-2 border-b bg-muted/30">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{warehouseLabel}</div>
          <div className="text-xs text-muted-foreground">
            {t("erp.mobilePicking.progress", { picked, qty })}
          </div>
        </div>
        <Badge variant={picked >= qty && qty > 0 ? "default" : "outline"}>
          {picked}/{qty}
        </Badge>
      </div>

      <ul className="flex-1 overflow-y-auto divide-y pb-36">
        {lines.map((line) => {
          const p = line.pickedQuantity ?? 0;
          const done = p >= line.quantity && line.quantity > 0;
          const label = getLabel(line.productNumber);
          const displayName = label.name || label.label || null;
          return (
            <li
              key={line.id || `${line.productNumber}-${line.orderNumber || ""}`}
              className={`px-3 py-3 ${done ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-semibold flex items-center gap-1.5">
                    {done ? <Check className="h-4 w-4 text-emerald-600 shrink-0" /> : null}
                    <span className="truncate">{line.productNumber}</span>
                  </div>
                  {displayName ? (
                    <div className="text-sm text-muted-foreground truncate">{displayName}</div>
                  ) : null}
                  {line.orderNumber ? (
                    <div className="text-xs text-muted-foreground">{line.orderNumber}</div>
                  ) : null}
                  {(() => {
                    const status = line.stockStatus ?? "out";
                    const avail = line.stockAvailable ?? 0;
                    const need = line.quantity;
                    if (status === "ok") {
                      return (
                        <div className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                          {t("erp.mobilePicking.stockOk", { available: avail, need })}
                        </div>
                      );
                    }
                    if (status === "short") {
                      return (
                        <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {t("erp.mobilePicking.stockShort", { available: avail, need })}
                        </div>
                      );
                    }
                    return (
                      <div className="text-xs text-destructive mt-0.5 flex items-center gap-1">
                        <PackageX className="h-3.5 w-3.5 shrink-0" />
                        {t("erp.mobilePicking.stockOut", { need })}
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11"
                    disabled={p <= 0 || scanPickLine.isPending}
                    onClick={() => void runDelta(line.productNumber, -1)}
                    aria-label={t("erp.mobilePicking.decrement")}
                  >
                    <Minus className="h-5 w-5" />
                  </Button>
                  <span className="tabular-nums text-base font-semibold w-14 text-center">
                    {p}/{line.quantity}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-11 w-11"
                    disabled={done || scanPickLine.isPending}
                    onClick={() => void runDelta(line.productNumber, 1)}
                    aria-label={t("erp.mobilePicking.increment")}
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
          {t("erp.mobilePicking.printZebraHint")}
        </p>
        <div className="flex gap-2">
          <Button
            className="flex-1 h-12 text-base"
            variant="secondary"
            disabled={
              createLabels.isPending ||
              pickList.status !== "open" ||
              !(pickList.orderRefs || []).some((r) => r.orderId)
            }
            onClick={() => createLabels.mutate()}
          >
            <Printer className="h-4 w-4 mr-1.5" />
            {t("erp.mobilePicking.createLabels")}
          </Button>
          <Button
            className="flex-1 h-12 text-base"
            disabled={completePick.isPending || pickList.status !== "open"}
            onClick={handleComplete}
          >
            {t("erp.mobilePicking.complete")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MobilePickingPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/mobile/picking/:id");
  const pickListId = params?.id;

  const { data: pickData, isLoading } = useQuery<{ pickLists: PickListRow[] }>({
    queryKey: ["/api/erp/pick-lists"],
  });
  const pickLists = pickData?.pickLists ?? [];

  const { data: whData } = useQuery<{ warehouses: Array<{ id: string; code?: string; name?: string }> }>({
    queryKey: ["/api/erp/warehouses"],
  });
  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of whData?.warehouses || []) {
      map.set(w.id, w.code || w.name || w.id);
    }
    return map;
  }, [whData]);

  const activeList = pickListId ? pickLists.find((p) => p.id === pickListId) : undefined;

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-3 bg-background">
        {pickListId ? (
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" asChild>
            <Link href="/mobile/picking" aria-label={t("erp.mobilePicking.backToList")}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        ) : (
          <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold truncate">
            {pickListId ? t("erp.mobilePicking.detailTitle") : t("erp.mobilePicking.title")}
          </h1>
          {!pickListId ? (
            <p className="text-xs text-muted-foreground truncate">
              {t("erp.mobilePicking.subtitle")}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/shipping-ops">{t("erp.mobilePicking.toDesktop")}</Link>
        </Button>
      </header>

      {isLoading ? (
        <p className="p-4 text-muted-foreground">{t("common.loading")}</p>
      ) : pickListId ? (
        activeList ? (
          <MobilePickingDetail
            pickList={activeList}
            warehouseLabel={
              (activeList.warehouseId && warehouseById.get(activeList.warehouseId)) ||
              activeList.warehouseId?.slice(0, 8) ||
              "—"
            }
          />
        ) : (
          <div className="p-4 space-y-3">
            <p className="text-destructive">{t("erp.mobilePicking.notFound")}</p>
            <Button asChild variant="outline">
              <Link href="/mobile/picking">{t("erp.mobilePicking.backToList")}</Link>
            </Button>
          </div>
        )
      ) : (
        <MobilePickingList pickLists={pickLists} warehouseById={warehouseById} />
      )}
    </div>
  );
}
