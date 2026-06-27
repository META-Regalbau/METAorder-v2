import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Search,
  Download,
  RefreshCw,
  Tag,
  Layers,
  Store,
  AlertCircle,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

interface OverviewAdvancedPrice {
  quantityStart: number;
  quantityEnd: number | null;
  gross: number | null;
  net: number | null;
  ruleId: string | null;
}

interface OverviewProduct {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  stock: number | null;
  ean?: string;
  manufacturerNumber?: string;
  manufacturerName?: string;
  priceGross: number;
  priceNet: number;
  taxRate: number;
  currency: string;
  salesChannelIds: string[];
  salesChannels: Array<{ id: string; name: string }>;
  advancedPrices: OverviewAdvancedPrice[];
  hasAdvancedPrices: boolean;
  advancedPriceCount: number;
  categories: string[];
  customFields?: Record<string, unknown>;
  customFieldKeys: string[];
  propertyCount: number;
  parentId: string | null;
  childCount: number | null;
  createdAt?: string;
  updatedAt?: string;
}

interface OverviewResponse {
  products: OverviewProduct[];
  salesChannels: Array<{ id: string; name: string }>;
  total: number;
}

const PAGE_SIZE = 50;
const NONE_CHANNEL = "__none__";
const ALL = "__all__";

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

function formatCustomFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ProductOverviewPage() {
  const { t } = useTranslation();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<OverviewResponse>({
    queryKey: ["/api/products/overview"],
  });

  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [onlyAdvancedPrices, setOnlyAdvancedPrices] = useState(false);
  const [onlyCustomFields, setOnlyCustomFields] = useState(false);
  const [customFieldKey, setCustomFieldKey] = useState<string>(ALL);
  const [customFieldPresence, setCustomFieldPresence] = useState<"any" | "present" | "absent">("any");
  const [customFieldValue, setCustomFieldValue] = useState("");
  const [page, setPage] = useState(1);

  const products = useMemo(() => data?.products ?? [], [data]);
  const salesChannels = useMemo(() => data?.salesChannels ?? [], [data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const c of p.categories) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const customFieldKeyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const k of p.customFieldKeys) set.add(k);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (term) {
        const haystack = `${p.productNumber} ${p.name} ${p.ean ?? ""} ${p.manufacturerNumber ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (channelFilter === NONE_CHANNEL) {
        if (p.salesChannelIds.length > 0) return false;
      } else if (channelFilter !== ALL) {
        if (!p.salesChannelIds.includes(channelFilter)) return false;
      }
      if (categoryFilter !== ALL && !p.categories.includes(categoryFilter)) return false;
      if (statusFilter === "active" && p.active !== true) return false;
      if (statusFilter === "inactive" && p.active === true) return false;
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
            const val = formatCustomFieldValue(p.customFields?.[customFieldKey]).toLowerCase();
            if (!val.includes(cfValueTerm)) return false;
          }
        }
      } else {
        // Kein konkreter Key gewählt
        if (customFieldPresence === "present" && p.customFieldKeys.length === 0) return false;
        if (customFieldPresence === "absent" && p.customFieldKeys.length > 0) return false;
        if (cfValueTerm && customFieldPresence !== "absent") {
          const matches = p.customFieldKeys.some((k) =>
            formatCustomFieldValue(p.customFields?.[k]).toLowerCase().includes(cfValueTerm),
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
    categoryFilter,
    statusFilter,
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
    for (const p of products) {
      if (p.active === true) active += 1;
      else inactive += 1;
      if (p.hasAdvancedPrices) withAdvancedPrices += 1;
      if (p.salesChannelIds.length === 0) withoutChannel += 1;
      if (p.customFieldKeys.length > 0) withCustomFields += 1;
    }
    return { total: products.length, active, inactive, withAdvancedPrices, withoutChannel, withCustomFields };
  }, [products]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const resetFilters = () => {
    setSearch("");
    setChannelFilter(ALL);
    setCategoryFilter(ALL);
    setStatusFilter(ALL);
    setOnlyAdvancedPrices(false);
    setOnlyCustomFields(false);
    setCustomFieldKey(ALL);
    setCustomFieldPresence("any");
    setCustomFieldValue("");
    setPage(1);
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const header = [
      t("productOverview.table.productNumber"),
      t("productOverview.table.name"),
      t("productOverview.table.status"),
      t("productOverview.table.salesChannels"),
      t("productOverview.table.advancedPrices"),
      t("productOverview.table.categories"),
      t("productOverview.table.customFields"),
      t("productOverview.csv.priceGross"),
      t("productOverview.csv.priceNet"),
      t("productOverview.csv.taxRate"),
      "EAN",
      t("productOverview.csv.manufacturerNumber"),
      t("productOverview.csv.stock"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const p of filtered) {
      const customFields = p.customFieldKeys
        .map((k) => `${k}=${formatCustomFieldValue(p.customFields?.[k])}`)
        .join(" | ");
      lines.push(
        [
          p.productNumber,
          p.name,
          p.active === true ? t("productOverview.active") : t("productOverview.inactive"),
          p.salesChannels.map((c) => c.name).join(" | "),
          p.advancedPriceCount,
          p.categories.join(" | "),
          customFields,
          p.priceGross,
          p.priceNet,
          p.taxRate,
          p.ean ?? "",
          p.manufacturerNumber ?? "",
          p.stock ?? "",
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("productOverview.filtersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="relative">
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
                    <TableHead className="w-[150px]">{t("productOverview.table.productNumber")}</TableHead>
                    <TableHead className="min-w-[200px]">{t("productOverview.table.name")}</TableHead>
                    <TableHead className="w-[90px]">{t("productOverview.table.status")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("productOverview.table.salesChannels")}</TableHead>
                    <TableHead className="w-[120px]">{t("productOverview.table.advancedPrices")}</TableHead>
                    <TableHead className="min-w-[180px]">{t("productOverview.table.categories")}</TableHead>
                    <TableHead className="w-[130px]">{t("productOverview.table.customFields")}</TableHead>
                    <TableHead className="w-[120px] text-right">{t("productOverview.table.price")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((p) => (
                    <ProductRow key={p.id} product={p} />
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
            <Badge variant="outline" className="cursor-pointer">
              {moreLabel(rest)}
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-64">
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

function ProductRow({ product }: { product: OverviewProduct }) {
  const { t } = useTranslation();
  const channelNames = product.salesChannels.map((c) => c.name);

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{product.productNumber}</TableCell>
      <TableCell>
        <div className="font-medium">{product.name}</div>
        {product.manufacturerNumber ? (
          <div className="text-xs text-muted-foreground">{product.manufacturerNumber}</div>
        ) : null}
      </TableCell>
      <TableCell>
        {product.active === true ? (
          <Badge className="bg-green-600 hover:bg-green-600">{t("productOverview.active")}</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            {t("productOverview.inactive")}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <BadgeList
          items={channelNames}
          icon={<Store className="h-3 w-3" />}
          emptyLabel={t("productOverview.table.none")}
          moreLabel={(n) => t("productOverview.table.more", { count: n })}
        />
      </TableCell>
      <TableCell>
        {product.hasAdvancedPrices ? (
          <Dialog>
            <DialogTrigger asChild>
              <Badge variant="secondary" className="cursor-pointer gap-1">
                <Layers className="h-3 w-3" />
                {t("productOverview.table.tiers", { count: product.advancedPriceCount })}
              </Badge>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("productOverview.advancedPricesTitle")}</DialogTitle>
                <DialogDescription>
                  {product.productNumber} · {product.name}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("productOverview.modal.quantity")}</TableHead>
                      <TableHead className="text-right">{t("productOverview.csv.priceGross")}</TableHead>
                      <TableHead className="text-right">{t("productOverview.csv.priceNet")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.advancedPrices.map((ap, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          {t("productOverview.fromQuantity", { qty: ap.quantityStart })}
                          {ap.quantityEnd ? `–${ap.quantityEnd}` : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {ap.gross != null ? currencyFormatter.format(ap.gross) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {ap.net != null ? currencyFormatter.format(ap.net) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
        )}
      </TableCell>
      <TableCell>
        <BadgeList
          items={product.categories}
          icon={<Tag className="h-3 w-3" />}
          emptyLabel={t("productOverview.table.none")}
          moreLabel={(n) => t("productOverview.table.more", { count: n })}
        />
      </TableCell>
      <TableCell>
        {product.customFieldKeys.length > 0 ? (
          <Dialog>
            <DialogTrigger asChild>
              <Badge variant="secondary" className="cursor-pointer">
                {t("productOverview.table.fieldsCount", { count: product.customFieldKeys.length })}
              </Badge>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("productOverview.customFieldsTitle")}</DialogTitle>
                <DialogDescription>
                  {product.productNumber} · {product.name}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border overflow-hidden max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("productOverview.modal.field")}</TableHead>
                      <TableHead>{t("productOverview.modal.value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.customFieldKeys.map((key) => (
                      <TableRow key={key}>
                        <TableCell className="font-mono text-xs align-top">{key}</TableCell>
                        <TableCell className="break-all">
                          {formatCustomFieldValue(product.customFields?.[key]) || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <span className="text-muted-foreground text-sm">{t("productOverview.table.none")}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="font-medium">{currencyFormatter.format(product.priceGross)}</div>
        <div className="text-xs text-muted-foreground">
          {currencyFormatter.format(product.priceNet)} {t("productOverview.net")}
        </div>
      </TableCell>
    </TableRow>
  );
}
