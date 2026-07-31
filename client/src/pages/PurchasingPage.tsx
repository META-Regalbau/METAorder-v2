import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShoppingCart, Plus, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErpProductAutocomplete from "@/components/ErpProductAutocomplete";
import { ErpProductCell } from "@/components/ErpProductCell";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

function getPoStatusBadgeVariant(status: string): "secondary" | "warning" | "success" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary";
    case "ordered":
    case "partial":
      return "warning";
    case "received":
    case "completed":
      return "success";
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

type ImportPreview = {
  mode: "apply" | "dry-run";
  totalRows: number;
  matched: number;
  unmatched: number;
  imported: number;
  errors: number;
  rows: Array<{
    productNumber: string;
    unitPrice: number;
    catalogMatch: "matched" | "unmatched";
    status: string;
  }>;
};

export default function PurchasingPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [priceListSupplierId, setPriceListSupplierId] = useState("");
  const [priceListFile, setPriceListFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ number: "", name: "", email: "" });
  const [poForm, setPoForm] = useState({
    supplierId: "",
    warehouseId: "",
    productNumber: "",
    quantity: 1,
    unitPrice: 0,
  });

  const { data: suppliersData } = useQuery<{ suppliers: any[] }>({ queryKey: ["/api/erp/suppliers"] });
  const suppliers = suppliersData?.suppliers ?? [];
  const { data: poData } = useQuery<{ purchaseOrders: any[] }>({ queryKey: ["/api/erp/purchase-orders"] });
  const purchaseOrders = poData?.purchaseOrders ?? [];
  const { data: whData } = useQuery<{ warehouses: any[] }>({ queryKey: ["/api/erp/warehouses"] });
  const warehouses = whData?.warehouses ?? [];
  const { data: reorderData } = useQuery<{ suggestions: any[] }>({ queryKey: ["/api/erp/reorder-suggestions"] });
  const suggestions = reorderData?.suggestions ?? [];
  const { data: invData } = useQuery<{ invoices: any[] }>({ queryKey: ["/api/erp/supplier-invoices"] });
  const invoices = invData?.invoices ?? [];

  const { data: activePriceListData } = useQuery<{ priceList: any }>({
    queryKey: ["/api/erp/suppliers", priceListSupplierId, "price-list"],
    enabled: !!priceListSupplierId && priceListOpen,
    queryFn: async () => {
      const res = await fetch(`/api/erp/suppliers/${priceListSupplierId}/price-list`, {
        credentials: "include",
      });
      if (res.status === 404) return { priceList: null };
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const activePriceList = activePriceListData?.priceList;

  const reorderNumbers = useMemo(
    () => suggestions.map((s: any) => s.productNumber).filter(Boolean),
    [suggestions],
  );
  const poProductNumbers = useMemo(
    () =>
      purchaseOrders.flatMap((po: any) => (po.lines || []).map((l: any) => l.productNumber)).filter(Boolean),
    [purchaseOrders],
  );
  const priceListNumbers = useMemo(
    () => (activePriceList?.lines || []).map((l: any) => l.productNumber).filter(Boolean),
    [activePriceList],
  );
  const previewNumbers = useMemo(
    () => (importPreview?.rows || []).map((r) => r.productNumber).filter(Boolean),
    [importPreview],
  );
  const { getLabel } = useErpProductLabels([
    ...reorderNumbers,
    ...poProductNumbers,
    ...priceListNumbers,
    ...previewNumbers,
    poForm.productNumber,
  ]);

  const createSupplier = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/erp/suppliers", supplierForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/suppliers"] });
      setSupplierOpen(false);
      toast({ title: t("erp.saved") });
    },
  });

  const createPo = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/purchase-orders", {
        supplierId: poForm.supplierId,
        warehouseId: poForm.warehouseId || undefined,
        lines: [
          {
            productNumber: poForm.productNumber,
            quantity: Number(poForm.quantity),
            unitPrice: Number(poForm.unitPrice),
          },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/purchase-orders"] });
      setPoOpen(false);
      toast({ title: t("erp.saved") });
    },
  });

  const setPoStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("POST", `/api/erp/purchase-orders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/erp/purchase-orders"] }),
  });

  const receivePo = useMutation({
    mutationFn: async (po: any) => {
      const detail = await fetch(`/api/erp/purchase-orders/${po.id}`).then((r) => r.json());
      const lines = (detail.purchaseOrder?.lines || [])
        .map((l: any) => ({
          purchaseOrderLineId: l.id,
          productNumber: l.productNumber,
          quantity: Math.max(0, l.quantity - (l.receivedQuantity || 0)) || l.quantity,
        }))
        .filter((l: any) => l.quantity > 0);
      const warehouseId = po.warehouseId || warehouses[0]?.id;
      if (!warehouseId) throw new Error("No warehouse");
      return apiRequest("POST", "/api/erp/goods-receipts", {
        purchaseOrderId: po.id,
        warehouseId,
        lines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/reorder-suggestions"] });
      toast({ title: t("erp.purchasing.goodsReceiptDone") });
    },
  });

  const createInvoice = useMutation({
    mutationFn: async (po: any) =>
      apiRequest("POST", "/api/erp/supplier-invoices", {
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        number: `LI-${po.number}`,
        amountNet: 100,
        amountGross: 119,
        invoiceDate: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/open-items"] });
      toast({ title: t("erp.saved") });
    },
  });

  const lookupPrice = async (supplierId: string, productNumber: string) => {
    if (!supplierId || !productNumber.trim()) return;
    try {
      const params = new URLSearchParams({ productNumber: productNumber.trim() });
      const res = await fetch(
        `/api/erp/suppliers/${supplierId}/price-list/lookup?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.unitPrice != null) {
        setPoForm((prev) => ({ ...prev, unitPrice: Number(json.unitPrice) }));
      }
    } catch {
      /* ignore */
    }
  };

  const runPriceListImport = async (apply: boolean) => {
    if (!priceListSupplierId || !priceListFile) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", priceListFile);
      fd.append("apply", apply ? "true" : "false");
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-CSRF-Token"] = csrf;
      const res = await fetch(`/api/erp/suppliers/${priceListSupplierId}/price-list/import`, {
        method: "POST",
        credentials: "include",
        headers,
        body: fd,
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try {
          msg = JSON.parse(text)?.error || text;
        } catch {
          /* keep */
        }
        throw new Error(msg || res.statusText);
      }
      const result = JSON.parse(text) as ImportPreview;
      setImportPreview(result);
      if (apply) {
        queryClient.invalidateQueries({
          queryKey: ["/api/erp/suppliers", priceListSupplierId, "price-list"],
        });
        toast({ title: t("erp.purchasing.priceList.appliedToast") });
      }
    } catch (e: any) {
      toast({
        title: t("erp.purchasing.priceList.importError"),
        description: e?.message,
        variant: "destructive",
      });
    } finally {
      setImportBusy(false);
    }
  };

  const openPriceList = (supplierId: string) => {
    setPriceListSupplierId(supplierId);
    setPriceListFile(null);
    setImportPreview(null);
    setPriceListOpen(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-8 w-8" />
            {t("erp.purchasing.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.purchasing.description")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSupplierOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.purchasing.addSupplier")}
          </Button>
          <Button onClick={() => setPoOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.purchasing.addPo")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">{t("erp.purchasing.orders")}</TabsTrigger>
          <TabsTrigger value="suppliers">{t("erp.purchasing.suppliers")}</TabsTrigger>
          <TabsTrigger value="reorder">{t("erp.purchasing.reorder")}</TabsTrigger>
          <TabsTrigger value="invoices">{t("erp.purchasing.invoices")}</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.number")}</TableHead>
                    <TableHead>{t("erp.product")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseOrders.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell>{po.number}</TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          {(po.lines || []).map((line: any) => (
                            <div key={line.id || line.productNumber} className="flex items-start gap-2">
                              <ErpProductCell
                                productNumber={line.productNumber}
                                label={getLabel(line.productNumber)}
                              />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                × {line.quantity}
                              </span>
                            </div>
                          ))}
                          {!(po.lines || []).length ? "—" : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getPoStatusBadgeVariant(po.status)}>{po.status}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        {po.status === "draft" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPoStatus.mutate({ id: po.id, status: "ordered" })}
                          >
                            {t("erp.purchasing.order")}
                          </Button>
                        ) : null}
                        {["ordered", "partial"].includes(po.status) ? (
                          <Button size="sm" onClick={() => receivePo.mutate(po)}>
                            {t("erp.purchasing.receive")}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => createInvoice.mutate(po)}>
                          {t("erp.purchasing.createInvoice")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchaseOrders.length === 0 ? (
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
        </TabsContent>

        <TabsContent value="suppliers">
          <Card>
            <CardHeader>
              <CardTitle>{t("erp.purchasing.suppliers")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.number")}</TableHead>
                    <TableHead>{t("erp.name")}</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.number}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.email}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => openPriceList(s.id)}>
                          <Upload className="h-3.5 w-3.5 mr-1" />
                          {t("erp.purchasing.priceList.action")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {suppliers.length === 0 ? (
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
        </TabsContent>

        <TabsContent value="reorder">
          <Card>
            <CardHeader>
              <CardTitle>{t("erp.purchasing.reorder")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.product")}</TableHead>
                    <TableHead>{t("erp.quantity")}</TableHead>
                    <TableHead>{t("erp.reorderPoint")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <ErpProductCell productNumber={s.productNumber} label={getLabel(s.productNumber)} />
                      </TableCell>
                      <TableCell>{s.quantity - s.reservedQuantity}</TableCell>
                      <TableCell>{s.reorderPoint}</TableCell>
                    </TableRow>
                  ))}
                  {suggestions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-muted-foreground">
                        {t("erp.purchasing.noReorder")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.number")}</TableHead>
                    <TableHead>{t("erp.amount")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.number}</TableCell>
                      <TableCell>{inv.amountGross?.toFixed?.(2) ?? inv.amountGross}</TableCell>
                      <TableCell>{inv.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.purchasing.addSupplier")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.number")}</Label>
              <Input
                value={supplierForm.number}
                onChange={(e) => setSupplierForm({ ...supplierForm, number: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.name")}</Label>
              <Input
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>E-Mail</Label>
              <Input
                value={supplierForm.email}
                onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createSupplier.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.purchasing.addPo")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.purchasing.suppliers")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={poForm.supplierId}
                onChange={(e) => {
                  const supplierId = e.target.value;
                  setPoForm({ ...poForm, supplierId });
                  if (poForm.productNumber) void lookupPrice(supplierId, poForm.productNumber);
                }}
              >
                <option value="">{t("erp.select")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={poForm.warehouseId}
                onChange={(e) => setPoForm({ ...poForm, warehouseId: e.target.value })}
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
              <Label>{t("erp.product")}</Label>
              <ErpProductAutocomplete
                value={poForm.productNumber}
                onChange={(productNumber) => {
                  setPoForm((prev) => ({ ...prev, productNumber }));
                  void lookupPrice(poForm.supplierId, productNumber);
                }}
              />
            </div>
            <div>
              <Label>{t("erp.quantity")}</Label>
              <Input
                type="number"
                value={poForm.quantity}
                onChange={(e) => setPoForm({ ...poForm, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>{t("erp.unitPrice")}</Label>
              <Input
                type="number"
                value={poForm.unitPrice}
                onChange={(e) => setPoForm({ ...poForm, unitPrice: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground mt-1">{t("erp.purchasing.priceList.priceHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createPo.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={priceListOpen}
        onOpenChange={(open) => {
          setPriceListOpen(open);
          if (!open) {
            setImportPreview(null);
            setPriceListFile(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("erp.purchasing.priceList.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("erp.purchasing.priceList.hint")}</p>
            {activePriceList ? (
              <p className="text-sm">
                {t("erp.purchasing.priceList.current", {
                  count: activePriceList.lines?.length ?? 0,
                  file: activePriceList.sourceFilename || "—",
                })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("erp.purchasing.priceList.empty")}</p>
            )}
            <div>
              <Label>{t("erp.purchasing.priceList.file")}</Label>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  setPriceListFile(e.target.files?.[0] || null);
                  setImportPreview(null);
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!priceListFile || importBusy}
                onClick={() => void runPriceListImport(false)}
              >
                {t("erp.purchasing.priceList.dryRun")}
              </Button>
              <Button
                disabled={!priceListFile || importBusy}
                onClick={() => void runPriceListImport(true)}
              >
                {t("erp.purchasing.priceList.apply")}
              </Button>
            </div>
            {importPreview ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {importPreview.mode === "apply"
                    ? t("erp.purchasing.priceList.resultApplied")
                    : t("erp.purchasing.priceList.resultPreview")}{" "}
                  — {importPreview.totalRows} {t("erp.purchasing.priceList.rows")},{" "}
                  {importPreview.matched} {t("erp.purchasing.priceList.matched")},{" "}
                  {importPreview.unmatched} {t("erp.purchasing.priceList.unmatched")}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("erp.product")}</TableHead>
                      <TableHead>{t("erp.unitPrice")}</TableHead>
                      <TableHead>{t("erp.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.slice(0, 50).map((r) => (
                      <TableRow key={r.productNumber}>
                        <TableCell>
                          <ErpProductCell
                            productNumber={r.productNumber}
                            label={getLabel(r.productNumber)}
                          />
                        </TableCell>
                        <TableCell>{r.unitPrice}</TableCell>
                        <TableCell>
                          <Badge variant={r.catalogMatch === "matched" ? "success" : "destructive"}>
                            {r.catalogMatch === "matched"
                              ? t("erp.purchasing.priceList.matched")
                              : t("erp.purchasing.priceList.unmatched")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {importPreview.rows.length > 50 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("erp.purchasing.priceList.moreRows", {
                      count: importPreview.rows.length - 50,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
