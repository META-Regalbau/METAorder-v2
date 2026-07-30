import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Warehouse, Plus, ScanLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErpProductAutocomplete from "@/components/ErpProductAutocomplete";
import { ErpProductCell } from "@/components/ErpProductCell";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";

type StockQtyFilter = "all" | "in_stock" | "out_of_stock" | "erp_positive" | "erp_zero";
type StockDiffFilter = "all" | "diff" | "match" | "only_shopware" | "only_erp";
type StockActiveFilter = "all" | "active" | "inactive";

type ErpWarehouse = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  active: boolean;
};

type ErpShelfType = {
  id: string;
  manufacturer: string;
  code: string;
  name: string;
  description?: string | null;
  active: boolean;
};

type ErpWarehouseLocation = {
  id: string;
  warehouseId: string;
  code: string;
  name?: string | null;
  shelfTypeId?: string | null;
  regalzeile?: string | null;
  regalfeld?: string | null;
  regalfach?: string | null;
  regalplatz?: string | null;
  active: boolean;
};

type ErpStockLevel = {
  id: string;
  warehouseId: string;
  productNumber: string;
  quantity: number;
  reservedQuantity: number;
  minQuantity: number;
  reorderPoint: number;
};

type ErpStockMovement = {
  id: string;
  productNumber: string;
  quantity: number;
  movementType: string;
  createdAt: string;
  note?: string | null;
};

type ErpInventoryCountLine = {
  id: string;
  productNumber: string;
  expectedQty: number;
  countedQty: number | null;
  difference: number | null;
};

type ErpInventoryCount = {
  id: string;
  warehouseId: string;
  status: string;
  notes?: string | null;
  createdAt?: string;
};

type ErpInventoryCountDetail = ErpInventoryCount & { lines: ErpInventoryCountLine[] };

type StockReconcileLabel = {
  productNumber: string;
  name: string | null;
  size: string | null;
  color: string | null;
  optionsLabel: string | null;
  label: string;
  shopwareId?: string | null;
  active?: boolean | null;
  isParent?: boolean;
};

type StockReconcileRow = {
  productNumber: string;
  shopwareQty: number;
  erpQty: number;
  delta: number;
  label: StockReconcileLabel;
  isParent?: boolean;
  priceNet?: number | null;
  priceGross?: number | null;
  purchasePriceNet?: number | null;
  reservedQuantity?: number;
};

type StockReconcileResult = {
  warehouseId: string;
  warehouseCode: string;
  warehouseName?: string;
  rows: StockReconcileRow[];
  totals: {
    compared: number;
    diffs: number;
    onlyShopware: number;
    onlyErp: number;
    skippedParents?: number;
  };
};

export default function WarehousePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [whOpen, setWhOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [whForm, setWhForm] = useState({ code: "", name: "", isDefault: false });
  const [moveForm, setMoveForm] = useState({
    warehouseId: "",
    productNumber: "",
    quantity: 1,
    movementType: "receipt",
    reorderPoint: 0,
    minQuantity: 0,
  });
  const [startWarehouseId, setStartWarehouseId] = useState("");
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [addProductNumber, setAddProductNumber] = useState("");
  const [inventoryLineFilter, setInventoryLineFilter] = useState("");
  const [countedDrafts, setCountedDrafts] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const scanBusyRef = useRef(false);
  const [mainTab, setMainTab] = useState("stock");
  const [stockSearch, setStockSearch] = useState("");
  const deferredStockSearch = useDeferredValue(stockSearch);
  const [stockQtyFilter, setStockQtyFilter] = useState<StockQtyFilter>("all");
  const [stockDiffFilter, setStockDiffFilter] = useState<StockDiffFilter>("all");
  const [stockActiveFilter, setStockActiveFilter] = useState<StockActiveFilter>("all");
  const [stockSizeFilter, setStockSizeFilter] = useState("all");
  const [stockColorFilter, setStockColorFilter] = useState("all");
  const [locationsWarehouseId, setLocationsWarehouseId] = useState("");
  const [locOpen, setLocOpen] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const emptyLocForm = {
    code: "",
    name: "",
    shelfTypeId: "",
    regalzeile: "",
    regalfeld: "",
    regalfach: "",
    regalplatz: "",
    active: true,
  };
  const [locForm, setLocForm] = useState(emptyLocForm);
  const [shelfTypeOpen, setShelfTypeOpen] = useState(false);
  const [editingShelfTypeId, setEditingShelfTypeId] = useState<string | null>(null);
  const emptyShelfForm = {
    manufacturer: "META",
    code: "",
    name: "",
    description: "",
    active: true,
  };
  const [shelfForm, setShelfForm] = useState(emptyShelfForm);

  const { data: whData, isLoading: whLoading } = useQuery<{ warehouses: ErpWarehouse[] }>({
    queryKey: ["/api/erp/warehouses"],
  });
  const warehouses = whData?.warehouses ?? [];
  const warehouseById = useMemo(
    () => new Map(warehouses.map((w) => [w.id, w])),
    [warehouses],
  );

  const { data: shelfTypesData } = useQuery<{ shelfTypes: ErpShelfType[] }>({
    queryKey: ["/api/erp/shelf-types"],
  });
  const shelfTypes = shelfTypesData?.shelfTypes ?? [];
  const shelfTypeById = useMemo(
    () => new Map(shelfTypes.map((s) => [s.id, s])),
    [shelfTypes],
  );

  const effectiveLocationsWarehouseId =
    locationsWarehouseId ||
    warehouses.find((w) => w.isDefault)?.id ||
    warehouses[0]?.id ||
    "";

  const { data: locationsData, isLoading: locationsLoading } = useQuery<{
    locations: ErpWarehouseLocation[];
  }>({
    queryKey: ["/api/erp/warehouses", effectiveLocationsWarehouseId, "locations"],
    enabled: Boolean(effectiveLocationsWarehouseId),
  });
  const locations = locationsData?.locations ?? [];

  const locationCodePreview = useMemo(() => {
    const explicit = locForm.code.trim();
    if (explicit) return explicit;
    return [locForm.regalzeile, locForm.regalfeld, locForm.regalfach, locForm.regalplatz]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("-");
  }, [locForm]);

  const { data: stockData } = useQuery<{ stock: ErpStockLevel[] }>({
    queryKey: ["/api/erp/stock"],
  });
  const stock = stockData?.stock ?? [];
  const defaultWarehouseId =
    warehouses.find((w) => w.isDefault)?.id ||
    warehouses.find((w) => /^hauptlager$/i.test(w.code) || /^hauptlager$/i.test(w.name))?.id ||
    warehouses[0]?.id;
  const stockMain = useMemo(
    () =>
      defaultWarehouseId
        ? stock.filter((s) => s.warehouseId === defaultWarehouseId)
        : stock,
    [stock, defaultWarehouseId],
  );

  const { data: movData } = useQuery<{ movements: ErpStockMovement[] }>({
    queryKey: ["/api/erp/stock/movements"],
  });
  const movements = movData?.movements ?? [];

  const { data: countData } = useQuery<{ counts: ErpInventoryCount[] }>({
    queryKey: ["/api/erp/inventory-counts"],
  });
  const counts = countData?.counts ?? [];

  const {
    data: reconcileData,
    isLoading: reconcileLoading,
    isFetching: reconcileFetching,
  } = useQuery<StockReconcileResult>({
    queryKey: ["/api/erp/stock/reconcile", mainTab === "stock" ? "all" : "diffs"],
    enabled: mainTab === "reconcile" || mainTab === "stock",
    queryFn: async ({ queryKey }) => {
      const mode = queryKey[1];
      const onlyDiffs = mode !== "all";
      const res = await fetch(`/api/erp/stock/reconcile?onlyDiffs=${onlyDiffs}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const reconcileRows = reconcileData?.rows ?? [];
  const reconcileTotals = reconcileData?.totals;

  const { data: activeCountData, isLoading: activeCountLoading } = useQuery<{
    count: ErpInventoryCountDetail;
    labels?: Record<string, StockReconcileLabel>;
  }>({
    queryKey: ["/api/erp/inventory-counts", activeCountId],
    enabled: Boolean(activeCountId),
    queryFn: async () => {
      const res = await fetch(`/api/erp/inventory-counts/${activeCountId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const activeCount = activeCountData?.count;
  const inventoryLabels = activeCountData?.labels ?? {};

  const erpProductNumbers = useMemo(() => {
    // Inventur-Zeilen zuerst, damit Labels für die aktuelle Inventur priorisiert werden
    const nums = [
      ...(activeCount?.lines || []).map((l) => l.productNumber),
      ...stockMain.map((s) => s.productNumber),
      ...movements.map((m) => m.productNumber),
      ...(reconcileRows || []).map((r) => r.productNumber),
    ];
    return nums;
  }, [stockMain, movements, activeCount?.lines, reconcileRows]);
  const { getLabel } = useErpProductLabels(erpProductNumbers);

  const resolveLabel = (productNumber: string, primary?: StockReconcileLabel | null) => {
    const fromInventory = inventoryLabels[productNumber];
    const fromApi = getLabel(productNumber);
    const base = primary || fromInventory || null;
    if (!base) return fromApi;
    const name = base.name || fromApi.name;
    const size = base.size || fromApi.size;
    const color = base.color || fromApi.color;
    const optionsLabel = base.optionsLabel || fromApi.optionsLabel;
    return {
      productNumber,
      name,
      size,
      color,
      optionsLabel,
      label: [productNumber, name, size, color].filter(Boolean).join(" · ") || productNumber,
      shopwareId: base.shopwareId || fromApi.shopwareId,
      active: base.active ?? fromApi.active,
      isParent: base.isParent ?? fromApi.isParent,
    };
  };

  /** Bestände-Tab: Shopware-Mengen (alle SKUs) — auch wenn ERP noch leer ist. */
  const stockViewRows = useMemo(() => {
    if (reconcileRows.length > 0) {
      return reconcileRows
        .filter((r) => !r.isParent)
        .map((r) => ({
          productNumber: r.productNumber,
          shopwareQty: r.shopwareQty as number | null,
          erpQty: r.erpQty,
          delta: r.delta as number | null,
          label: resolveLabel(r.productNumber, r.label),
          priceNet: r.priceNet ?? null,
          priceGross: r.priceGross ?? null,
          purchasePriceNet: r.purchasePriceNet ?? null,
          reservedQuantity: Number(r.reservedQuantity || 0),
        }));
    }
    return stockMain.map((s) => ({
      productNumber: s.productNumber,
      shopwareQty: null as number | null,
      erpQty: s.quantity,
      delta: null as number | null,
      label: resolveLabel(s.productNumber),
      priceNet: null as number | null,
      priceGross: null as number | null,
      purchasePriceNet: null as number | null,
      reservedQuantity: Number(s.reservedQuantity || 0),
    }));
  }, [reconcileRows, stockMain, getLabel]);

  const currencyFmt = useMemo(
    () =>
      new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }),
    [],
  );
  const qtyFmt = useMemo(() => new Intl.NumberFormat("de-DE"), []);

  const stockFilterOptions = useMemo(() => {
    const sizes = new Set<string>();
    const colors = new Set<string>();
    for (const row of stockViewRows) {
      const size = row.label?.size?.trim();
      const color = row.label?.color?.trim();
      if (size) sizes.add(size);
      if (color) colors.add(color);
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return {
      sizes: Array.from(sizes).sort(collator.compare),
      colors: Array.from(colors).sort(collator.compare),
    };
  }, [stockViewRows]);

  const stockFiltersActive =
    deferredStockSearch.trim().length > 0 ||
    stockQtyFilter !== "all" ||
    stockDiffFilter !== "all" ||
    stockActiveFilter !== "all" ||
    stockSizeFilter !== "all" ||
    stockColorFilter !== "all";

  const filteredStockRows = useMemo(() => {
    const q = deferredStockSearch.trim().toLowerCase();
    return stockViewRows.filter((row) => {
      const label = row.label || resolveLabel(row.productNumber);
      const erpQty = Number(row.erpQty || 0);
      const shopwareQty = row.shopwareQty;
      const hasSw = shopwareQty != null;
      const swQty = hasSw ? Number(shopwareQty) : 0;

      if (q) {
        const hay = [
          row.productNumber,
          label.name,
          label.size,
          label.color,
          label.optionsLabel,
          label.label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (stockSizeFilter !== "all" && (label.size || "").trim() !== stockSizeFilter) {
        return false;
      }
      if (stockColorFilter !== "all" && (label.color || "").trim() !== stockColorFilter) {
        return false;
      }

      if (stockActiveFilter === "active" && label.active === false) return false;
      if (stockActiveFilter === "inactive" && label.active !== false) return false;

      if (stockQtyFilter === "in_stock" && !(erpQty > 0 || swQty > 0)) return false;
      if (stockQtyFilter === "out_of_stock" && (erpQty > 0 || swQty > 0)) return false;
      if (stockQtyFilter === "erp_positive" && !(erpQty > 0)) return false;
      if (stockQtyFilter === "erp_zero" && erpQty !== 0) return false;

      if (stockDiffFilter === "diff") {
        if (row.delta == null || row.delta === 0) return false;
      } else if (stockDiffFilter === "match") {
        if (row.delta == null || row.delta !== 0) return false;
      } else if (stockDiffFilter === "only_shopware") {
        if (!(hasSw && swQty > 0 && erpQty === 0)) return false;
      } else if (stockDiffFilter === "only_erp") {
        if (!(erpQty > 0 && (!hasSw || swQty === 0))) return false;
      }

      return true;
    });
  }, [
    stockViewRows,
    deferredStockSearch,
    stockQtyFilter,
    stockDiffFilter,
    stockActiveFilter,
    stockSizeFilter,
    stockColorFilter,
    getLabel,
  ]);

  const stockStats = useMemo(() => {
    let erpQtyTotal = 0;
    let shopwareQtyTotal = 0;
    let reservedTotal = 0;
    let salesValueNet = 0;
    let salesValueGross = 0;
    let purchaseValueNet = 0;
    let skuWithErpStock = 0;
    let skuOutOfStock = 0;
    let diffs = 0;
    let pricedSkuCount = 0;
    let purchasePricedSkuCount = 0;

    for (const row of filteredStockRows) {
      const erpQty = Number(row.erpQty || 0);
      const swQty = row.shopwareQty != null ? Number(row.shopwareQty) : 0;
      erpQtyTotal += erpQty;
      if (row.shopwareQty != null) shopwareQtyTotal += swQty;
      reservedTotal += Number(row.reservedQuantity || 0);
      if (erpQty > 0) skuWithErpStock += 1;
      else skuOutOfStock += 1;
      if (row.delta != null && row.delta !== 0) diffs += 1;

      const qtyForValue = Math.max(0, erpQty);
      if (row.priceNet != null && Number.isFinite(row.priceNet)) {
        salesValueNet += qtyForValue * row.priceNet;
        pricedSkuCount += 1;
      }
      if (row.priceGross != null && Number.isFinite(row.priceGross)) {
        salesValueGross += qtyForValue * row.priceGross;
      }
      if (row.purchasePriceNet != null && Number.isFinite(row.purchasePriceNet)) {
        purchaseValueNet += qtyForValue * row.purchasePriceNet;
        purchasePricedSkuCount += 1;
      }
    }

    return {
      erpQtyTotal,
      shopwareQtyTotal,
      reservedTotal,
      salesValueNet,
      salesValueGross,
      purchaseValueNet,
      skuCount: filteredStockRows.length,
      skuWithErpStock,
      skuOutOfStock,
      diffs,
      pricedSkuCount,
      purchasePricedSkuCount,
    };
  }, [filteredStockRows]);

  const resetStockFilters = () => {
    setStockSearch("");
    setStockQtyFilter("all");
    setStockDiffFilter("all");
    setStockActiveFilter("all");
    setStockSizeFilter("all");
    setStockColorFilter("all");
  };

  const filteredInventoryLines = useMemo(() => {
    const lines = activeCount?.lines || [];
    const q = inventoryLineFilter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((line) => {
      const label = resolveLabel(line.productNumber);
      const hay = [
        line.productNumber,
        label.name,
        label.size,
        label.color,
        label.optionsLabel,
        label.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [activeCount?.lines, inventoryLineFilter, getLabel, inventoryLabels]);

  const createWh = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/erp/warehouses", whForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/warehouses"] });
      setWhOpen(false);
      setWhForm({ code: "", name: "", isDefault: false });
      toast({ title: t("erp.saved") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const saveLocation = useMutation({
    mutationFn: async () => {
      if (!effectiveLocationsWarehouseId) throw new Error("Warehouse required");
      const body = {
        code: locForm.code.trim() || undefined,
        name: locForm.name.trim() || null,
        shelfTypeId: locForm.shelfTypeId || null,
        regalzeile: locForm.regalzeile.trim() || null,
        regalfeld: locForm.regalfeld.trim() || null,
        regalfach: locForm.regalfach.trim() || null,
        regalplatz: locForm.regalplatz.trim() || null,
        active: locForm.active,
      };
      if (editingLocationId) {
        return apiRequest(
          "PATCH",
          `/api/erp/warehouses/${effectiveLocationsWarehouseId}/locations/${editingLocationId}`,
          body,
        );
      }
      return apiRequest("POST", `/api/erp/warehouses/${effectiveLocationsWarehouseId}/locations`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/erp/warehouses", effectiveLocationsWarehouseId, "locations"],
      });
      setLocOpen(false);
      setEditingLocationId(null);
      setLocForm(emptyLocForm);
      toast({ title: t("erp.saved") });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const saveShelfType = useMutation({
    mutationFn: async () => {
      const body = {
        manufacturer: shelfForm.manufacturer.trim() || "META",
        code: shelfForm.code.trim(),
        name: shelfForm.name.trim(),
        description: shelfForm.description.trim() || null,
        active: shelfForm.active,
      };
      if (editingShelfTypeId) {
        return apiRequest("PATCH", `/api/erp/shelf-types/${editingShelfTypeId}`, body);
      }
      return apiRequest("POST", "/api/erp/shelf-types", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/shelf-types"] });
      setShelfTypeOpen(false);
      setEditingShelfTypeId(null);
      setShelfForm(emptyShelfForm);
      toast({ title: t("erp.saved") });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const openCreateLocation = () => {
    setEditingLocationId(null);
    setLocForm(emptyLocForm);
    setLocOpen(true);
  };

  const openEditLocation = (loc: ErpWarehouseLocation) => {
    setEditingLocationId(loc.id);
    setLocForm({
      code: loc.code || "",
      name: loc.name || "",
      shelfTypeId: loc.shelfTypeId || "",
      regalzeile: loc.regalzeile || "",
      regalfeld: loc.regalfeld || "",
      regalfach: loc.regalfach || "",
      regalplatz: loc.regalplatz || "",
      active: loc.active,
    });
    setLocOpen(true);
  };

  const openCreateShelfType = () => {
    setEditingShelfTypeId(null);
    setShelfForm(emptyShelfForm);
    setShelfTypeOpen(true);
  };

  const openEditShelfType = (st: ErpShelfType) => {
    setEditingShelfTypeId(st.id);
    setShelfForm({
      manufacturer: st.manufacturer || "META",
      code: st.code || "",
      name: st.name || "",
      description: st.description || "",
      active: st.active,
    });
    setShelfTypeOpen(true);
  };

  const createMove = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/stock/movements", {
        warehouseId: moveForm.warehouseId,
        productNumber: moveForm.productNumber,
        quantity: Number(moveForm.quantity),
        movementType: moveForm.movementType,
        reorderPoint: Number(moveForm.reorderPoint),
        minQuantity: Number(moveForm.minQuantity),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      setMoveOpen(false);
      toast({ title: t("erp.saved") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const createCount = useMutation({
    mutationFn: async (warehouseId: string) => {
      const res = await apiRequest("POST", "/api/erp/inventory-counts", { warehouseId });
      return res.json() as Promise<{ count: ErpInventoryCount }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts"] });
      setActiveCountId(data.count.id);
      setCountedDrafts({});
      toast({ title: t("erp.warehouse.inventoryStarted") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const seedFromStock = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/erp/inventory-counts/${id}/seed-from-stock`, {});
      return res.json();
    },
    onSuccess: (data: { added: number; skipped: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
      toast({
        title: t("erp.warehouse.seedStockDone"),
        description: t("erp.warehouse.seedResult", { added: data.added, skipped: data.skipped }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const seedFromShopware = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/erp/inventory-counts/${id}/seed-from-shopware`, {
        limit: 2000,
      });
      return res.json();
    },
    onSuccess: (data: { added: number; skipped: number; mirrorTotal?: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/product-labels"] });
      toast({
        title: t("erp.warehouse.seedShopwareDone"),
        description: t("erp.warehouse.seedResult", { added: data.added, skipped: data.skipped }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const addLine = useMutation({
    mutationFn: async (args: {
      productNumber?: string;
      countedQty?: number;
      silent?: boolean;
    } | string) => {
      const pn =
        typeof args === "string"
          ? args.trim()
          : (args.productNumber ?? addProductNumber).trim();
      const countedQty = typeof args === "string" ? undefined : args.countedQty;
      if (!activeCountId || !pn) throw new Error("missing");
      const body: { productNumber: string; countedQty?: number } = { productNumber: pn };
      if (countedQty != null) body.countedQty = countedQty;
      const res = await apiRequest("POST", `/api/erp/inventory-counts/${activeCountId}/lines`, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      setAddProductNumber("");
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
      const silent = typeof vars === "object" && vars?.silent;
      if (!silent) toast({ title: t("erp.saved") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const updateLine = useMutation({
    mutationFn: async (args: { lineId: string; countedQty: number; silent?: boolean }) => {
      if (!activeCountId) throw new Error("missing");
      const res = await apiRequest(
        "PATCH",
        `/api/erp/inventory-counts/${activeCountId}/lines/${args.lineId}`,
        { countedQty: args.countedQty },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  async function handleInventoryScan(code: string) {
    if (!activeCountId || activeCount?.status === "completed" || scanBusyRef.current) return;
    const pn = normalizeScanCode(code);
    if (!pn) return;
    scanBusyRef.current = true;
    try {
      const cached = queryClient.getQueryData<{ count: ErpInventoryCountDetail }>([
        "/api/erp/inventory-counts",
        activeCountId,
      ]);
      const lines = cached?.count?.lines ?? activeCount?.lines ?? [];
      const existing = lines.find((l) => l.productNumber === pn);
      if (existing) {
        const next = (existing.countedQty ?? 0) + 1;
        await updateLine.mutateAsync({ lineId: existing.id, countedQty: next, silent: true });
        setCountedDrafts((prev) => ({ ...prev, [existing.id]: String(next) }));
        toast({
          title: t("barcodeScan.inventoryIncremented", { productNumber: pn, qty: next }),
        });
      } else {
        await addLine.mutateAsync({ productNumber: pn, countedQty: 1, silent: true });
        toast({
          title: t("barcodeScan.inventoryAdded", { productNumber: pn }),
        });
      }
      await queryClient.refetchQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
    } catch {
      // mutations already toast on error
    } finally {
      scanBusyRef.current = false;
    }
  }

  const completeCount = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/erp/inventory-counts/${id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/inventory-counts", activeCountId] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      toast({ title: t("erp.inventoryCompleted") });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const refreshReconcileMirror = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/stock/reconcile/refresh-mirror", {});
      return res.json() as Promise<StockReconcileResult & { ok: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/erp/stock/reconcile"], data);
      toast({
        title: t("erp.warehouse.reconcileMirrorDone"),
        description: t("erp.warehouse.reconcileDiffCount", { count: data.totals?.diffs ?? 0 }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const applyReconcile = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/stock/reconcile/apply", { allDiffs: true });
      return res.json() as Promise<{ applied: number; skipped: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/warehouses"] });
      toast({
        title: t("erp.warehouse.reconcileApplied"),
        description: t("erp.warehouse.reconcileAppliedResult", {
          applied: data.applied,
          skipped: data.skipped,
        }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const pushReconcileToShopware = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/stock/reconcile/push-to-shopware", { allDiffs: true });
      return res.json() as Promise<{
        updated: number;
        skipped: number;
        failed: number;
        errors?: string[];
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      toast({
        title: t("erp.warehouse.pushToShopwareDone"),
        description: t("erp.warehouse.pushToShopwareResult", {
          updated: data.updated,
          skipped: data.skipped,
          failed: data.failed,
        }),
        ...(data.failed > 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const pushInventoryToShopware = useMutation({
    mutationFn: async (countId: string) => {
      const res = await apiRequest("POST", `/api/erp/inventory-counts/${countId}/push-to-shopware`, {});
      return res.json() as Promise<{
        updated: number;
        skipped: number;
        failed: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      toast({
        title: t("erp.warehouse.pushToShopwareDone"),
        description: t("erp.warehouse.pushToShopwareResult", {
          updated: data.updated,
          skipped: data.skipped,
          failed: data.failed,
        }),
        ...(data.failed > 0 ? { variant: "destructive" as const } : {}),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const importFromShopware = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/stock/import-from-shopware", {});
      return res.json() as Promise<{
        applied: number;
        skipped: number;
        warehouseCode: string;
        mirrorRefreshed: boolean;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/warehouses"] });
      toast({
        title: t("erp.warehouse.importShopwareDone"),
        description: t("erp.warehouse.importShopwareResult", {
          applied: data.applied,
          skipped: data.skipped,
          warehouse: data.warehouseCode,
        }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const syncShopwareSales = useMutation({
    mutationFn: async (fullScan: boolean) => {
      const res = await apiRequest("POST", "/api/erp/stock/sync-shopware-sales", { fullScan });
      return res.json() as Promise<{
        bookedIssues: number;
        bookedCancels: number;
        skipped: number;
        processedOrders: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      toast({
        title: t("erp.warehouse.salesSyncDone"),
        description: t("erp.warehouse.salesSyncResult", {
          issues: data.bookedIssues,
          cancels: data.bookedCancels,
          skipped: data.skipped,
          orders: data.processedOrders,
        }),
      });
    },
    onError: (e: Error) => toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  const openCount = (id: string) => {
    setActiveCountId(id);
    setCountedDrafts({});
    setAddProductNumber("");
    setInventoryLineFilter("");
  };

  const saveCounted = (line: ErpInventoryCountLine) => {
    const raw = countedDrafts[line.id];
    const value = raw === undefined || raw === "" ? null : Number(raw);
    if (value == null || Number.isNaN(value)) {
      toast({
        title: t("errors.failed"),
        description: t("erp.warehouse.countedRequired"),
        variant: "destructive",
      });
      return;
    }
    updateLine.mutate({ lineId: line.id, countedQty: value });
  };

  const lineDiff = (line: ErpInventoryCountLine) => {
    const draft = countedDrafts[line.id];
    const counted =
      draft !== undefined && draft !== ""
        ? Number(draft)
        : line.countedQty;
    if (counted == null || Number.isNaN(counted)) return null;
    return counted - line.expectedQty;
  };

  const defaultStartWarehouse =
    startWarehouseId ||
    warehouses.find((w) => w.isDefault)?.id ||
    warehouses[0]?.id ||
    "";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Warehouse className="h-8 w-8" />
            {t("erp.warehouse.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.warehouse.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setMoveForm((prev) => ({
                ...prev,
                warehouseId: prev.warehouseId || defaultWarehouseId || "",
              }));
              setMoveOpen(true);
            }}
          >
            {t("erp.warehouse.bookMovement")}
          </Button>
          <Button onClick={() => setWhOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.warehouse.addWarehouse")}
          </Button>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList>
          <TabsTrigger value="stock">{t("erp.warehouse.stock")}</TabsTrigger>
          <TabsTrigger value="warehouses">{t("erp.warehouse.warehouses")}</TabsTrigger>
          <TabsTrigger value="locations">{t("erp.warehouse.locations")}</TabsTrigger>
          <TabsTrigger value="shelfTypes">{t("erp.warehouse.shelfTypes")}</TabsTrigger>
          <TabsTrigger value="movements">{t("erp.warehouse.movements")}</TabsTrigger>
          <TabsTrigger value="inventory">{t("erp.warehouse.inventory")}</TabsTrigger>
          <TabsTrigger value="reconcile">{t("erp.warehouse.reconcile")}</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <CardTitle>
                    {t("erp.warehouse.stock")}
                    {(reconcileData?.warehouseCode ||
                      (defaultWarehouseId && warehouseById.get(defaultWarehouseId))) && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        (
                        {reconcileData?.warehouseCode ||
                          warehouseById.get(defaultWarehouseId!)?.code}
                        )
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("erp.warehouse.stockHelp")}
                  </p>
                </div>
                <Button
                  disabled={importFromShopware.isPending || refreshReconcileMirror.isPending}
                  onClick={() => importFromShopware.mutate()}
                >
                  {t("erp.warehouse.importFromShopware")}
                </Button>
              </div>

              {stockViewRows.length > 0 ? (
                <div
                  className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 border-t pt-3"
                  data-testid="stock-stats"
                >
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.erpQty")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {qtyFmt.format(stockStats.erpQtyTotal)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("erp.warehouse.stockStats.skuWithStock", {
                        count: stockStats.skuWithErpStock,
                      })}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.salesValueNet")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {currencyFmt.format(stockStats.salesValueNet)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("erp.warehouse.stockStats.salesValueGrossHint", {
                        value: currencyFmt.format(stockStats.salesValueGross),
                      })}
                      {" · "}
                      {t("erp.warehouse.stockStats.salesValuePricedHint", {
                        count: stockStats.pricedSkuCount,
                      })}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.purchaseValue")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {currencyFmt.format(stockStats.purchaseValueNet)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("erp.warehouse.stockStats.purchaseValueHint", {
                        count: stockStats.purchasePricedSkuCount,
                      })}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.shopwareQty")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {qtyFmt.format(stockStats.shopwareQtyTotal)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("erp.warehouse.stockStats.diffs", { count: stockStats.diffs })}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.outOfStock")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {qtyFmt.format(stockStats.skuOutOfStock)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {t("erp.warehouse.stockStats.skuTotal", { count: stockStats.skuCount })}
                    </p>
                  </div>
                  <div className="rounded-md border bg-muted/30 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockStats.reserved")}
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {qtyFmt.format(stockStats.reservedTotal)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {`${t("erp.warehouse.stockStats.availablePrefix")} ${qtyFmt.format(
                        Math.max(0, stockStats.erpQtyTotal - stockStats.reservedTotal),
                      )}`}
                    </p>
                  </div>
                </div>
              ) : null}

              {stockViewRows.length > 0 ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
                    <div className="flex-1 min-w-[12rem]">
                      <Label className="text-xs">{t("erp.warehouse.stockSearch")}</Label>
                      <Input
                        value={stockSearch}
                        onChange={(e) => setStockSearch(e.target.value)}
                        placeholder={t("erp.warehouse.searchProduct")}
                        data-testid="stock-search"
                      />
                    </div>
                    <div className="w-full sm:w-40">
                      <Label className="text-xs">{t("erp.warehouse.stockFilterQty")}</Label>
                      <Select
                        value={stockQtyFilter}
                        onValueChange={(v) => setStockQtyFilter(v as StockQtyFilter)}
                      >
                        <SelectTrigger data-testid="stock-filter-qty">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("erp.warehouse.stockFilterAll")}</SelectItem>
                          <SelectItem value="in_stock">{t("erp.warehouse.stockFilterInStock")}</SelectItem>
                          <SelectItem value="out_of_stock">
                            {t("erp.warehouse.stockFilterOutOfStock")}
                          </SelectItem>
                          <SelectItem value="erp_positive">
                            {t("erp.warehouse.stockFilterErpPositive")}
                          </SelectItem>
                          <SelectItem value="erp_zero">{t("erp.warehouse.stockFilterErpZero")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full sm:w-44">
                      <Label className="text-xs">{t("erp.warehouse.stockFilterDiff")}</Label>
                      <Select
                        value={stockDiffFilter}
                        onValueChange={(v) => setStockDiffFilter(v as StockDiffFilter)}
                      >
                        <SelectTrigger data-testid="stock-filter-diff">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("erp.warehouse.stockFilterAll")}</SelectItem>
                          <SelectItem value="diff">{t("erp.warehouse.stockFilterHasDiff")}</SelectItem>
                          <SelectItem value="match">{t("erp.warehouse.stockFilterMatched")}</SelectItem>
                          <SelectItem value="only_shopware">
                            {t("erp.warehouse.stockFilterOnlyShopware")}
                          </SelectItem>
                          <SelectItem value="only_erp">
                            {t("erp.warehouse.stockFilterOnlyErp")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-full sm:w-36">
                      <Label className="text-xs">{t("erp.warehouse.stockFilterActive")}</Label>
                      <Select
                        value={stockActiveFilter}
                        onValueChange={(v) => setStockActiveFilter(v as StockActiveFilter)}
                      >
                        <SelectTrigger data-testid="stock-filter-active">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("erp.warehouse.stockFilterAll")}</SelectItem>
                          <SelectItem value="active">{t("erp.warehouse.stockFilterActiveOnly")}</SelectItem>
                          <SelectItem value="inactive">
                            {t("erp.warehouse.stockFilterInactiveOnly")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {stockFilterOptions.sizes.length > 0 ? (
                      <div className="w-full sm:w-32">
                        <Label className="text-xs">{t("erp.warehouse.stockFilterSize")}</Label>
                        <Select value={stockSizeFilter} onValueChange={setStockSizeFilter}>
                          <SelectTrigger data-testid="stock-filter-size">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("erp.warehouse.stockFilterAll")}</SelectItem>
                            {stockFilterOptions.sizes.map((size) => (
                              <SelectItem key={size} value={size}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    {stockFilterOptions.colors.length > 0 ? (
                      <div className="w-full sm:w-36">
                        <Label className="text-xs">{t("erp.warehouse.stockFilterColor")}</Label>
                        <Select value={stockColorFilter} onValueChange={setStockColorFilter}>
                          <SelectTrigger data-testid="stock-filter-color">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("erp.warehouse.stockFilterAll")}</SelectItem>
                            {stockFilterOptions.colors.map((color) => (
                              <SelectItem key={color} value={color}>
                                {color}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {t("erp.warehouse.stockFilterCount", {
                        shown: filteredStockRows.length,
                        total: stockViewRows.length,
                      })}
                    </p>
                    {stockFiltersActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={resetStockFilters}
                        data-testid="stock-filter-reset"
                      >
                        {t("erp.warehouse.stockFilterReset")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {reconcileLoading && stockViewRows.length === 0 ? (
                <p>{t("common.loading")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.product")}</TableHead>
                      <TableHead>{t("erp.warehouse.shopwareQty")}</TableHead>
                      <TableHead>{t("erp.warehouse.erpQty")}</TableHead>
                      <TableHead>{t("erp.warehouse.difference")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStockRows.map((row) => (
                      <TableRow key={row.productNumber}>
                        <TableCell>
                          <ErpProductCell
                            productNumber={row.productNumber}
                            label={resolveLabel(row.productNumber, row.label)}
                            showActiveToggle
                          />
                        </TableCell>
                        <TableCell>{row.shopwareQty == null ? "—" : row.shopwareQty}</TableCell>
                        <TableCell>{row.erpQty}</TableCell>
                        <TableCell>
                          {row.delta == null ? (
                            "—"
                          ) : row.delta === 0 ? (
                            <Badge variant="secondary">0</Badge>
                          ) : (
                            <Badge variant={row.delta < 0 ? "destructive" : "default"}>
                              {row.delta > 0 ? `+${row.delta}` : row.delta}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {stockViewRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          {t("erp.warehouse.stockEmptyHint")}
                        </TableCell>
                      </TableRow>
                    ) : filteredStockRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          {t("erp.warehouse.stockFilterNoMatches")}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses">
          <Card>
            <CardContent className="pt-6">
              {whLoading ? (
                <p>{t("common.loading")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.code")}</TableHead>
                      <TableHead>{t("erp.name")}</TableHead>
                      <TableHead>{t("erp.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouses.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell>{w.code}</TableCell>
                        <TableCell>{w.name}</TableCell>
                        <TableCell>
                          {w.isDefault ? <Badge>{t("erp.default")}</Badge> : null}{" "}
                          {w.active ? t("erp.active") : t("erp.inactive")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <CardTitle>{t("erp.warehouse.locations")}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("erp.warehouse.locationsHelp")}
                  </p>
                </div>
                <Button
                  onClick={openCreateLocation}
                  disabled={!effectiveLocationsWarehouseId}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("erp.warehouse.addLocation")}
                </Button>
              </div>
              <div className="max-w-sm">
                <Label>{t("erp.warehouse.selectWarehouse")}</Label>
                <select
                  className="w-full border rounded-md h-10 px-3 bg-background mt-1"
                  value={effectiveLocationsWarehouseId}
                  onChange={(e) => setLocationsWarehouseId(e.target.value)}
                >
                  {warehouses.length === 0 ? (
                    <option value="">{t("erp.select")}</option>
                  ) : null}
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {!effectiveLocationsWarehouseId ? (
                <p className="text-sm text-muted-foreground">{t("erp.select")}</p>
              ) : locationsLoading ? (
                <p>{t("common.loading")}</p>
              ) : locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("erp.warehouse.locationsEmpty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.code")}</TableHead>
                      <TableHead>{t("erp.warehouse.shelfType")}</TableHead>
                      <TableHead>{t("erp.warehouse.manufacturer")}</TableHead>
                      <TableHead>{t("erp.warehouse.regalzeile")}</TableHead>
                      <TableHead>{t("erp.warehouse.regalfeld")}</TableHead>
                      <TableHead>{t("erp.warehouse.regalfach")}</TableHead>
                      <TableHead>{t("erp.warehouse.regalplatz")}</TableHead>
                      <TableHead>{t("erp.status")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((loc) => {
                      const st = loc.shelfTypeId ? shelfTypeById.get(loc.shelfTypeId) : undefined;
                      return (
                        <TableRow key={loc.id}>
                          <TableCell className="font-mono">{loc.code}</TableCell>
                          <TableCell>
                            {st ? `${st.code} — ${st.name}` : t("erp.warehouse.noShelfType")}
                          </TableCell>
                          <TableCell>{st?.manufacturer ?? "—"}</TableCell>
                          <TableCell>{loc.regalzeile || "—"}</TableCell>
                          <TableCell>{loc.regalfeld || "—"}</TableCell>
                          <TableCell>{loc.regalfach || "—"}</TableCell>
                          <TableCell>{loc.regalplatz || "—"}</TableCell>
                          <TableCell>{loc.active ? t("erp.active") : t("erp.inactive")}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => openEditLocation(loc)}>
                              {t("common.edit")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shelfTypes">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <CardTitle>{t("erp.warehouse.shelfTypes")}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("erp.warehouse.shelfTypesHelp")}
                </p>
              </div>
              <Button onClick={openCreateShelfType}>
                <Plus className="h-4 w-4 mr-2" />
                {t("erp.warehouse.addShelfType")}
              </Button>
            </CardHeader>
            <CardContent>
              {shelfTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("erp.warehouse.shelfTypesEmpty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.code")}</TableHead>
                      <TableHead>{t("erp.name")}</TableHead>
                      <TableHead>{t("erp.warehouse.manufacturer")}</TableHead>
                      <TableHead>{t("erp.status")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shelfTypes.map((st) => (
                      <TableRow key={st.id}>
                        <TableCell className="font-mono">{st.code}</TableCell>
                        <TableCell>
                          <div>{st.name}</div>
                          {st.description ? (
                            <div className="text-xs text-muted-foreground">{st.description}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{st.manufacturer}</TableCell>
                        <TableCell>{st.active ? t("erp.active") : t("erp.inactive")}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => openEditShelfType(st)}>
                            {t("common.edit")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.product")}</TableHead>
                    <TableHead>{t("erp.quantity")}</TableHead>
                    <TableHead>{t("erp.type")}</TableHead>
                    <TableHead>{t("erp.date")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <ErpProductCell productNumber={m.productNumber} label={getLabel(m.productNumber)} />
                      </TableCell>
                      <TableCell>{m.quantity}</TableCell>
                      <TableCell>{m.movementType}</TableCell>
                      <TableCell>{new Date(m.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>{t("erp.warehouse.inventory")}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("erp.warehouse.inventoryHelp")}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                <div className="min-w-[200px]">
                  <Label className="text-xs">{t("erp.warehouse.warehouses")}</Label>
                  <select
                    className="w-full border rounded-md h-10 px-3 bg-background"
                    value={defaultStartWarehouse}
                    onChange={(e) => setStartWarehouseId(e.target.value)}
                  >
                    <option value="">{t("erp.select")}</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  size="sm"
                  disabled={!defaultStartWarehouse || createCount.isPending}
                  onClick={() => createCount.mutate(defaultStartWarehouse)}
                >
                  {t("erp.warehouse.startInventory")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.warehouse.warehouses")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead>{t("erp.date")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counts.map((c) => {
                    const wh = warehouseById.get(c.warehouseId);
                    return (
                      <TableRow key={c.id} className={activeCountId === c.id ? "bg-muted/40" : undefined}>
                        <TableCell>{wh ? `${wh.code} — ${wh.name}` : c.warehouseId.slice(0, 8)}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "completed" ? "secondary" : "default"}>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="space-x-2">
                          <Button size="sm" variant="outline" onClick={() => openCount(c.id)}>
                            {t("erp.warehouse.openInventory")}
                          </Button>
                          {c.status !== "completed" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => completeCount.mutate(c.id)}
                              disabled={completeCount.isPending}
                            >
                              {t("erp.complete")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => pushInventoryToShopware.mutate(c.id)}
                              disabled={pushInventoryToShopware.isPending}
                            >
                              {t("erp.warehouse.pushInventoryToShopware")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {counts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        {t("erp.empty")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {activeCountId ? (
            <Card>
              <CardHeader className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <CardTitle>{t("erp.warehouse.inventoryDetail")}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {activeCount
                        ? `${warehouseById.get(activeCount.warehouseId)?.code || "—"} · ${activeCount.status} · ${activeCount.lines?.length || 0} ${t("erp.warehouse.lines")}`
                        : t("common.loading")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!activeCount || activeCount.status === "completed" || seedFromStock.isPending}
                      onClick={() => seedFromStock.mutate(activeCountId)}
                    >
                      {t("erp.warehouse.seedFromStock")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        !activeCount || activeCount.status === "completed" || seedFromShopware.isPending
                      }
                      onClick={() => seedFromShopware.mutate(activeCountId)}
                    >
                      {t("erp.warehouse.seedFromShopware")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !activeCount || activeCount.status === "completed" || completeCount.isPending
                      }
                      onClick={() => completeCount.mutate(activeCountId)}
                    >
                      {t("erp.complete")}
                    </Button>
                  </div>
                </div>

                {activeCount && activeCount.status !== "completed" ? (
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end border-t pt-3">
                    <div className="flex-1">
                      <Label className="text-xs">{t("erp.warehouse.addProduct")}</Label>
                      <ErpProductAutocomplete
                        value={addProductNumber}
                        onChange={(productNumber) => setAddProductNumber(productNumber)}
                        onSelectProduct={(productNumber) => {
                          setAddProductNumber(productNumber);
                          addLine.mutate(productNumber);
                        }}
                        placeholder={t("erp.warehouse.searchProduct")}
                        testId="inventory-product-autocomplete"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setScannerOpen(true)}
                      data-testid="inventory-scan"
                    >
                      <ScanLine className="h-4 w-4 mr-1" />
                      {t("barcodeScan.scan")}
                    </Button>
                    <Button
                      onClick={() => addLine.mutate(addProductNumber)}
                      disabled={!addProductNumber.trim() || addLine.isPending}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {t("erp.warehouse.addLine")}
                    </Button>
                  </div>
                ) : null}

                {(activeCount?.lines?.length || 0) > 0 ? (
                  <div className="border-t pt-3">
                    <Label className="text-xs">{t("erp.warehouse.filterLines")}</Label>
                    <Input
                      value={inventoryLineFilter}
                      onChange={(e) => setInventoryLineFilter(e.target.value)}
                      placeholder={t("erp.warehouse.searchProduct")}
                      data-testid="inventory-line-filter"
                    />
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                {activeCountLoading ? (
                  <p>{t("common.loading")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("erp.product")}</TableHead>
                        <TableHead>{t("erp.warehouse.expectedQty")}</TableHead>
                        <TableHead>{t("erp.warehouse.countedQty")}</TableHead>
                        <TableHead>{t("erp.warehouse.difference")}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInventoryLines.map((line) => {
                        const diff = lineDiff(line);
                        const draftValue =
                          countedDrafts[line.id] ??
                          (line.countedQty == null ? "" : String(line.countedQty));
                        return (
                          <TableRow key={line.id}>
                            <TableCell>
                              <ErpProductCell
                                productNumber={line.productNumber}
                                label={resolveLabel(line.productNumber)}
                                showActiveToggle
                              />
                            </TableCell>
                            <TableCell>{line.expectedQty}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                className="w-28"
                                disabled={activeCount?.status === "completed"}
                                value={draftValue}
                                onChange={(e) =>
                                  setCountedDrafts((prev) => ({
                                    ...prev,
                                    [line.id]: e.target.value,
                                  }))
                                }
                              />
                            </TableCell>
                            <TableCell>
                              {diff == null ? (
                                "—"
                              ) : diff === 0 ? (
                                <Badge variant="secondary">0</Badge>
                              ) : (
                                <Badge variant={diff < 0 ? "destructive" : "default"}>
                                  {diff > 0 ? `+${diff}` : diff}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {activeCount?.status !== "completed" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={updateLine.isPending}
                                  onClick={() => saveCounted(line)}
                                >
                                  {t("common.save")}
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!activeCount?.lines?.length ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            {t("erp.warehouse.inventoryEmptyLines")}
                          </TableCell>
                        </TableRow>
                      ) : filteredInventoryLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            {t("erp.warehouse.filterNoMatches")}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="reconcile" className="space-y-4">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                <div>
                  <CardTitle>{t("erp.warehouse.reconcile")}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t("erp.warehouse.reconcileHelp")}
                  </p>
                  {reconcileData?.warehouseCode ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("erp.warehouse.reconcileWarehouse", {
                        code: reconcileData.warehouseCode,
                        name: reconcileData.warehouseName || reconcileData.warehouseCode,
                      })}
                    </p>
                  ) : null}
                  {reconcileTotals ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("erp.warehouse.reconcileTotals", {
                        compared: reconcileTotals.compared,
                        diffs: reconcileTotals.diffs,
                        onlyShopware: reconcileTotals.onlyShopware,
                        onlyErp: reconcileTotals.onlyErp,
                      })}
                      {(reconcileTotals as { skippedParents?: number }).skippedParents
                        ? ` · ${t("erp.warehouse.reconcileSkippedParents", {
                            count: (reconcileTotals as { skippedParents?: number }).skippedParents,
                          })}`
                        : null}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={refreshReconcileMirror.isPending}
                    onClick={() => refreshReconcileMirror.mutate()}
                  >
                    {t("erp.warehouse.reconcileRefreshMirror")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncShopwareSales.isPending}
                    onClick={() => syncShopwareSales.mutate(false)}
                  >
                    {t("erp.warehouse.salesSync")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncShopwareSales.isPending}
                    onClick={() => syncShopwareSales.mutate(true)}
                  >
                    {t("erp.warehouse.salesSyncFull")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      applyReconcile.isPending ||
                      reconcileRows.length === 0 ||
                      refreshReconcileMirror.isPending
                    }
                    onClick={() => applyReconcile.mutate()}
                  >
                    {t("erp.warehouse.reconcileApply")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      pushReconcileToShopware.isPending ||
                      reconcileRows.length === 0 ||
                      refreshReconcileMirror.isPending
                    }
                    onClick={() => pushReconcileToShopware.mutate()}
                  >
                    {t("erp.warehouse.pushToShopware")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {reconcileLoading || reconcileFetching ? (
                <p>{t("common.loading")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.product")}</TableHead>
                      <TableHead>{t("erp.warehouse.shopwareQty")}</TableHead>
                      <TableHead>{t("erp.warehouse.erpQty")}</TableHead>
                      <TableHead>{t("erp.warehouse.difference")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconcileRows.map((row) => (
                      <TableRow key={row.productNumber}>
                        <TableCell>
                          <ErpProductCell
                            productNumber={row.productNumber}
                            label={resolveLabel(row.productNumber, row.label)}
                            showActiveToggle
                          />
                        </TableCell>
                        <TableCell>{row.shopwareQty}</TableCell>
                        <TableCell>{row.erpQty}</TableCell>
                        <TableCell>
                          {row.delta === 0 ? (
                            <Badge variant="secondary">0</Badge>
                          ) : (
                            <Badge variant={row.delta < 0 ? "destructive" : "default"}>
                              {row.delta > 0 ? `+${row.delta}` : row.delta}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {reconcileRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          {t("erp.warehouse.reconcileEmpty")}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.warehouse.addWarehouse")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.code")}</Label>
              <Input value={whForm.code} onChange={(e) => setWhForm({ ...whForm, code: e.target.value })} />
            </div>
            <div>
              <Label>{t("erp.name")}</Label>
              <Input value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createWh.mutate()} disabled={!whForm.code || !whForm.name}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.warehouse.bookMovement")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={moveForm.warehouseId}
                onChange={(e) => setMoveForm({ ...moveForm, warehouseId: e.target.value })}
              >
                <option value="">{t("erp.select")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("erp.product")}</Label>
              <ErpProductAutocomplete
                value={moveForm.productNumber}
                onChange={(productNumber) => setMoveForm({ ...moveForm, productNumber })}
                placeholder={t("erp.warehouse.searchProduct")}
              />
            </div>
            <div>
              <Label>{t("erp.quantity")}</Label>
              <Input
                type="number"
                value={moveForm.quantity}
                onChange={(e) => setMoveForm({ ...moveForm, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>{t("erp.type")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={moveForm.movementType}
                onChange={(e) => setMoveForm({ ...moveForm, movementType: e.target.value })}
              >
                <option value="receipt">receipt</option>
                <option value="issue">issue</option>
                <option value="adjustment">adjustment</option>
                <option value="reservation">reservation</option>
                <option value="release">release</option>
              </select>
            </div>
            <div>
              <Label>{t("erp.reorderPoint")}</Label>
              <Input
                type="number"
                value={moveForm.reorderPoint}
                onChange={(e) => setMoveForm({ ...moveForm, reorderPoint: Number(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMove.mutate()}
              disabled={!moveForm.warehouseId || !moveForm.productNumber}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={locOpen} onOpenChange={(open) => {
        setLocOpen(open);
        if (!open) {
          setEditingLocationId(null);
          setLocForm(emptyLocForm);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingLocationId
                ? t("erp.warehouse.editLocation")
                : t("erp.warehouse.addLocation")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("erp.warehouse.regalzeile")}</Label>
                <Input
                  value={locForm.regalzeile}
                  onChange={(e) => setLocForm({ ...locForm, regalzeile: e.target.value })}
                  placeholder="A"
                />
              </div>
              <div>
                <Label>{t("erp.warehouse.regalfeld")}</Label>
                <Input
                  value={locForm.regalfeld}
                  onChange={(e) => setLocForm({ ...locForm, regalfeld: e.target.value })}
                  placeholder="01"
                />
              </div>
              <div>
                <Label>{t("erp.warehouse.regalfach")}</Label>
                <Input
                  value={locForm.regalfach}
                  onChange={(e) => setLocForm({ ...locForm, regalfach: e.target.value })}
                  placeholder="02"
                />
              </div>
              <div>
                <Label>{t("erp.warehouse.regalplatz")}</Label>
                <Input
                  value={locForm.regalplatz}
                  onChange={(e) => setLocForm({ ...locForm, regalplatz: e.target.value })}
                  placeholder="03"
                />
              </div>
            </div>
            <div>
              <Label>{t("erp.warehouse.locationCodePreview")}</Label>
              <Input
                value={locForm.code}
                onChange={(e) => setLocForm({ ...locForm, code: e.target.value })}
                placeholder={locationCodePreview || "A-01-02-03"}
              />
              {locationCodePreview ? (
                <p className="text-xs text-muted-foreground mt-1 font-mono">{locationCodePreview}</p>
              ) : null}
            </div>
            <div>
              <Label>{t("erp.name")}</Label>
              <Input
                value={locForm.name}
                onChange={(e) => setLocForm({ ...locForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.warehouse.shelfType")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={locForm.shelfTypeId}
                onChange={(e) => setLocForm({ ...locForm, shelfTypeId: e.target.value })}
              >
                <option value="">{t("erp.warehouse.noShelfType")}</option>
                {shelfTypes
                  .filter((s) => s.active || s.id === locForm.shelfTypeId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.manufacturer} · {s.code} — {s.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveLocation.mutate()}
              disabled={
                saveLocation.isPending ||
                (!locForm.code.trim() &&
                  !locForm.regalzeile.trim() &&
                  !locForm.regalfeld.trim() &&
                  !locForm.regalfach.trim() &&
                  !locForm.regalplatz.trim())
              }
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shelfTypeOpen} onOpenChange={(open) => {
        setShelfTypeOpen(open);
        if (!open) {
          setEditingShelfTypeId(null);
          setShelfForm(emptyShelfForm);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingShelfTypeId
                ? t("erp.warehouse.editShelfType")
                : t("erp.warehouse.addShelfType")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.warehouse.manufacturer")}</Label>
              <Input
                value={shelfForm.manufacturer}
                onChange={(e) => setShelfForm({ ...shelfForm, manufacturer: e.target.value })}
                placeholder="META"
              />
            </div>
            <div>
              <Label>{t("erp.code")}</Label>
              <Input
                value={shelfForm.code}
                onChange={(e) => setShelfForm({ ...shelfForm, code: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.name")}</Label>
              <Input
                value={shelfForm.name}
                onChange={(e) => setShelfForm({ ...shelfForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.warehouse.fieldDescription")}</Label>
              <Input
                value={shelfForm.description}
                onChange={(e) => setShelfForm({ ...shelfForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => saveShelfType.mutate()}
              disabled={saveShelfType.isPending || !shelfForm.code.trim() || !shelfForm.name.trim()}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeScannerDialog
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        onScan={(code) => void handleInventoryScan(code)}
        description={t("barcodeScan.inventoryDescription")}
      />
    </div>
  );
}
