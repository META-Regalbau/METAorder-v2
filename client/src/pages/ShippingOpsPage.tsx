import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ExternalLink, PackageCheck, Plus, Printer, ScanLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErpProductAutocomplete from "@/components/ErpProductAutocomplete";
import { ErpProductCell } from "@/components/ErpProductCell";
import { BarcodeScannerDialog } from "@/components/BarcodeScannerDialog";
import { normalizeScanCode } from "@/lib/barcode/normalizeScanCode";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";
import {
  BrowserPrintUnavailableError,
  printShippingLabelPdf,
} from "@/lib/zebra/browserPrint";

type ShippingOrder = {
  id: string;
  orderNumber: string;
  customerName?: string;
  items?: Array<{
    id?: string;
    name?: string;
    quantity?: number;
    productNumber?: string;
  }>;
};

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

type SendcloudSettings = {
  enabled: boolean;
  sandboxMode: boolean;
  defaultShippingMethodId: string | null;
  defaultShippingMethodCode: string | null;
  senderAddressId: string | null;
  hasPublicKey: boolean;
  hasSecretKey: boolean;
  publicKeyMasked?: string;
  secretKeyMasked?: string;
  testMethodHint?: string;
  activeProvider?: string;
  webhookUrl?: string;
  webhookDocs?: string;
};

type ShippingMethod = { id: string; code?: string; name: string; carrier?: string };

export default function ShippingOpsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [labelOpen, setLabelOpen] = useState(false);
  const [fromOrdersOpen, setFromOrdersOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [expandedPickIds, setExpandedPickIds] = useState<Set<string>>(() => new Set());
  const [scanPickListId, setScanPickListId] = useState<string | null>(null);
  const scanBusyRef = useRef(false);
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [labelOrderId, setLabelOrderId] = useState("");
  const [labelOrderSearch, setLabelOrderSearch] = useState("");
  const [labelForm, setLabelForm] = useState({
    packageWeight: 1,
    shippingMethodId: "",
  });
  const [scForm, setScForm] = useState({
    publicKey: "",
    secretKey: "",
    enabled: false,
    sandboxMode: true,
    defaultShippingMethodId: "",
    defaultShippingMethodCode: "",
  });
  const [pickForm, setPickForm] = useState({
    warehouseId: "",
    orderNumber: "",
    productNumber: "",
    quantity: 1,
  });

  const { data: labelData } = useQuery<{ labels: any[] }>({ queryKey: ["/api/erp/shipping-labels"] });
  const labels = labelData?.labels ?? [];
  const { data: pickData } = useQuery<{ pickLists: PickListRow[] }>({ queryKey: ["/api/erp/pick-lists"] });
  const pickLists = pickData?.pickLists ?? [];
  const { data: whData } = useQuery<{ warehouses: any[] }>({ queryKey: ["/api/erp/warehouses"] });
  const warehouses = whData?.warehouses ?? [];

  const { data: scData, refetch: refetchSc } = useQuery<{ settings: SendcloudSettings }>({
    queryKey: ["/api/erp/shipping-provider/sendcloud"],
  });
  const scSettings = scData?.settings;

  useEffect(() => {
    if (!scSettings) return;
    setScForm((prev) => ({
      ...prev,
      enabled: scSettings.enabled,
      sandboxMode: scSettings.sandboxMode,
      defaultShippingMethodId: scSettings.defaultShippingMethodId || "",
      defaultShippingMethodCode: scSettings.defaultShippingMethodCode || "",
      publicKey: "",
      secretKey: "",
    }));
  }, [scSettings]);

  const { data: methodsData } = useQuery<{ methods: ShippingMethod[] }>({
    queryKey: ["/api/erp/shipping-provider/sendcloud/methods"],
    enabled: !!(scSettings?.enabled && scSettings?.hasPublicKey && scSettings?.hasSecretKey),
    retry: false,
  });
  const shippingMethods = methodsData?.methods ?? [];

  const { data: shippingOrders = [], isLoading: shippingLoading, isError: shippingError } = useQuery<
    ShippingOrder[]
  >({
    queryKey: ["/api/shipping"],
    enabled: fromOrdersOpen || labelOpen,
  });

  const productNumbers = useMemo(
    () =>
      pickLists.flatMap((p) => (p.lines || []).map((l) => l.productNumber)).filter(Boolean),
    [pickLists],
  );
  const { getLabel } = useErpProductLabels(productNumbers);

  const warehouseById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses) {
      map.set(w.id, w.code || w.name || w.id);
    }
    return map;
  }, [warehouses]);

  const defaultWarehouseId = useMemo(() => {
    if (!warehouses.length) return "";
    const haupt = warehouses.find(
      (w) =>
        String(w.code || "").toLowerCase().includes("haupt") ||
        String(w.name || "").toLowerCase().includes("haupt"),
    );
    return (haupt || warehouses[0]).id as string;
  }, [warehouses]);

  useEffect(() => {
    if (!fromOrdersOpen) return;
    if (!fromWarehouseId && defaultWarehouseId) setFromWarehouseId(defaultWarehouseId);
  }, [fromOrdersOpen, fromWarehouseId, defaultWarehouseId]);

  useEffect(() => {
    if (!manualOpen) return;
    if (!pickForm.warehouseId && defaultWarehouseId) {
      setPickForm((prev) => ({ ...prev, warehouseId: defaultWarehouseId }));
    }
  }, [manualOpen, pickForm.warehouseId, defaultWarehouseId]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return shippingOrders;
    return shippingOrders.filter((o) => {
      const num = String(o.orderNumber || "").toLowerCase();
      const name = String(o.customerName || "").toLowerCase();
      return num.includes(q) || name.includes(q);
    });
  }, [shippingOrders, orderSearch]);

  const labelFilteredOrders = useMemo(() => {
    const q = labelOrderSearch.trim().toLowerCase();
    if (!q) return shippingOrders;
    return shippingOrders.filter((o) => {
      const num = String(o.orderNumber || "").toLowerCase();
      const name = String(o.customerName || "").toLowerCase();
      return num.includes(q) || name.includes(q);
    });
  }, [shippingOrders, labelOrderSearch]);

  const selectedOrders = useMemo(
    () => shippingOrders.filter((o) => selectedOrderIds.has(o.id)),
    [shippingOrders, selectedOrderIds],
  );

  const previewLines = useMemo(() => {
    const lines: Array<{ productNumber: string; quantity: number; orderNumber: string }> = [];
    for (const order of selectedOrders) {
      for (const item of order.items || []) {
        const productNumber = String(item.productNumber || "").trim();
        if (!productNumber) continue;
        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        lines.push({ productNumber, quantity, orderNumber: order.orderNumber });
      }
    }
    return lines;
  }, [selectedOrders]);

  const saveScSettings = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/erp/shipping-provider/sendcloud", {
        enabled: scForm.enabled,
        sandboxMode: scForm.sandboxMode,
        defaultShippingMethodId: scForm.defaultShippingMethodId || null,
        defaultShippingMethodCode: scForm.defaultShippingMethodCode || null,
        ...(scForm.publicKey.trim() ? { publicKey: scForm.publicKey.trim() } : {}),
        ...(scForm.secretKey.trim() ? { secretKey: scForm.secretKey.trim() } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/shipping-provider/sendcloud"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/shipping-provider/sendcloud/methods"] });
      setScForm((p) => ({ ...p, publicKey: "", secretKey: "" }));
      toast({ title: t("erp.saved") });
    },
    onError: (err: any) => toast({ title: err?.message || t("erp.shippingOps.settingsSaveError"), variant: "destructive" }),
  });

  const testSc = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/shipping-provider/sendcloud/test", {});
      return res.json() as Promise<{ ok: boolean; message: string; provider: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: data.ok ? t("erp.shippingOps.testOk") : t("erp.shippingOps.testFail"),
        description: `${data.provider}: ${data.message}`,
        variant: data.ok ? "default" : "destructive",
      });
    },
  });

  const createLabel = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/shipping-labels", {
        shopwareOrderId: labelOrderId,
        packageWeight: Number(labelForm.packageWeight),
        shippingMethodId: labelForm.shippingMethodId || undefined,
      });
      return res.json() as Promise<{ label: any }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/shipping-labels"] });
      setLabelOpen(false);
      setLabelOrderId("");
      toast({ title: t("erp.saved") });
      if (data.label?.id) {
        window.open(`/api/erp/shipping-labels/${data.label.id}/pdf`, "_blank");
      }
    },
    onError: (err: any) =>
      toast({ title: err?.message || t("erp.shippingOps.labelCreateError"), variant: "destructive" }),
  });

  const voidLabel = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/erp/shipping-labels/${id}/void`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/erp/shipping-labels"] }),
  });

  const printZebra = useMutation({
    mutationFn: async (id: string) => printShippingLabelPdf(id),
    onSuccess: (data) => {
      toast({
        title: t("erp.shippingOps.printZebraOk"),
        description: data.printerName || undefined,
      });
    },
    onError: (err: any) => {
      if (err instanceof BrowserPrintUnavailableError) {
        toast({
          title: t("erp.shippingOps.printZebraFail"),
          description: t("productLabels.browserPrintMissing"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("erp.shippingOps.printZebraFail"),
        description: err?.message || String(err),
        variant: "destructive",
      });
    },
  });

  const createFromOrders = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/erp/pick-lists/from-orders", {
        warehouseId: fromWarehouseId,
        orderIds: Array.from(selectedOrderIds),
      });
      return res.json() as Promise<{ skippedItems?: unknown[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      setFromOrdersOpen(false);
      setSelectedOrderIds(new Set());
      setOrderSearch("");
      const skipped = data.skippedItems?.length ?? 0;
      toast({
        title: t("erp.saved"),
        description: skipped > 0 ? t("erp.shippingOps.skippedItemsToast", { count: skipped }) : undefined,
      });
    },
    onError: (err: any) =>
      toast({ title: err?.message || t("erp.shippingOps.createFromOrdersError"), variant: "destructive" }),
  });

  const createPick = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/pick-lists", {
        warehouseId: pickForm.warehouseId || undefined,
        orderRefs: [{ orderNumber: pickForm.orderNumber }],
        lines: [
          {
            productNumber: pickForm.productNumber,
            quantity: Number(pickForm.quantity),
            orderNumber: pickForm.orderNumber,
          },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      setManualOpen(false);
      toast({ title: t("erp.saved") });
    },
  });

  const completePick = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/erp/pick-lists/${id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      toast({ title: t("erp.saved") });
    },
  });

  const cancelPick = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/erp/pick-lists/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      toast({ title: t("erp.saved") });
    },
  });

  const scanPickLine = useMutation({
    mutationFn: async (args: { pickListId: string; productNumber: string }) => {
      const res = await apiRequest("POST", `/api/erp/pick-lists/${args.pickListId}/scan`, {
        productNumber: args.productNumber,
      });
      return res.json() as Promise<{ line: PickListLine; completedLine: boolean }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/pick-lists"] });
      const pn = data.line.productNumber;
      const picked = data.line.pickedQuantity ?? 0;
      const qty = data.line.quantity;
      toast({
        title: data.completedLine
          ? t("barcodeScan.pickListLineDone", { productNumber: pn, picked, qty })
          : t("barcodeScan.pickListIncremented", { productNumber: pn, picked, qty }),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  async function handlePickListScan(code: string) {
    if (!scanPickListId || scanBusyRef.current) return;
    const pn = normalizeScanCode(code);
    if (!pn) return;
    scanBusyRef.current = true;
    try {
      await scanPickLine.mutateAsync({ pickListId: scanPickListId, productNumber: pn });
    } catch {
      // toast via mutation
    } finally {
      scanBusyRef.current = false;
    }
  }

  function toggleOrder(id: string, checked: boolean) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpandedPickIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatOrderRefs(refs?: Array<{ orderId?: string; orderNumber?: string }>) {
    if (!refs?.length) return "—";
    return refs
      .map((r) => r.orderNumber || r.orderId)
      .filter(Boolean)
      .join(", ");
  }

  function statusBadgeVariant(status: string): "success" | "warning" | "outline" | "destructive" {
    if (status === "completed") return "success";
    if (status === "cancelled") return "destructive";
    if (status === "open") return "warning";
    return "outline";
  }

  function labelStatusBadgeVariant(status: string): "success" | "warning" | "outline" | "destructive" | "secondary" {
    const s = String(status || "").toLowerCase();
    if (s === "delivered" || s.includes("print") || s.includes("active")) return "success";
    if (s === "void" || s.includes("cancel") || s.includes("return") || s.includes("error") || s.includes("fail")) {
      return "destructive";
    }
    if (
      s === "created" ||
      s === "in_transit" ||
      s.includes("transit") ||
      s.includes("delay") ||
      s.includes("pending") ||
      s.includes("process") ||
      s.includes("queue")
    ) {
      return "warning";
    }
    return "secondary";
  }

  function openPdf(labelId: string) {
    window.open(`/api/erp/shipping-labels/${labelId}/pdf`, "_blank");
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <PackageCheck className="h-8 w-8" />
            {t("erp.shippingOps.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.shippingOps.description")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => {
              setSelectedOrderIds(new Set());
              setOrderSearch("");
              setFromWarehouseId(defaultWarehouseId);
              setFromOrdersOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.shippingOps.addPickListFromOrders")}
          </Button>
          <Button variant="outline" onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.shippingOps.addPickListManual")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setLabelOrderId("");
              setLabelOrderSearch("");
              setLabelForm({
                packageWeight: 1,
                shippingMethodId: scSettings?.defaultShippingMethodId || "",
              });
              setLabelOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.shippingOps.addLabel")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="picks">
        <TabsList>
          <TabsTrigger value="picks">{t("erp.shippingOps.pickLists")}</TabsTrigger>
          <TabsTrigger value="labels">{t("erp.shippingOps.labels")}</TabsTrigger>
          <TabsTrigger value="settings">{t("erp.shippingOps.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="picks">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead>{t("erp.shippingOps.orders")}</TableHead>
                    <TableHead>{t("erp.warehouse.warehouses")}</TableHead>
                    <TableHead>{t("erp.shippingOps.lineCount")}</TableHead>
                    <TableHead>{t("erp.shippingOps.qtySum")}</TableHead>
                    <TableHead>{t("erp.shippingOps.createdAt")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pickLists.map((p) => {
                    const lines = p.lines || [];
                    const qtySum = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
                    const expanded = expandedPickIds.has(p.id);
                    return (
                      <Fragment key={p.id}>
                        <TableRow>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => toggleExpand(p.id)}
                              aria-label={expanded ? t("erp.shippingOps.collapse") : t("erp.shippingOps.expand")}
                            >
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(p.status)}>
                              {t(`erp.shippingOps.status.${p.status}`, { defaultValue: p.status })}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="flex flex-wrap gap-1">
                              {(p.orderRefs || []).length ? (
                                (p.orderRefs || []).map((ref, idx) => (
                                  <Badge key={`${p.id}-${ref.orderNumber || ref.orderId || idx}`} variant="outline">
                                    {ref.orderNumber || ref.orderId}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {p.warehouseId ? warehouseById.get(p.warehouseId) || p.warehouseId.slice(0, 8) : "—"}
                          </TableCell>
                          <TableCell>{lines.length}</TableCell>
                          <TableCell>{qtySum}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {p.createdAt ? new Date(p.createdAt).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="space-x-2 whitespace-nowrap">
                            {p.status === "open" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setExpandedPickIds((prev) => new Set(prev).add(p.id));
                                    setScanPickListId(p.id);
                                  }}
                                >
                                  <ScanLine className="h-4 w-4 mr-1" />
                                  {t("barcodeScan.scan")}
                                </Button>
                                <Button size="sm" onClick={() => completePick.mutate(p.id)}>
                                  {t("erp.complete")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => cancelPick.mutate(p.id)}>
                                  {t("erp.shippingOps.cancelPickList")}
                                </Button>
                              </>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30">
                              <div className="space-y-2 py-2">
                                <div className="text-sm font-medium">{t("erp.shippingOps.lines")}</div>
                                {lines.length ? (
                                  lines.map((line) => {
                                    const picked = line.pickedQuantity ?? 0;
                                    const done = picked >= line.quantity;
                                    const stockStatus = line.stockStatus ?? "out";
                                    const avail = line.stockAvailable ?? 0;
                                    return (
                                      <div
                                        key={line.id || `${line.productNumber}-${line.orderNumber}`}
                                        className="flex items-start gap-3 text-sm flex-wrap"
                                      >
                                        <ErpProductCell
                                          productNumber={line.productNumber}
                                          label={getLabel(line.productNumber)}
                                        />
                                        <span
                                          className={
                                            done
                                              ? "text-green-700 dark:text-green-400 whitespace-nowrap font-medium"
                                              : "text-muted-foreground whitespace-nowrap"
                                          }
                                        >
                                          {picked} / {line.quantity}
                                        </span>
                                        <Badge
                                          variant={
                                            stockStatus === "ok"
                                              ? "success"
                                              : stockStatus === "short"
                                                ? "warning"
                                                : "destructive"
                                          }
                                        >
                                          {stockStatus === "ok"
                                            ? t("erp.mobilePicking.stockOk", {
                                                available: avail,
                                                need: line.quantity,
                                              })
                                            : stockStatus === "short"
                                              ? t("erp.mobilePicking.stockShort", {
                                                  available: avail,
                                                  need: line.quantity,
                                                })
                                              : t("erp.mobilePicking.stockOut", {
                                                  need: line.quantity,
                                                })}
                                        </Badge>
                                        {line.orderNumber ? (
                                          <Badge variant="outline">{line.orderNumber}</Badge>
                                        ) : null}
                                      </div>
                                    );
                                  })
                                ) : (
                                  <span className="text-muted-foreground">{t("erp.empty")}</span>
                                )}
                                {p.status === "open" ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="mt-2"
                                    onClick={() => setScanPickListId(p.id)}
                                  >
                                    <ScanLine className="h-4 w-4 mr-1" />
                                    {t("barcodeScan.scan")}
                                  </Button>
                                ) : null}
                                <div className="text-xs text-muted-foreground font-mono">
                                  {formatOrderRefs(p.orderRefs)} · {p.id}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {pickLists.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-muted-foreground">
                        {t("erp.shippingOps.emptyPickLists")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labels">
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("erp.shippingOps.activeProviderHint", {
                  provider: scSettings?.activeProvider || "stub",
                })}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.orderNumber")}</TableHead>
                    <TableHead>{t("erp.carrier")}</TableHead>
                    <TableHead>{t("erp.tracking")}</TableHead>
                    <TableHead>{t("erp.shippingOps.provider")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead>{t("erp.shippingOps.carrierStatus")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labels.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.orderNumber || "—"}</TableCell>
                      <TableCell>{l.carrierCode}</TableCell>
                      <TableCell className="font-mono text-xs">{l.trackingNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{l.provider || "stub"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={labelStatusBadgeVariant(l.labelStatus)}>{l.labelStatus}</Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[180px]">
                        {l.carrierStatusMessage || l.carrierStatus || "—"}
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap">
                        {l.labelFilePath || l.labelUrl ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openPdf(l.id)}>
                              <Printer className="h-3.5 w-3.5 mr-1" />
                              {t("erp.shippingOps.printPdf")}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={printZebra.isPending}
                              onClick={() => printZebra.mutate(l.id)}
                            >
                              {t("erp.shippingOps.printZebra")}
                            </Button>
                          </>
                        ) : null}
                        {l.labelStatus !== "void" ? (
                          <Button size="sm" variant="outline" onClick={() => voidLabel.mutate(l.id)}>
                            {t("erp.shippingOps.void")}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {labels.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-muted-foreground">
                        {t("erp.empty")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardContent className="pt-6 space-y-4 max-w-xl">
              <div>
                <h2 className="text-lg font-semibold">{t("erp.shippingOps.sendcloudTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t("erp.shippingOps.sendcloudHint")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={scForm.enabled}
                  onCheckedChange={(v) => setScForm({ ...scForm, enabled: v === true })}
                  id="sc-enabled"
                />
                <Label htmlFor="sc-enabled">{t("erp.shippingOps.enabled")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={scForm.sandboxMode}
                  onCheckedChange={(v) => setScForm({ ...scForm, sandboxMode: v === true })}
                  id="sc-sandbox"
                />
                <Label htmlFor="sc-sandbox">{t("erp.shippingOps.sandboxMode")}</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("erp.shippingOps.testMethodHint", {
                  code: scSettings?.testMethodHint || "sendcloud:letter",
                })}
              </p>
              <div>
                <Label>{t("erp.shippingOps.publicKey")}</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={scSettings?.hasPublicKey ? "••••••••" : ""}
                  value={scForm.publicKey}
                  onChange={(e) => setScForm({ ...scForm, publicKey: e.target.value })}
                />
              </div>
              <div>
                <Label>{t("erp.shippingOps.secretKey")}</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={scSettings?.hasSecretKey ? "••••••••" : ""}
                  value={scForm.secretKey}
                  onChange={(e) => setScForm({ ...scForm, secretKey: e.target.value })}
                />
              </div>
              {shippingMethods.length > 0 ? (
                <div>
                  <Label>{t("erp.shippingOps.defaultMethod")}</Label>
                  <select
                    className="w-full border rounded-md h-10 px-3 bg-background"
                    value={scForm.defaultShippingMethodId}
                    onChange={(e) => {
                      const m = shippingMethods.find((x) => x.id === e.target.value);
                      setScForm({
                        ...scForm,
                        defaultShippingMethodId: e.target.value,
                        defaultShippingMethodCode: m?.code || "",
                      });
                    }}
                  >
                    <option value="">{t("erp.select")}</option>
                    {shippingMethods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.carrier ? ` (${m.carrier})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => saveScSettings.mutate()} disabled={saveScSettings.isPending}>
                  {t("common.save")}
                </Button>
                <Button variant="outline" onClick={() => testSc.mutate()} disabled={testSc.isPending}>
                  {t("erp.shippingOps.testConnection")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => refetchSc()}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  {t("common.refresh")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("erp.shippingOps.activeProviderHint", {
                  provider: scSettings?.activeProvider || "stub",
                })}
              </p>
              <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                <div className="text-sm font-medium">{t("erp.shippingOps.webhookTitle")}</div>
                <p className="text-xs text-muted-foreground">{t("erp.shippingOps.webhookHint")}</p>
                {scSettings?.webhookUrl ? (
                  <div className="flex gap-2 items-start">
                    <Input readOnly value={scSettings.webhookUrl} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(scSettings.webhookUrl || "");
                          toast({ title: t("erp.shippingOps.webhookCopied") });
                        } catch {
                          toast({ title: t("erp.shippingOps.webhookCopyFail"), variant: "destructive" });
                        }
                      }}
                    >
                      {t("erp.shippingOps.copyWebhook")}
                    </Button>
                  </div>
                ) : null}
                {scSettings?.webhookDocs ? (
                  <a
                    href={scSettings.webhookDocs}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary underline inline-flex items-center gap-1"
                  >
                    {t("erp.shippingOps.webhookDocsLink")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={labelOpen}
        onOpenChange={(open) => {
          setLabelOpen(open);
          if (!open) setLabelOrderId("");
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("erp.shippingOps.addLabel")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.shippingOps.searchOrders")}</Label>
              <Input
                value={labelOrderSearch}
                onChange={(e) => setLabelOrderSearch(e.target.value)}
                placeholder={t("erp.shippingOps.searchOrdersPlaceholder")}
              />
            </div>
            <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
              {shippingLoading ? (
                <div className="p-3 text-sm text-muted-foreground">{t("common.loading")}</div>
              ) : null}
              {shippingError ? (
                <div className="p-3 text-sm text-destructive">{t("erp.shippingOps.shippingLoadError")}</div>
              ) : null}
              {!shippingLoading && !shippingError && labelFilteredOrders.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">{t("erp.shippingOps.noShippingOrders")}</div>
              ) : null}
              {labelFilteredOrders.map((order) => (
                <label
                  key={order.id}
                  className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/40"
                >
                  <input
                    type="radio"
                    name="label-order"
                    className="mt-1"
                    checked={labelOrderId === order.id}
                    onChange={() => setLabelOrderId(order.id)}
                  />
                  <div className="min-w-0">
                    <div className="font-medium">{order.orderNumber}</div>
                    <div className="text-sm text-muted-foreground truncate">{order.customerName || "—"}</div>
                  </div>
                </label>
              ))}
            </div>
            <div>
              <Label>{t("erp.weight")}</Label>
              <Input
                type="number"
                step="0.01"
                min={0.01}
                value={labelForm.packageWeight}
                onChange={(e) => setLabelForm({ ...labelForm, packageWeight: Number(e.target.value) })}
              />
            </div>
            {shippingMethods.length > 0 ? (
              <div>
                <Label>{t("erp.shippingOps.shippingMethod")}</Label>
                <select
                  className="w-full border rounded-md h-10 px-3 bg-background"
                  value={labelForm.shippingMethodId}
                  onChange={(e) => setLabelForm({ ...labelForm, shippingMethodId: e.target.value })}
                >
                  <option value="">{t("erp.select")}</option>
                  {shippingMethods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("erp.shippingOps.stubLabelHint")}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!labelOrderId || createLabel.isPending}
              onClick={() => createLabel.mutate()}
            >
              {t("erp.shippingOps.createAndPrint")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={fromOrdersOpen}
        onOpenChange={(open) => {
          setFromOrdersOpen(open);
          if (!open) {
            setSelectedOrderIds(new Set());
            setOrderSearch("");
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("erp.shippingOps.addPickListFromOrders")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
              >
                <option value="">{t("erp.select")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                    {w.name ? ` — ${w.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("erp.shippingOps.searchOrders")}</Label>
              <Input
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder={t("erp.shippingOps.searchOrdersPlaceholder")}
              />
            </div>
            <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
              {shippingLoading ? (
                <div className="p-3 text-sm text-muted-foreground">{t("common.loading")}</div>
              ) : null}
              {shippingError ? (
                <div className="p-3 text-sm text-destructive">{t("erp.shippingOps.shippingLoadError")}</div>
              ) : null}
              {!shippingLoading && !shippingError && filteredOrders.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">{t("erp.shippingOps.noShippingOrders")}</div>
              ) : null}
              {filteredOrders.map((order) => {
                const checked = selectedOrderIds.has(order.id);
                const itemCount = (order.items || []).filter((i) => String(i.productNumber || "").trim()).length;
                return (
                  <label
                    key={order.id}
                    className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleOrder(order.id, v === true)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{order.orderNumber}</div>
                      <div className="text-sm text-muted-foreground truncate">{order.customerName || "—"}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t("erp.shippingOps.orderItemHint", { count: itemCount })}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="rounded-md border p-3 space-y-2 bg-muted/20">
              <div className="text-sm font-medium">
                {t("erp.shippingOps.preview", {
                  orders: selectedOrders.length,
                  lines: previewLines.length,
                })}
              </div>
              {selectedOrders.length ? (
                <div className="flex flex-wrap gap-1">
                  {selectedOrders.map((o) => (
                    <Badge key={o.id} variant="outline">
                      {o.orderNumber}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("erp.shippingOps.selectOrdersHint")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFromOrdersOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                !fromWarehouseId ||
                selectedOrderIds.size === 0 ||
                previewLines.length === 0 ||
                createFromOrders.isPending
              }
              onClick={() => createFromOrders.mutate()}
            >
              {t("erp.shippingOps.createPickList")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.shippingOps.addPickListManual")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={pickForm.warehouseId}
                onChange={(e) => setPickForm({ ...pickForm, warehouseId: e.target.value })}
              >
                <option value="">{t("erp.select")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("erp.orderNumber")}</Label>
              <Input
                value={pickForm.orderNumber}
                onChange={(e) => setPickForm({ ...pickForm, orderNumber: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.product")}</Label>
              <ErpProductAutocomplete
                value={pickForm.productNumber}
                onChange={(productNumber) => setPickForm({ ...pickForm, productNumber })}
                placeholder={t("erp.warehouse.searchProduct")}
              />
            </div>
            <div>
              <Label>{t("erp.quantity")}</Label>
              <Input
                type="number"
                value={pickForm.quantity}
                onChange={(e) => setPickForm({ ...pickForm, quantity: Number(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createPick.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BarcodeScannerDialog
        open={Boolean(scanPickListId)}
        onOpenChange={(open) => {
          if (!open) setScanPickListId(null);
        }}
        onScan={(code) => void handlePickListScan(code)}
        description={t("barcodeScan.pickListDescription")}
      />
    </div>
  );
}
