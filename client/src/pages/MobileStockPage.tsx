import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  MapPin,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BarcodeLiveScanner } from "@/components/BarcodeLiveScanner";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";
import type { ErpProductLabel } from "@shared/productVariantLabel";

type ErpWarehouse = { id: string; code: string; name: string; isDefault: boolean; active: boolean };

type ScanLocation = {
  id: string;
  warehouseId: string;
  code: string;
  name?: string | null;
  shelfTypeId?: string | null;
};

type ScanResult =
  | { kind: "location"; location: ScanLocation; shelfType?: { code: string; name: string } | null }
  | {
      kind: "product";
      product: ErpProductLabel;
      stock: {
        quantity: number;
        reservedQuantity: number;
        locationId: string | null;
        warehouseId: string;
      } | null;
    }
  | { kind: "unknown"; code: string };

type Booking = { movementType: "receipt" | "issue"; quantity: number };

export default function MobileStockPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const scanBusyRef = useRef(false);

  const [warehouseId, setWarehouseId] = useState("");
  const [product, setProduct] = useState<ErpProductLabel | null>(null);
  const [productStock, setProductStock] = useState<{
    quantity: number;
    reservedQuantity: number;
  } | null>(null);
  const [location, setLocation] = useState<ScanLocation | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lastBooking, setLastBooking] = useState<{ type: "receipt" | "issue"; qty: number } | null>(
    null,
  );

  const { data: whData } = useQuery<{ warehouses: ErpWarehouse[] }>({
    queryKey: ["/api/erp/warehouses"],
  });
  const warehouses = useMemo(() => whData?.warehouses ?? [], [whData]);

  useEffect(() => {
    if (warehouseId || warehouses.length === 0) return;
    setWarehouseId(warehouses.find((w) => w.isDefault)?.id || warehouses[0].id);
  }, [warehouses, warehouseId]);

  const warehouse = warehouses.find((w) => w.id === warehouseId) || null;

  /** Aktuellen Bestand des gewählten Artikels im gewählten Lager nachladen. */
  const refreshStock = async (productNumber: string) => {
    try {
      const res = await apiRequest(
        "GET",
        `/api/erp/stock?warehouseId=${encodeURIComponent(warehouseId)}&productNumber=${encodeURIComponent(productNumber)}`,
      );
      const data = (await res.json()) as {
        stock: Array<{ quantity: number; reservedQuantity: number }>;
      };
      const row = data.stock?.[0];
      setProductStock(
        row
          ? {
              quantity: Number(row.quantity || 0),
              reservedQuantity: Number(row.reservedQuantity || 0),
            }
          : { quantity: 0, reservedQuantity: 0 },
      );
    } catch {
      // Bestand ist nur Anzeige — ein Fehler darf die Buchung nicht blockieren
      setProductStock(null);
    }
  };

  const resolveScan = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest(
        "GET",
        `/api/erp/scan/resolve?code=${encodeURIComponent(code)}&warehouseId=${encodeURIComponent(warehouseId)}`,
      );
      return (await res.json()) as ScanResult;
    },
  });

  const book = useMutation({
    mutationFn: async (args: Booking) => {
      if (!product) throw new Error(t("erp.mobileStock.needProduct"));
      if (!warehouseId) throw new Error(t("erp.mobileStock.needWarehouse"));
      const res = await apiRequest("POST", "/api/erp/stock/movements", {
        warehouseId,
        productNumber: product.productNumber,
        locationId: location?.id ?? null,
        quantity: args.quantity,
        movementType: args.movementType,
        note: location ? `Mobile ${location.code}` : "Mobile",
      });
      return (await res.json()) as { stock: { quantity: number; reservedQuantity: number } };
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      setProductStock({
        quantity: Number(data.stock?.quantity || 0),
        reservedQuantity: Number(data.stock?.reservedQuantity || 0),
      });
      setLastBooking({ type: vars.movementType, qty: vars.quantity });
      setQuantity(1);
      try {
        navigator.vibrate?.(40);
      } catch {
        // ignore
      }
      toast({
        title:
          vars.movementType === "receipt"
            ? t("erp.mobileStock.bookedIn", {
                qty: vars.quantity,
                productNumber: product?.productNumber ?? "",
              })
            : t("erp.mobileStock.bookedOut", {
                qty: vars.quantity,
                productNumber: product?.productNumber ?? "",
              }),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  async function handleScan(raw: string) {
    if (scanBusyRef.current || !warehouseId) return;
    const code = normalizeScanCode(raw) || raw.trim();
    if (!code) return;
    scanBusyRef.current = true;
    try {
      const result = await resolveScan.mutateAsync(code);
      if (result.kind === "location") {
        setLocation(result.location);
        toast({ title: t("erp.mobileStock.locationSet", { code: result.location.code }) });
      } else if (result.kind === "product") {
        setProduct(result.product);
        setLastBooking(null);
        setProductStock(
          result.stock
            ? {
                quantity: result.stock.quantity,
                reservedQuantity: result.stock.reservedQuantity,
              }
            : { quantity: 0, reservedQuantity: 0 },
        );
        toast({
          title: t("erp.mobileStock.productSet", { productNumber: result.product.productNumber }),
        });
        void refreshStock(result.product.productNumber);
      } else {
        toast({
          title: t("erp.mobileStock.unknownCode", { code: result.code }),
          variant: "destructive",
        });
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

  function resetAll() {
    setProduct(null);
    setProductStock(null);
    setLocation(null);
    setQuantity(1);
    setLastBooking(null);
  }

  const available = productStock
    ? Math.max(0, productStock.quantity - productStock.reservedQuantity)
    : null;
  const issueExceedsStock =
    productStock != null && quantity > Math.max(0, productStock.quantity);

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-3 bg-background">
        <WarehouseIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold truncate">{t("erp.mobileStock.title")}</h1>
          <p className="text-xs text-muted-foreground truncate">{t("erp.mobileStock.subtitle")}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href="/warehouse">{t("erp.mobileStock.toDesktop")}</Link>
        </Button>
      </header>

      <div className="shrink-0 border-b bg-background">
        <BarcodeLiveScanner active={Boolean(warehouseId)} onScan={(c) => void handleScan(c)} />
      </div>

      <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2">
        <label className="text-xs text-muted-foreground shrink-0">
          {t("erp.warehouse.selectWarehouse")}
        </label>
        <select
          className="flex-1 border rounded-md h-10 px-2 bg-background text-sm"
          value={warehouseId}
          onChange={(e) => {
            setWarehouseId(e.target.value);
            resetAll();
          }}
          data-testid="mobile-stock-warehouse"
        >
          {warehouses.length === 0 ? <option value="">—</option> : null}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 pb-44">
        {/* Schritt 1: Artikel */}
        <section
          className={`rounded-lg border p-3 ${product ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}
          data-testid="mobile-stock-product"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {product ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Package className="h-4 w-4" />
            )}
            {t("erp.mobileStock.step1")}
          </div>
          {product ? (
            <div className="mt-2">
              <div className="font-mono text-base font-semibold break-all">
                {product.productNumber}
              </div>
              {product.name ? <div className="text-sm">{product.name}</div> : null}
              {product.optionsLabel ? (
                <div className="text-xs text-muted-foreground">{product.optionsLabel}</div>
              ) : null}
              {productStock ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">
                    {t("erp.mobileStock.stockNow", { qty: productStock.quantity })}
                  </Badge>
                  {productStock.reservedQuantity > 0 ? (
                    <Badge variant="warning">
                      {t("erp.mobileStock.reserved", { qty: productStock.reservedQuantity })}
                    </Badge>
                  ) : null}
                  {available != null ? (
                    <span className="text-xs text-muted-foreground">
                      {t("erp.mobileStock.available", { qty: available })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t("erp.mobileStock.step1Hint")}</p>
          )}
        </section>

        {/* Schritt 2: Lagerplatz */}
        <section
          className={`rounded-lg border p-3 ${location ? "bg-emerald-50 dark:bg-emerald-950/30" : ""}`}
          data-testid="mobile-stock-location"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {location ? <Check className="h-4 w-4 text-emerald-600" /> : <MapPin className="h-4 w-4" />}
            {t("erp.mobileStock.step2")}
          </div>
          {location ? (
            <div className="mt-2">
              <div className="font-mono text-base font-semibold">{location.code}</div>
              {location.name ? <div className="text-sm">{location.name}</div> : null}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t("erp.mobileStock.step2Hint")}</p>
          )}
        </section>

        {/* Schritt 3: Menge */}
        <section className="rounded-lg border p-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("erp.mobileStock.step3")}
          </div>
          <div className="mt-2 flex items-center justify-center gap-3">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-14 w-14"
              disabled={quantity <= 1}
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label={t("erp.mobileStock.decrement")}
            >
              <Minus className="h-6 w-6" />
            </Button>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={99999}
              value={quantity}
              onChange={(e) => {
                const n = Number(e.target.value);
                setQuantity(Number.isFinite(n) ? Math.max(1, Math.min(99999, Math.floor(n))) : 1);
              }}
              className="h-14 w-24 text-center text-2xl font-semibold tabular-nums border rounded-md bg-background"
              data-testid="mobile-stock-quantity"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-14 w-14"
              onClick={() => setQuantity((q) => Math.min(99999, q + 1))}
              aria-label={t("erp.mobileStock.increment")}
            >
              <Plus className="h-6 w-6" />
            </Button>
          </div>
          {issueExceedsStock ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 text-center">
              {t("erp.mobileStock.negativeWarning", { qty: productStock?.quantity ?? 0 })}
            </p>
          ) : null}
        </section>

        {lastBooking ? (
          <p className="text-center text-sm text-emerald-700 dark:text-emerald-400">
            {lastBooking.type === "receipt"
              ? t("erp.mobileStock.lastIn", { qty: lastBooking.qty })
              : t("erp.mobileStock.lastOut", { qty: lastBooking.qty })}
          </p>
        ) : null}

        {product || location ? (
          <Button type="button" variant="ghost" className="w-full h-11" onClick={resetAll}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("erp.mobileStock.reset")}
          </Button>
        ) : null}
      </div>

      <div className="fixed bottom-0 inset-x-0 p-3 border-t bg-background/95 backdrop-blur safe-pb space-y-2">
        {!location ? (
          <p className="text-[11px] text-muted-foreground text-center">
            {t("erp.mobileStock.noLocationHint")}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            className="flex-1 h-14 text-base"
            variant="secondary"
            disabled={!product || book.isPending}
            onClick={() => book.mutate({ movementType: "issue", quantity })}
            data-testid="mobile-stock-issue"
          >
            <ArrowUpFromLine className="h-5 w-5 mr-2" />
            {t("erp.mobileStock.bookOut")}
          </Button>
          <Button
            className="flex-1 h-14 text-base"
            disabled={!product || book.isPending}
            onClick={() => book.mutate({ movementType: "receipt", quantity })}
            data-testid="mobile-stock-receipt"
          >
            <ArrowDownToLine className="h-5 w-5 mr-2" />
            {t("erp.mobileStock.bookIn")}
          </Button>
        </div>
      </div>
    </div>
  );
}
