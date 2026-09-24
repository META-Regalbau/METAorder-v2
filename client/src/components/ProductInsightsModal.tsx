/**
 * Produkt-Modal der Produkt-Übersicht: bündelt alles, was METAorder zu einem Artikel weiß —
 * Stammdaten, Preise inkl. Historie, Lagerbestände je Lagerplatz, Zuordnungen und Rohdaten.
 * Jeder Tab lädt seine Daten erst beim Öffnen (siehe `enabled`), damit das Modal sofort steht.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Boxes, Layers, Package, Printer, Store, Tag, Tags as TagIcon, Warehouse } from "lucide-react";
import type { CrossSellingGroup, Product, Role, User } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import HerstellMarginIndicator from "@/components/HerstellMarginIndicator";
import Product3DPreview from "@/components/Product3DPreview";
import {
  computeMarginOnRevenuePercent,
  computeMarginPercent,
  computeVerdict,
} from "@/lib/profitabilityAnalysis";
import {
  currencyFormatter,
  dateTimeFormatter,
  formatCustomFieldDisplay,
  formatCustomFieldValue,
  formatDeliveryTimeLabel,
  formatRestockTimeLabel,
  formatVisibilityLabel,
  isPrintableSku,
  type OverviewProduct,
  type PriceHistoryEntry,
} from "@/lib/productOverview";

export type ProductInsightsTab = "master" | "prices" | "stock" | "assignments" | "raw";

interface PricingDetailsResponse {
  listPriceNet: number | null;
  maxDiscountPercent: number | null;
  advancedPrices: Array<{
    quantityStart: number;
    quantityEnd: number | null;
    net: number | null;
    gross: number | null;
    ruleName?: string | null;
    discountPercent: number | null;
  }>;
}

interface DataQualityResponse {
  score: number;
  criteriaCount: number;
  missingFields: string[];
}

interface StockRow {
  id: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  quantity: number;
  reservedQuantity: number;
  minQuantity: number;
  reorderPoint: number;
}

interface MovementRow {
  id: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationCode: string | null;
  quantity: number;
  movementType: string;
  referenceType: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface BundleRow {
  id: string;
  name: string;
  mockProductNumber?: string | null;
  active?: number;
  items: Array<{ productNumber: string; quantity: number; productName?: string }>;
}

interface ProductInsightsModalProps {
  product: OverviewProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab, mit dem das Modal geöffnet wird (z. B. „Preise“ beim Klick auf die Staffelpreise). */
  initialTab?: ProductInsightsTab;
  /** Mindest-Deckungsbeitrag aus den CRM-Einstellungen — Schwelle der Margen-Ampel. */
  minMarginPercent?: number;
  onPrintLabel?: () => void;
}

export default function ProductInsightsModal({
  product,
  open,
  onOpenChange,
  initialTab = "master",
  minMarginPercent,
  onPrintLabel,
}: ProductInsightsModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ProductInsightsTab>(initialTab);

  // Beim Öffnen (und bei Produktwechsel) auf den gewünschten Tab springen.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab, product?.id]);

  const { data: userData } = useQuery<{ user: User & { permissions?: Role["permissions"] } }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });
  const isAdmin = userData?.user?.role === "admin";
  const canManageProducts = isAdmin || Boolean(userData?.user?.permissions?.manageProducts);
  const canViewInventory = isAdmin || Boolean(userData?.user?.permissions?.viewInventory);
  const canViewCrossSelling =
    isAdmin || Boolean(userData?.user?.permissions?.manageCrossSellingGroups);

  const productId = product?.id;
  const productNumber = product?.productNumber;

  const { data: detailData, isLoading: detailLoading } = useQuery<{ product: Product }>({
    queryKey: ["/api/products", productId, "detail"],
    enabled: open && Boolean(productId) && (tab === "master" || tab === "assignments"),
  });
  const detail = detailData?.product;

  const { data: dataQuality } = useQuery<DataQualityResponse>({
    queryKey: ["/api/products", productId, "data-quality"],
    enabled: open && Boolean(productId) && tab === "master",
  });

  const { data: pricing, isLoading: pricingLoading } = useQuery<PricingDetailsResponse>({
    queryKey: ["/api/products", productId, "pricing-details"],
    enabled: open && Boolean(productId) && tab === "prices",
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<{ history: PriceHistoryEntry[] }>({
    queryKey: ["/api/products", productId, "price-history"],
    enabled: open && Boolean(productId) && tab === "prices",
  });

  const { data: stockData, isLoading: stockLoading } = useQuery<{
    stock: StockRow[];
    movements: MovementRow[];
  }>({
    queryKey: ["/api/erp/stock/by-product", productNumber],
    enabled: open && Boolean(productNumber) && tab === "stock" && canViewInventory,
    queryFn: async () => {
      const res = await fetch(
        `/api/erp/stock/by-product?productNumber=${encodeURIComponent(productNumber!)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: crossSellingData } = useQuery<{ crossSellings: CrossSellingGroup[] }>({
    queryKey: ["/api/products", productId, "cross-selling"],
    enabled: open && Boolean(productId) && tab === "assignments" && canViewCrossSelling,
  });

  const { data: bundlesData } = useQuery<{ bundles: BundleRow[] }>({
    queryKey: ["/api/bundles"],
    enabled: open && tab === "assignments",
  });

  const bundlesWithProduct = useMemo(() => {
    if (!productNumber) return [];
    return (bundlesData?.bundles ?? []).filter((bundle) =>
      bundle.items?.some((item) => item.productNumber === productNumber),
    );
  }, [bundlesData, productNumber]);

  const stockTotals = useMemo(() => {
    const rows = stockData?.stock ?? [];
    return rows.reduce(
      (acc, row) => ({
        quantity: acc.quantity + (row.quantity ?? 0),
        reserved: acc.reserved + (row.reservedQuantity ?? 0),
      }),
      { quantity: 0, reserved: 0 },
    );
  }, [stockData]);

  if (!product) return null;

  const none = t("productOverview.table.none");
  const deliveryTimeLabel = formatDeliveryTimeLabel(product, t);
  const restockTimeLabel = formatRestockTimeLabel(product.restockTime, t);
  const optionLabel = (product.options || []).map((o) => o.option).filter(Boolean).join(" · ");
  const herstellpreisNet = product.herstellpreisNet ?? null;
  const marginOnCost = computeMarginPercent(product.priceNet, herstellpreisNet);
  const marginOnRevenue = computeMarginOnRevenuePercent(product.priceNet, herstellpreisNet);
  const marginVerdict = computeVerdict(marginOnCost, minMarginPercent ?? 0);
  // Solange die Detail-Preise laden, die Staffeln aus der Übersichtszeile zeigen (ohne Rabatt-%).
  const advancedPrices: Array<{
    quantityStart: number;
    quantityEnd: number | null;
    net: number | null;
    gross: number | null;
    ruleName?: string | null;
    discountPercent?: number | null;
  }> = pricing?.advancedPrices ?? product.advancedPrices ?? [];
  const stockDiff =
    stockData && product.stock != null ? stockTotals.quantity - product.stock : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="product-insights-modal">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Package className="h-5 w-5" />
            <span className="font-mono">{product.productNumber}</span>
            <span className="text-muted-foreground">·</span>
            <span>{product.name || none}</span>
            {product.active === true ? (
              <Badge variant="success">{t("productOverview.active")}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t("productOverview.inactive")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3">
            <span>
              {currencyFormatter.format(product.priceGross || 0)} ·{" "}
              {currencyFormatter.format(product.priceNet || 0)} {t("productOverview.net")}
            </span>
            {optionLabel ? <span>{optionLabel}</span> : null}
            {onPrintLabel && isPrintableSku(product) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrintLabel}
                data-testid="product-insights-print"
              >
                <Printer className="h-4 w-4 mr-2" />
                {t("productLabels.printOne")}
              </Button>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as ProductInsightsTab)}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="master" data-testid="product-insights-tab-master">
              {t("productOverview.detail.tabs.master")}
            </TabsTrigger>
            <TabsTrigger value="prices" data-testid="product-insights-tab-prices">
              {t("productOverview.detail.tabs.prices")}
            </TabsTrigger>
            {canViewInventory ? (
              <TabsTrigger value="stock" data-testid="product-insights-tab-stock">
                {t("productOverview.detail.tabs.stock")}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="assignments" data-testid="product-insights-tab-assignments">
              {t("productOverview.detail.tabs.assignments")}
            </TabsTrigger>
            <TabsTrigger value="raw" data-testid="product-insights-tab-raw">
              {t("productOverview.detail.tabs.raw")}
            </TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------------- Stammdaten */}
          <TabsContent value="master" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {t("productOverview.detail.image")}
                </p>
                {detail?.imageUrl ? (
                  <div className="aspect-video bg-muted rounded-md overflow-hidden">
                    <img
                      src={detail.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-muted rounded-md flex items-center justify-center text-sm text-muted-foreground">
                    {detailLoading ? t("common.loading") : none}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {t("productOverview.detail.preview3d")}
                </p>
                <Product3DPreview
                  productNumber={product.productNumber}
                  manufacturerNumber={product.manufacturerNumber}
                  productId={product.id}
                  canManageProducts={canManageProducts}
                />
              </div>
            </div>

            <FieldGrid
              fields={[
                { label: t("productOverview.table.productNumber"), value: product.productNumber, mono: true },
                { label: t("productOverview.table.name"), value: product.name },
                { label: "EAN", value: product.ean, mono: true },
                { label: t("productOverview.csv.manufacturerNumber"), value: product.manufacturerNumber, mono: true },
                { label: t("productOverview.detail.manufacturer"), value: product.manufacturerName },
                { label: t("productOverview.csv.stock"), value: product.stock },
                { label: t("productOverview.table.deliveryTime"), value: deliveryTimeLabel },
                { label: t("productOverview.table.restockTime"), value: restockTimeLabel },
                { label: t("productOverview.csv.taxRate"), value: product.taxRate != null ? `${product.taxRate} %` : null },
                { label: t("productOverview.detail.currency"), value: product.currency },
                { label: t("productOverview.detail.variantOptions"), value: optionLabel },
                {
                  label: t("productOverview.detail.variantCount"),
                  value: product.childCount != null && product.childCount > 0 ? product.childCount : null,
                },
                {
                  label: t("productOverview.detail.createdAt"),
                  value: product.createdAt ? dateTimeFormatter.format(new Date(product.createdAt)) : null,
                },
                {
                  label: t("productOverview.table.lastUpdated"),
                  value: product.updatedAt ? dateTimeFormatter.format(new Date(product.updatedAt)) : null,
                },
              ]}
            />

            {product.inheritedFields && product.inheritedFields.length > 0 ? (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t("productOverview.detail.inheritedFields")}
                </p>
                <div className="flex flex-wrap gap-1">
                  {product.inheritedFields.map((field) => (
                    <Badge key={field} variant="outline">
                      {field}
                    </Badge>
                  ))}
                </div>
              </Card>
            ) : null}

            {detail?.dimensions ? (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">{t("products.dimensions")}</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {detail.dimensions.width ? (
                    <span>
                      {t("products.width")}:{" "}
                      <span className="font-medium">
                        {detail.dimensions.width} {detail.dimensions.unit || "mm"}
                      </span>
                    </span>
                  ) : null}
                  {detail.dimensions.height ? (
                    <span>
                      {t("products.height")}:{" "}
                      <span className="font-medium">
                        {detail.dimensions.height} {detail.dimensions.unit || "mm"}
                      </span>
                    </span>
                  ) : null}
                  {detail.dimensions.length ? (
                    <span>
                      {t("products.depth")}:{" "}
                      <span className="font-medium">
                        {detail.dimensions.length} {detail.dimensions.unit || "mm"}
                      </span>
                    </span>
                  ) : null}
                  {detail.weight ? (
                    <span>
                      {t("erp.weight")}: <span className="font-medium">{detail.weight}</span>
                    </span>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {detail?.description ? (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">{t("products.description")}</p>
                <p className="text-sm whitespace-pre-line">{detail.description}</p>
              </Card>
            ) : null}

            {detail?.variants && detail.variants.length > 0 ? (
              <Card className="p-3">
                <p className="text-xs text-muted-foreground mb-2">{t("products.variants")}</p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("products.variantsTable.productNumber")}</TableHead>
                        <TableHead>{t("products.variantsTable.options")}</TableHead>
                        <TableHead className="text-right">{t("products.variantsTable.net")}</TableHead>
                        <TableHead className="text-right">{t("products.variantsTable.gross")}</TableHead>
                        <TableHead className="text-right">{t("products.variantsTable.stock")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.variants.map((variant) => (
                        <TableRow key={variant.id}>
                          <TableCell className="font-mono text-xs">
                            {variant.productNumber ?? none}
                          </TableCell>
                          <TableCell className="text-xs">
                            {variant.options?.length
                              ? variant.options.map((o) => `${o.group}: ${o.option}`).join("; ")
                              : none}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {currencyFormatter.format(variant.netPrice ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {currencyFormatter.format(variant.price ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">{variant.stock}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            ) : null}

            {dataQuality ? (
              <Card className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{t("products.dataQualityTitle")}</p>
                  <span className="text-sm font-medium">{dataQuality.score}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(100, Math.max(0, dataQuality.score || 0))}%` }}
                  />
                </div>
                {dataQuality.missingFields.length === 0 ? (
                  <p className="text-sm">{t("products.dataQualityComplete")}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {dataQuality.missingFields.map((field) => (
                      <Badge key={field} variant="secondary">
                        {t(`products.dataQualityFields.${field}`, { defaultValue: field })}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}
          </TabsContent>

          {/* -------------------------------------------------------------------- Preise */}
          <TabsContent value="prices" className="space-y-4 pt-4">
            <FieldGrid
              fields={[
                { label: t("productOverview.csv.priceGross"), value: currencyFormatter.format(product.priceGross || 0), mono: true },
                { label: t("productOverview.csv.priceNet"), value: currencyFormatter.format(product.priceNet || 0), mono: true },
                { label: t("productOverview.csv.taxRate"), value: `${product.taxRate} %` },
                {
                  label: t("productOverview.detail.purchasePriceNet"),
                  value: product.purchasePriceNet != null ? currencyFormatter.format(product.purchasePriceNet) : null,
                  mono: true,
                },
                {
                  label: t("productOverview.detail.herstellpreisNet"),
                  value: herstellpreisNet != null ? currencyFormatter.format(herstellpreisNet) : null,
                  mono: true,
                },
                {
                  label: t("productOverview.detail.maxDiscount"),
                  value:
                    pricing?.maxDiscountPercent != null
                      ? `${pricing.maxDiscountPercent.toLocaleString("de-DE")} %`
                      : null,
                },
              ]}
            />

            <Card className="p-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("productOverview.detail.margin")}
                </p>
                {minMarginPercent != null ? (
                  <p className="text-xs text-muted-foreground">
                    {t("productOverview.detail.marginThreshold", {
                      threshold: minMarginPercent.toLocaleString("de-DE"),
                    })}
                  </p>
                ) : null}
              </div>
              <HerstellMarginIndicator
                marginPercent={marginOnCost}
                marginOnRevenuePercent={marginOnRevenue}
                verdict={marginVerdict}
              />
            </Card>

            <Card className="p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4" />
                {t("productOverview.advancedPricesTitle")}
              </p>
              {pricingLoading && advancedPrices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : advancedPrices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{none}</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("productOverview.modal.quantity")}</TableHead>
                        <TableHead>{t("productOverview.modal.priceRule")}</TableHead>
                        <TableHead className="text-right">{t("productOverview.csv.priceGross")}</TableHead>
                        <TableHead className="text-right">{t("productOverview.csv.priceNet")}</TableHead>
                        <TableHead className="text-right">{t("products.discountPercent")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {advancedPrices.map((tier, index) => {
                        const discountPercent =
                          "discountPercent" in tier && tier.discountPercent != null
                            ? tier.discountPercent
                            : null;
                        return (
                          <TableRow key={index}>
                            <TableCell>
                              {t("productOverview.fromQuantity", { qty: tier.quantityStart })}
                              {tier.quantityEnd ? `–${tier.quantityEnd}` : ""}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {tier.ruleName || none}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {tier.gross != null ? currencyFormatter.format(tier.gross) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {tier.net != null ? currencyFormatter.format(tier.net) : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {discountPercent != null
                                ? `${discountPercent.toLocaleString("de-DE")} %`
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            <Card className="p-3 space-y-2">
              <p className="text-sm font-semibold">{t("productOverview.priceHistoryTitle")}</p>
              {historyLoading ? (
                <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
              ) : !historyData?.history?.length ? (
                <p className="text-sm text-muted-foreground">{none}</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("productOverview.modal.changedAt")}</TableHead>
                        <TableHead className="text-right">{t("productOverview.modal.oldPrice")}</TableHead>
                        <TableHead className="text-right">{t("productOverview.modal.newPrice")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyData.history.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-sm">
                            {dateTimeFormatter.format(new Date(entry.changedAt))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {entry.oldPriceGross != null
                              ? currencyFormatter.format(entry.oldPriceGross)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {currencyFormatter.format(entry.newPriceGross)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* --------------------------------------------------------------------- Lager */}
          {canViewInventory ? (
            <TabsContent value="stock" className="space-y-4 pt-4">
              <FieldGrid
                fields={[
                  { label: t("productOverview.detail.stockShopware"), value: product.stock },
                  { label: t("productOverview.detail.stockErp"), value: stockData ? stockTotals.quantity : null },
                  { label: t("erp.reserved"), value: stockData ? stockTotals.reserved : null },
                  {
                    label: t("productOverview.detail.stockDiff"),
                    value: stockDiff != null ? stockDiff : null,
                    highlight: stockDiff != null && stockDiff !== 0,
                  },
                ]}
              />

              <Card className="p-3 space-y-2">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <Warehouse className="h-4 w-4" />
                  {t("erp.warehouse.locations")}
                </p>
                {stockLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : !stockData?.stock?.length ? (
                  <p className="text-sm text-muted-foreground">
                    {t("productOverview.detail.noStock")}
                  </p>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("productOverview.detail.warehouse")}</TableHead>
                          <TableHead>{t("erp.warehouse.location")}</TableHead>
                          <TableHead className="text-right">{t("erp.quantity")}</TableHead>
                          <TableHead className="text-right">{t("erp.reserved")}</TableHead>
                          <TableHead className="text-right">{t("productOverview.detail.minQuantity")}</TableHead>
                          <TableHead className="text-right">{t("erp.reorderPoint")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockData.stock.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.warehouseName || row.warehouseCode || none}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.locationCode || none}
                              {row.locationName ? (
                                <span className="ml-2 font-sans text-muted-foreground">
                                  {row.locationName}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right font-mono">{row.quantity}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {row.reservedQuantity}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {row.minQuantity}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {row.reorderPoint}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              <Card className="p-3 space-y-2">
                <p className="text-sm font-semibold">{t("erp.warehouse.movements")}</p>
                {stockLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : !stockData?.movements?.length ? (
                  <p className="text-sm text-muted-foreground">{none}</p>
                ) : (
                  <div className="rounded-md border overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("erp.date")}</TableHead>
                          <TableHead>{t("erp.type")}</TableHead>
                          <TableHead>{t("erp.warehouse.location")}</TableHead>
                          <TableHead className="text-right">{t("erp.quantity")}</TableHead>
                          <TableHead>{t("productOverview.detail.movementReference")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stockData.movements.map((movement) => (
                          <TableRow key={movement.id}>
                            <TableCell className="text-sm">
                              {dateTimeFormatter.format(new Date(movement.createdAt))}
                            </TableCell>
                            <TableCell>{movement.movementType}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {movement.locationCode || none}
                            </TableCell>
                            <TableCell className="text-right font-mono">{movement.quantity}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {[movement.referenceType, movement.note, movement.createdBy]
                                .filter(Boolean)
                                .join(" · ") || none}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </TabsContent>
          ) : null}

          {/* --------------------------------------------------------------- Zuordnungen */}
          <TabsContent value="assignments" className="space-y-4 pt-4">
            <BadgeCard
              title={t("productOverview.table.salesChannels")}
              icon={<Store className="h-3 w-3" />}
              items={product.salesChannels.map(
                (channel) => `${channel.name} — ${formatVisibilityLabel(channel.visibility ?? null, t)}`,
              )}
              emptyLabel={none}
            />
            <BadgeCard
              title={t("productOverview.table.categories")}
              icon={<Tag className="h-3 w-3" />}
              items={product.categories}
              emptyLabel={none}
            />
            <BadgeCard
              title={t("productOverview.table.tags")}
              icon={<TagIcon className="h-3 w-3" />}
              items={product.tags ?? []}
              emptyLabel={none}
            />
            <BadgeCard
              title={t("productOverview.detail.properties")}
              items={(detail?.properties ?? []).map(
                (property) => `${property.groupName}: ${property.optionName}`,
              )}
              emptyLabel={
                detailLoading
                  ? t("common.loading")
                  : product.propertyCount > 0
                    ? t("productOverview.detail.propertiesCount", { count: product.propertyCount })
                    : none
              }
            />

            <Card className="p-3 space-y-2">
              <p className="text-sm font-semibold">{t("crossSelling.title")}</p>
              {!canViewCrossSelling ? (
                <p className="text-sm text-muted-foreground">
                  {t("productOverview.detail.noPermission")}
                </p>
              ) : !crossSellingData?.crossSellings?.length ? (
                <p className="text-sm text-muted-foreground">{none}</p>
              ) : (
                <div className="space-y-3">
                  {crossSellingData.crossSellings.map((group) => (
                    <div key={group.id}>
                      <p className="text-sm font-medium">
                        {group.name}{" "}
                        <span className="text-xs text-muted-foreground">
                          ({group.products?.length ?? 0})
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(group.products ?? []).map((item) => (
                          <Badge key={item.id} variant="secondary" className="font-mono text-xs">
                            {item.productNumber}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-3 space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Boxes className="h-4 w-4" />
                {t("productOverview.detail.bundles")}
              </p>
              {bundlesWithProduct.length === 0 ? (
                <p className="text-sm text-muted-foreground">{none}</p>
              ) : (
                <div className="space-y-1">
                  {bundlesWithProduct.map((bundle) => {
                    const item = bundle.items.find((row) => row.productNumber === productNumber);
                    return (
                      <div key={bundle.id} className="text-sm flex flex-wrap items-center gap-2">
                        <span className="font-medium">{bundle.name}</span>
                        {bundle.mockProductNumber ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {bundle.mockProductNumber}
                          </span>
                        ) : null}
                        {item ? (
                          <Badge variant="outline">
                            {t("productOverview.detail.bundleQuantity", { count: item.quantity })}
                          </Badge>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </TabsContent>

          {/* ------------------------------------------------------------------ Rohdaten */}
          <TabsContent value="raw" className="space-y-4 pt-4">
            <Card className="p-3 space-y-2">
              <p className="text-sm font-semibold">{t("productOverview.customFieldsTitle")}</p>
              {product.customFieldKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">{none}</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("productOverview.modal.field")}</TableHead>
                        <TableHead>{t("productOverview.modal.value")}</TableHead>
                        <TableHead>{t("productOverview.detail.rawValue")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {product.customFieldKeys.map((key) => {
                        const display = formatCustomFieldDisplay(product, key);
                        const raw = formatCustomFieldValue(product.customFields?.[key]);
                        return (
                          <TableRow key={key}>
                            <TableCell className="font-mono text-xs align-top">{key}</TableCell>
                            <TableCell className="break-all">{display || "—"}</TableCell>
                            <TableCell className="break-all font-mono text-xs text-muted-foreground">
                              {display === raw ? "—" : raw || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>

            <Separator />

            <FieldGrid
              fields={[
                { label: t("productOverview.detail.shopwareId"), value: product.id, mono: true },
                { label: t("productOverview.detail.parentId"), value: product.parentId, mono: true },
                { label: t("productOverview.detail.deliveryTimeId"), value: product.deliveryTimeId, mono: true },
                {
                  label: t("productOverview.table.priceChangedAt"),
                  value: product.lastPriceChangeAt
                    ? dateTimeFormatter.format(new Date(product.lastPriceChangeAt))
                    : null,
                },
              ]}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FieldGrid({
  fields,
}: {
  fields: Array<{
    label: string;
    value: string | number | null | undefined;
    mono?: boolean;
    highlight?: boolean;
  }>;
}) {
  const { t } = useTranslation();
  const none = t("productOverview.table.none");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {fields.map((field) => (
        <Card key={field.label} className="p-3">
          <p className="text-xs text-muted-foreground">{field.label}</p>
          <p
            className={[
              "text-sm font-medium break-words",
              field.mono ? "font-mono" : "",
              field.highlight ? "text-destructive" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {field.value == null || field.value === "" ? none : field.value}
          </p>
        </Card>
      ))}
    </div>
  );
}

function BadgeCard({
  title,
  items,
  icon,
  emptyLabel,
}: {
  title: string;
  items: string[];
  icon?: ReactNode;
  emptyLabel: string;
}) {
  return (
    <Card className="p-3 space-y-2">
      <p className="text-sm font-semibold">
        {title}{" "}
        {items.length > 0 ? (
          <span className="text-xs text-muted-foreground">({items.length})</span>
        ) : null}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => (
            <Badge key={item} variant="secondary" className="gap-1">
              {icon}
              {item}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
