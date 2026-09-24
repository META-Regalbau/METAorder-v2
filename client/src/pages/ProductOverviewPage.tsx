import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Search,
  Download,
  RefreshCw,
  Tag,
  Tags as TagIcon,
  Layers,
  Store,
  AlertCircle,
  X,
  Printer,
  ScanLine,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  PrintArticleLabelDialog,
  type PrintableArticle,
} from "@/components/PrintArticleLabelDialog";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import ProductInsightsModal, {
  type ProductInsightsTab,
} from "@/components/ProductInsightsModal";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";
import {
  currencyFormatter,
  dateTimeFormatter,
  formatCustomFieldDisplay,
  formatDeliveryTimeLabel,
  formatRestockTimeLabel,
  formatVisibilityLabel,
  getChannelVisibility,
  isPrintableSku,
  VISIBILITY_LEVELS,
  type OverviewProduct,
  type OverviewResponse,
} from "@/lib/productOverview";
import { useToast } from "@/hooks/use-toast";
import { extractSizeColor } from "@shared/productVariantLabel";

const PAGE_SIZE = 50;
const NONE_CHANNEL = "__none__";
const NONE_DELIVERY_TIME = "__none_delivery__";
const NONE_RESTOCK_TIME = "__none_restock__";
const ALL = "__all__";

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toPrintableArticle(product: OverviewProduct): PrintableArticle {
  const { size, color, baseName } = extractSizeColor(product.options, null, product.name);
  return {
    productNumber: product.productNumber,
    name: baseName || product.name || null,
    size,
    color,
  };
}

export default function ProductOverviewPage() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<OverviewResponse>({
    queryKey: ["/api/products/overview"],
  });

  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>(ALL);
  const [visibilityFilter, setVisibilityFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [onlyAdvancedPrices, setOnlyAdvancedPrices] = useState(false);
  const [onlyCustomFields, setOnlyCustomFields] = useState(false);
  const [customFieldKey, setCustomFieldKey] = useState<string>(ALL);
  const [customFieldPresence, setCustomFieldPresence] = useState<"any" | "present" | "absent">("any");
  const [customFieldValue, setCustomFieldValue] = useState("");
  const [deliveryTimeFilter, setDeliveryTimeFilter] = useState<string>(ALL);
  const [restockTimeFilter, setRestockTimeFilter] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [labelProducts, setLabelProducts] = useState<PrintableArticle[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<OverviewProduct | null>(null);
  const [detailTab, setDetailTab] = useState<ProductInsightsTab>("master");

  const products = useMemo(() => data?.products ?? [], [data]);
  const salesChannels = useMemo(() => data?.salesChannels ?? [], [data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const c of p.categories) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const tg of p.tags ?? []) set.add(tg);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const customFieldKeyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const k of p.customFieldKeys) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const deliveryTimeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const p of products) {
      if (!p.deliveryTimeId) continue;
      const label = formatDeliveryTimeLabel(p, t);
      const existing = byId.get(p.deliveryTimeId);
      if (label) {
        // Namen bevorzugen; ID-Fallback nicht über echten Namen schreiben
        if (!existing || existing === p.deliveryTimeId) {
          byId.set(p.deliveryTimeId, label);
        }
      } else if (!existing) {
        byId.set(p.deliveryTimeId, p.deliveryTimeId);
      }
    }
    return Array.from(byId.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [products, t]);

  const restockTimeOptions = useMemo(() => {
    const values = new Set<number>();
    for (const p of products) {
      if (p.restockTime != null) values.add(p.restockTime);
    }
    return Array.from(values)
      .sort((a, b) => a - b)
      .map((value) => ({
        value: String(value),
        label: formatRestockTimeLabel(value, t) ?? String(value),
      }));
  }, [products, t]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (term) {
        const deliveryLabel = formatDeliveryTimeLabel(p, t) ?? "";
        const restockLabel = formatRestockTimeLabel(p.restockTime, t) ?? "";
        const options = (p.options || []).map((o) => o.option).join(" ");
        const haystack =
          `${p.productNumber} ${p.name} ${options} ${p.ean ?? ""} ${p.manufacturerNumber ?? ""} ${(p.categories || []).join(" ")} ${(p.tags || []).join(" ")} ${deliveryLabel} ${restockLabel} ${p.restockTime ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      // Kanal- und Sichtbarkeitsfilter greifen ineinander:
      // konkreter Kanal + Stufe = Stufe genau in diesem Kanal (0 = dort nicht zugewiesen),
      // "Alle Kanäle" + Stufe = mindestens ein Kanal mit dieser Stufe (0 = gar kein Kanal).
      const wantedVisibility = visibilityFilter === ALL ? null : Number(visibilityFilter);
      if (channelFilter === NONE_CHANNEL) {
        if (p.salesChannelIds.length > 0) return false;
      } else if (channelFilter !== ALL) {
        if (wantedVisibility == null) {
          if (!p.salesChannelIds.includes(channelFilter)) return false;
        } else if (getChannelVisibility(p, channelFilter) !== wantedVisibility) {
          return false;
        }
      } else if (wantedVisibility != null) {
        if (wantedVisibility === 0) {
          if (p.salesChannels.length > 0) return false;
        } else if (!p.salesChannels.some((c) => (c.visibility ?? null) === wantedVisibility)) {
          return false;
        }
      }
      if (categoryFilter !== ALL && !p.categories.includes(categoryFilter)) return false;
      if (tagFilter !== ALL && !(p.tags ?? []).includes(tagFilter)) return false;
      if (statusFilter === "active" && p.active !== true) return false;
      if (statusFilter === "inactive" && p.active === true) return false;
      if (deliveryTimeFilter === NONE_DELIVERY_TIME) {
        if (p.hasDeliveryTime) return false;
      } else if (deliveryTimeFilter !== ALL) {
        if (p.deliveryTimeId !== deliveryTimeFilter) return false;
      }
      if (restockTimeFilter === NONE_RESTOCK_TIME) {
        if (p.restockTime != null) return false;
      } else if (restockTimeFilter !== ALL) {
        if (p.restockTime == null || String(p.restockTime) !== restockTimeFilter) return false;
      }
      if (onlyAdvancedPrices && !p.hasAdvancedPrices) return false;
      if (onlyCustomFields && p.customFieldKeys.length === 0) return false;

      const cfValueTerm = customFieldValue.trim().toLowerCase();
      if (customFieldKey !== ALL) {
        const hasKey = p.customFieldKeys.includes(customFieldKey);
        if (customFieldPresence === "absent") {
          if (hasKey) return false;
        } else {
          // "present" oder "any" mit konkretem Key: Feld muss gesetzt sein
          if (!hasKey) return false;
          if (cfValueTerm) {
            const val = formatCustomFieldDisplay(p, customFieldKey).toLowerCase();
            if (!val.includes(cfValueTerm)) return false;
          }
        }
      } else {
        // Kein konkreter Key gewählt
        if (customFieldPresence === "present" && p.customFieldKeys.length === 0) return false;
        if (customFieldPresence === "absent" && p.customFieldKeys.length > 0) return false;
        if (cfValueTerm && customFieldPresence !== "absent") {
          const matches = p.customFieldKeys.some((k) =>
            formatCustomFieldDisplay(p, k).toLowerCase().includes(cfValueTerm),
          );
          if (!matches) return false;
        }
      }
      return true;
    });
  }, [
    products,
    search,
    channelFilter,
    visibilityFilter,
    categoryFilter,
    tagFilter,
    statusFilter,
    deliveryTimeFilter,
    restockTimeFilter,
    onlyAdvancedPrices,
    onlyCustomFields,
    customFieldKey,
    customFieldPresence,
    customFieldValue,
  ]);

  const stats = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let withAdvancedPrices = 0;
    let withoutChannel = 0;
    let withCustomFields = 0;
    let withoutDeliveryTime = 0;
    for (const p of products) {
      if (p.active === true) active += 1;
      else inactive += 1;
      if (p.hasAdvancedPrices) withAdvancedPrices += 1;
      if (p.salesChannelIds.length === 0) withoutChannel += 1;
      if (p.customFieldKeys.length > 0) withCustomFields += 1;
      if (!p.hasDeliveryTime) withoutDeliveryTime += 1;
    }
    return {
      total: products.length,
      active,
      inactive,
      withAdvancedPrices,
      withoutChannel,
      withCustomFields,
      withoutDeliveryTime,
    };
  }, [products]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const printablePageRows = useMemo(() => pageRows.filter(isPrintableSku), [pageRows]);
  const allPageSelected =
    printablePageRows.length > 0 && printablePageRows.every((p) => selectedIds.has(p.id));
  const somePageSelected = printablePageRows.some((p) => selectedIds.has(p.id));

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id) && isPrintableSku(p)),
    [products, selectedIds],
  );

  function toggleSelectAllPage(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of printablePageRows) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  function toggleSelectOne(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openLabelDialog(articles: PrintableArticle[]) {
    if (articles.length === 0) return;
    setLabelProducts(articles);
    setLabelDialogOpen(true);
  }

  function openDetail(product: OverviewProduct, tab: ProductInsightsTab = "master") {
    setDetailTab(tab);
    setDetailProduct(product);
  }

  const resetFilters = () => {
    setSearch("");
    setChannelFilter(ALL);
    setVisibilityFilter(ALL);
    setCategoryFilter(ALL);
    setTagFilter(ALL);
    setStatusFilter(ALL);
    setOnlyAdvancedPrices(false);
    setOnlyCustomFields(false);
    setCustomFieldKey(ALL);
    setCustomFieldPresence("any");
    setCustomFieldValue("");
    setDeliveryTimeFilter(ALL);
    setRestockTimeFilter(ALL);
    setPage(1);
    setSelectedIds(new Set());
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const header = [
      t("productOverview.table.productNumber"),
      t("productOverview.table.name"),
      t("productOverview.table.status"),
      t("productOverview.table.salesChannels"),
      t("productOverview.table.visibility"),
      t("productOverview.table.advancedPrices"),
      t("productOverview.table.categories"),
      t("productOverview.table.tags"),
      t("productOverview.table.deliveryTime"),
      t("productOverview.table.restockTime"),
      t("productOverview.table.customFields"),
      t("productOverview.csv.priceGross"),
      t("productOverview.csv.priceNet"),
      t("productOverview.csv.taxRate"),
      "EAN",
      t("productOverview.csv.manufacturerNumber"),
      t("productOverview.csv.stock"),
      t("productOverview.table.priceChangedAt"),
      t("productOverview.table.lastUpdated"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const p of filtered) {
      const customFields = p.customFieldKeys
        .map((k) => `${k}=${formatCustomFieldDisplay(p, k)}`)
        .join(" | ");
      lines.push(
        [
          p.productNumber,
          p.name,
          p.active === true ? t("productOverview.active") : t("productOverview.inactive"),
          p.salesChannels.map((c) => c.name).join(" | "),
          p.salesChannels
            .map((c) => `${c.name}=${c.visibility ?? t("productOverview.visibility.unknown")}`)
            .join(" | "),
          p.advancedPriceCount,
          p.categories.join(" | "),
          (p.tags ?? []).join(" | "),
          formatDeliveryTimeLabel(p, t) ?? "",
          formatRestockTimeLabel(p.restockTime, t) ?? "",
          customFields,
          p.priceGross,
          p.priceNet,
          p.taxRate,
          p.ean ?? "",
          p.manufacturerNumber ?? "",
          p.stock ?? "",
          p.lastPriceChangeAt ? dateTimeFormatter.format(new Date(p.lastPriceChangeAt)) : "",
          p.updatedAt ? dateTimeFormatter.format(new Date(p.updatedAt)) : "",
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "produkt-uebersicht.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  function handleOverviewScan(code: string) {
    const scanned = normalizeScanCode(code);
    if (!scanned) return;
    setSearch(scanned);
    setPage(1);

    const exact = products.find(
      (p) =>
        p.productNumber === scanned ||
        (p.ean != null && String(p.ean).trim() === scanned),
    );

    if (!exact) {
      toast({
        title: t("barcodeScan.overviewNotFound", { code: scanned }),
        variant: "destructive",
      });
      setScannerOpen(false);
      return;
    }

    if (!isPrintableSku(exact)) {
      toast({
        title: t("barcodeScan.overviewNotPrintable", { code: scanned }),
      });
      setScannerOpen(false);
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(exact.id);
      return next;
    });
    toast({
      title: t("barcodeScan.overviewSelected", { productNumber: exact.productNumber }),
    });
    setScannerOpen(false);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Boxes className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("productOverview.title")}</h1>
            <p className="text-muted-foreground">{t("productOverview.description")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedProducts.length > 0 ? (
            <Button
              variant="default"
              onClick={() => openLabelDialog(selectedProducts.map(toPrintableArticle))}
              data-testid="overview-print-labels"
            >
              <Printer className="h-4 w-4 mr-2" />
              {t("productLabels.printSelected", { count: selectedProducts.length })}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="overview-refresh">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("productOverview.refresh")}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} data-testid="overview-export">
            <Download className="h-4 w-4 mr-2" />
            {t("productOverview.exportCsv")}
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {error instanceof Error ? error.message : t("productOverview.errorTitle")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.total")}</p>
            <p className="text-2xl font-semibold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.active")}</p>
            <p className="text-2xl font-semibold text-green-600">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.withAdvancedPrices")}</p>
            <p className="text-2xl font-semibold">{stats.withAdvancedPrices}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.withoutChannel")}</p>
            <p className="text-2xl font-semibold text-destructive">{stats.withoutChannel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.withCustomFields")}</p>
            <p className="text-2xl font-semibold">{stats.withCustomFields}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("productOverview.stats.withoutDeliveryTime")}</p>
            <p className="text-2xl font-semibold text-destructive">{stats.withoutDeliveryTime}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("productOverview.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={t("productOverview.filters.searchPlaceholder")}
                  className="pl-8"
                  data-testid="overview-search"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setScannerOpen(true)}
                title={t("barcodeScan.scan")}
                data-testid="overview-scan"
              >
                <ScanLine className="h-4 w-4" />
                <span className="sr-only">{t("barcodeScan.scan")}</span>
              </Button>
            </div>

            <Select
              value={channelFilter}
              onValueChange={(v) => {
                setChannelFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-channel">
                <SelectValue placeholder={t("productOverview.filters.salesChannel")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allChannels")}</SelectItem>
                <SelectItem value={NONE_CHANNEL}>{t("productOverview.filters.noChannel")}</SelectItem>
                {salesChannels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={visibilityFilter}
              onValueChange={(v) => {
                setVisibilityFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-visibility">
                <SelectValue placeholder={t("productOverview.filters.visibility")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allVisibilities")}</SelectItem>
                {VISIBILITY_LEVELS.map((level) => (
                  <SelectItem key={level} value={String(level)}>
                    {t(`productOverview.filters.visibility${level}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={categoryFilter}
              onValueChange={(v) => {
                setCategoryFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-category">
                <SelectValue placeholder={t("productOverview.filters.category")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allCategories")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={tagFilter}
              onValueChange={(v) => {
                setTagFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-tag">
                <SelectValue placeholder={t("productOverview.filters.tag")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allTags")}</SelectItem>
                {tags.map((tg) => (
                  <SelectItem key={tg} value={tg}>
                    {tg}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-status">
                <SelectValue placeholder={t("productOverview.filters.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allStatus")}</SelectItem>
                <SelectItem value="active">{t("productOverview.filters.active")}</SelectItem>
                <SelectItem value="inactive">{t("productOverview.filters.inactive")}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={deliveryTimeFilter}
              onValueChange={(v) => {
                setDeliveryTimeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-delivery-time">
                <SelectValue placeholder={t("productOverview.filters.deliveryTime")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allDeliveryTimes")}</SelectItem>
                <SelectItem value={NONE_DELIVERY_TIME}>{t("productOverview.filters.noDeliveryTime")}</SelectItem>
                {deliveryTimeOptions.map((dt) => (
                  <SelectItem key={dt.id} value={dt.id}>
                    {dt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={restockTimeFilter}
              onValueChange={(v) => {
                setRestockTimeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-restock-time">
                <SelectValue placeholder={t("productOverview.filters.restockTime")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allRestockTimes")}</SelectItem>
                <SelectItem value={NONE_RESTOCK_TIME}>{t("productOverview.filters.noRestockTime")}</SelectItem>
                {restockTimeOptions.map((rt) => (
                  <SelectItem key={rt.value} value={rt.value}>
                    {rt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={customFieldKey}
              onValueChange={(v) => {
                setCustomFieldKey(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-customfield-key">
                <SelectValue placeholder={t("productOverview.filters.customFieldKey")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("productOverview.filters.allCustomFields")}</SelectItem>
                {customFieldKeyOptions.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={customFieldPresence}
              onValueChange={(v) => {
                setCustomFieldPresence(v as "any" | "present" | "absent");
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="overview-customfield-presence">
                <SelectValue placeholder={t("productOverview.filters.customFieldPresence")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">{t("productOverview.filters.presenceAny")}</SelectItem>
                <SelectItem value="present">{t("productOverview.filters.presencePresent")}</SelectItem>
                <SelectItem value="absent">{t("productOverview.filters.presenceAbsent")}</SelectItem>
              </SelectContent>
            </Select>

            <Input
              value={customFieldValue}
              onChange={(e) => {
                setCustomFieldValue(e.target.value);
                setPage(1);
              }}
              placeholder={t("productOverview.filters.customFieldValuePlaceholder")}
              disabled={customFieldPresence === "absent"}
              data-testid="overview-customfield-value"
            />
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={onlyAdvancedPrices}
                onCheckedChange={(v) => {
                  setOnlyAdvancedPrices(v);
                  setPage(1);
                }}
                data-testid="overview-toggle-advanced"
              />
              {t("productOverview.filters.onlyAdvancedPrices")}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Switch
                checked={onlyCustomFields}
                onCheckedChange={(v) => {
                  setOnlyCustomFields(v);
                  setPage(1);
                }}
                data-testid="overview-toggle-customfields"
              />
              {t("productOverview.filters.onlyCustomFields")}
            </label>
            <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="overview-reset">
              <X className="h-4 w-4 mr-2" />
              {t("productOverview.filters.reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>
            {t("productOverview.pagination.showing", {
              count: filtered.length,
              total: stats.total,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">{t("productOverview.loading")}</p>
          ) : pageRows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">{t("productOverview.noResults")}</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={
                          allPageSelected ? true : somePageSelected ? "indeterminate" : false
                        }
                        onCheckedChange={(v) => toggleSelectAllPage(v === true)}
                        disabled={printablePageRows.length === 0}
                        aria-label={t("productLabels.selectAll")}
                      />
                    </TableHead>
                    <TableHead className="w-[150px]">{t("productOverview.table.productNumber")}</TableHead>
                    <TableHead className="min-w-[200px]">{t("productOverview.table.name")}</TableHead>
                    <TableHead className="w-[90px]">{t("productOverview.table.status")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("productOverview.table.salesChannels")}</TableHead>
                    <TableHead className="min-w-[160px]">{t("productOverview.table.visibility")}</TableHead>
                    <TableHead className="w-[120px]">{t("productOverview.table.advancedPrices")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("productOverview.table.categories")}</TableHead>
                    <TableHead className="min-w-[160px]">{t("productOverview.table.tags")}</TableHead>
                    <TableHead className="min-w-[140px]">{t("productOverview.table.deliveryTime")}</TableHead>
                    <TableHead className="min-w-[120px]">{t("productOverview.table.restockTime")}</TableHead>
                    <TableHead className="w-[130px]">{t("productOverview.table.customFields")}</TableHead>
                    <TableHead className="w-[120px] text-right">{t("productOverview.table.price")}</TableHead>
                    <TableHead className="w-[140px]">{t("productOverview.table.priceChangedAt")}</TableHead>
                    <TableHead className="w-[140px]" title={t("productOverview.table.lastUpdatedHint")}>
                      {t("productOverview.table.lastUpdated")}
                    </TableHead>
                    <TableHead className="w-[56px]">{t("productOverview.table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      focusChannelId={
                        channelFilter !== ALL && channelFilter !== NONE_CHANNEL ? channelFilter : null
                      }
                      selected={selectedIds.has(p.id)}
                      printable={isPrintableSku(p)}
                      onSelectedChange={(checked) => toggleSelectOne(p.id, checked)}
                      onPrint={() => openLabelDialog([toPrintableArticle(p)])}
                      onOpenDetail={(tab) => openDetail(p, tab)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground">
                {t("productOverview.pagination.pageInfo", { page: currentPage, pages: pageCount })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  {t("productOverview.pagination.prev")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                >
                  {t("productOverview.pagination.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ProductInsightsModal
        product={detailProduct}
        open={detailProduct !== null}
        onOpenChange={(next) => {
          if (!next) setDetailProduct(null);
        }}
        initialTab={detailTab}
        minMarginPercent={data?.profitabilityMinMarginPercent}
        onPrintLabel={
          detailProduct ? () => openLabelDialog([toPrintableArticle(detailProduct)]) : undefined
        }
      />

      <PrintArticleLabelDialog
        products={labelProducts}
        open={labelDialogOpen}
        onOpenChange={setLabelDialogOpen}
      />

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={handleOverviewScan}
        description={t("barcodeScan.overviewDescription")}
      />
    </div>
  );
}

function BadgeList({
  items,
  icon,
  emptyLabel,
  moreLabel,
}: {
  items: string[];
  icon?: ReactNode;
  emptyLabel: string;
  moreLabel: (n: number) => string;
}) {
  if (items.length === 0) {
    return <span className="text-muted-foreground text-sm">{emptyLabel}</span>;
  }
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <Badge key={item} variant="secondary" className="gap-1">
          {icon}
          {item}
        </Badge>
      ))}
      {rest > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={(event) => event.stopPropagation()}
            >
              {moreLabel(rest)}
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-64" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap gap-1">
              {items.map((item) => (
                <Badge key={item} variant="secondary">
                  {item}
                </Badge>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

/** Badge-Variante je Shopware-Sichtbarkeitsstufe. */
function visibilityBadgeVariant(
  visibility: number | null | undefined,
): "success" | "secondary" | "outline" {
  if (visibility === 30) return "success";
  if (visibility === 20) return "secondary";
  return "outline";
}

function VisibilityBadge({
  visibility,
  suffix,
}: {
  visibility: number | null | undefined;
  suffix?: string;
}) {
  const { t } = useTranslation();
  const label = formatVisibilityLabel(visibility, t);
  return (
    <Badge
      variant={visibilityBadgeVariant(visibility)}
      className={visibility == null || visibility === 0 ? "gap-1 text-muted-foreground" : "gap-1"}
      title={visibility == null ? t("productOverview.visibility.unknownHint") : undefined}
    >
      <Eye className="h-3 w-3" />
      {label}
      {suffix ? <span className="opacity-70">{suffix}</span> : null}
    </Badge>
  );
}

/**
 * Sichtbarkeits-Spalte: bei gewähltem Kanalfilter genau dessen Stufe, sonst eine
 * Zusammenfassung über alle Kanäle (Details im Popover).
 */
function VisibilityCell({
  product,
  focusChannelId,
}: {
  product: OverviewProduct;
  focusChannelId: string | null;
}) {
  const { t } = useTranslation();

  if (focusChannelId) {
    return <VisibilityBadge visibility={getChannelVisibility(product, focusChannelId)} />;
  }

  const channels = product.salesChannels;
  if (channels.length === 0) {
    return <VisibilityBadge visibility={0} />;
  }

  const counts = new Map<number | null, number>();
  for (const channel of channels) {
    const level = channel.visibility ?? null;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  const levels = Array.from(counts.keys()).sort((a, b) => (b ?? -1) - (a ?? -1));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div className="flex cursor-pointer flex-wrap gap-1">
          {levels.map((level) => (
            <VisibilityBadge
              key={String(level)}
              visibility={level}
              suffix={levels.length > 1 || channels.length > 1 ? `· ${counts.get(level)}` : undefined}
            />
          ))}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {t("productOverview.visibility.summary", { count: channels.length })}
          </div>
          {channels.map((channel) => (
            <div key={channel.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{channel.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {formatVisibilityLabel(channel.visibility ?? null, t)}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProductRow({
  product,
  focusChannelId,
  selected,
  printable,
  onSelectedChange,
  onPrint,
  onOpenDetail,
}: {
  product: OverviewProduct;
  /** Gewählter Kanalfilter — dann zeigt die Sichtbarkeits-Spalte genau diesen Kanal. */
  focusChannelId: string | null;
  selected: boolean;
  printable: boolean;
  onSelectedChange: (checked: boolean) => void;
  onPrint: () => void;
  onOpenDetail: (tab: ProductInsightsTab) => void;
}) {
  const { t } = useTranslation();
  const channelNames = product.salesChannels.map((c) => c.name);
  const deliveryTimeLabel = formatDeliveryTimeLabel(product, t);
  const restockTimeLabel = formatRestockTimeLabel(product.restockTime, t);
  const inherited = new Set(product.inheritedFields || []);
  const optionLabel = (product.options || [])
    .map((o) => o.option)
    .filter(Boolean)
    .join(" · ");

  const inheritedHint = (field: string) =>
    inherited.has(field) ? (
      <span
        className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground"
        title={t("productOverview.inheritedHint")}
      >
        {t("productOverview.inherited")}
      </span>
    ) : null;

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onOpenDetail("master")}
      data-testid={`overview-row-${product.productNumber}`}
    >
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={selected}
          disabled={!printable}
          onCheckedChange={(v) => onSelectedChange(v === true)}
          aria-label={t("productLabels.selectRow", { number: product.productNumber })}
        />
      </TableCell>
      <TableCell className="font-mono text-sm">{product.productNumber}</TableCell>
      <TableCell>
        <div className="font-medium">
          {product.name || t("productOverview.table.none")}
          {inheritedHint("name")}
        </div>
        {optionLabel ? (
          <div className="text-xs text-muted-foreground">{optionLabel}</div>
        ) : null}
        {product.manufacturerNumber ? (
          <div className="text-xs text-muted-foreground">{product.manufacturerNumber}</div>
        ) : null}
      </TableCell>
      <TableCell>
        {product.active === true ? (
          <Badge variant="success">{t("productOverview.active")}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t("productOverview.inactive")}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-1 flex-wrap">
          <BadgeList
            items={channelNames}
            icon={<Store className="h-3 w-3" />}
            emptyLabel={t("productOverview.table.none")}
            moreLabel={(n) => t("productOverview.table.more", { count: n })}
          />
          {inheritedHint("salesChannels")}
        </div>
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <VisibilityCell product={product} focusChannelId={focusChannelId} />
      </TableCell>
      <TableCell
        onClick={(event) => {
          if (!product.hasAdvancedPrices) return;
          event.stopPropagation();
          onOpenDetail("prices");
        }}
      >
        <div className="flex items-center gap-1">
          {product.hasAdvancedPrices ? (
            <Badge variant="secondary" className="cursor-pointer gap-1">
              <Layers className="h-3 w-3" />
              {t("productOverview.table.tiers", { count: product.advancedPriceCount })}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
          )}
          {inheritedHint("advancedPrices")}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-1 flex-wrap">
          <BadgeList
            items={product.categories}
            icon={<Tag className="h-3 w-3" />}
            emptyLabel={t("productOverview.table.none")}
            moreLabel={(n) => t("productOverview.table.more", { count: n })}
          />
          {inheritedHint("categories")}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-start gap-1 flex-wrap">
          <BadgeList
            items={product.tags ?? []}
            icon={<TagIcon className="h-3 w-3" />}
            emptyLabel={t("productOverview.table.none")}
            moreLabel={(n) => t("productOverview.table.more", { count: n })}
          />
          {inheritedHint("tags")}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {deliveryTimeLabel ? (
            <span className="text-sm">{deliveryTimeLabel}</span>
          ) : (
            <span className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {t("productOverview.table.missingDeliveryTime")}
            </span>
          )}
          {inheritedHint("deliveryTime")}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {restockTimeLabel ? (
            <span className="text-sm">{restockTimeLabel}</span>
          ) : (
            <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
          )}
          {inheritedHint("restockTime")}
        </div>
      </TableCell>
      <TableCell
        onClick={(event) => {
          if (product.customFieldKeys.length === 0) return;
          event.stopPropagation();
          onOpenDetail("raw");
        }}
      >
        <div className="flex items-center gap-1">
          {product.customFieldKeys.length > 0 ? (
            <Badge variant="secondary" className="cursor-pointer">
              {t("productOverview.table.fieldsCount", { count: product.customFieldKeys.length })}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
          )}
          {inheritedHint("customFields")}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono">
        <div>
          {currencyFormatter.format(product.priceGross || 0)}
          {inheritedHint("price")}
        </div>
        <div className="text-xs text-muted-foreground">
          {currencyFormatter.format(product.priceNet || 0)} {t("productOverview.net")}
        </div>
      </TableCell>
      <TableCell
        onClick={(event) => {
          if (!product.lastPriceChangeAt) return;
          event.stopPropagation();
          onOpenDetail("prices");
        }}
      >
        {product.lastPriceChangeAt ? (
          <span className="text-sm underline decoration-dotted underline-offset-2 cursor-pointer">
            {dateTimeFormatter.format(new Date(product.lastPriceChangeAt))}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
        )}
      </TableCell>
      <TableCell>
        {product.updatedAt ? (
          <span
            className="text-sm text-muted-foreground"
            title={t("productOverview.table.lastUpdatedHint")}
          >
            {dateTimeFormatter.format(new Date(product.updatedAt))}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
        )}
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!printable}
          title={
            printable
              ? t("productLabels.printOne")
              : t("productLabels.parentNotPrintable")
          }
          onClick={onPrint}
        >
          <Printer className="h-4 w-4" />
          <span className="sr-only">{t("productLabels.printOne")}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

