import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Factory, Plus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErpProductAutocomplete from "@/components/ErpProductAutocomplete";
import { ErpProductCell } from "@/components/ErpProductCell";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";

type BomLineForm = { productNumber: string; quantity: number };

const emptyOrderForm = () => ({
  productNumber: "",
  quantity: 1,
  warehouseId: "",
  materials: [{ productNumber: "", quantity: 1 }] as BomLineForm[],
  bomHint: null as "loaded" | "missing" | null,
});

const emptyBomForm = () => ({
  id: null as string | null,
  productNumber: "",
  name: "",
  notes: "",
  lines: [{ productNumber: "", quantity: 1 }] as BomLineForm[],
});

function getProductionOrderStatusBadgeVariant(status: string): "secondary" | "warning" | "success" {
  switch (status) {
    case "planned":
      return "secondary";
    case "released":
    case "in_progress":
      return "warning";
    case "completed":
      return "success";
    default:
      return "secondary";
  }
}

export default function ProductionPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [bomOpen, setBomOpen] = useState(false);
  const [bomForm, setBomForm] = useState(emptyBomForm);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomSupplierId, setBomSupplierId] = useState("");
  const [bomPriceSearch, setBomPriceSearch] = useState("");
  const [bomSelectedFromList, setBomSelectedFromList] = useState<Set<string>>(new Set());

  const { data } = useQuery<{ productionOrders: any[] }>({ queryKey: ["/api/erp/production-orders"] });
  const orders = data?.productionOrders ?? [];
  const { data: mrpData } = useQuery<{ suggestions: any[] }>({ queryKey: ["/api/erp/mrp-suggestions"] });
  const suggestions = mrpData?.suggestions ?? [];
  const { data: whData } = useQuery<{ warehouses: any[] }>({ queryKey: ["/api/erp/warehouses"] });
  const warehouses = whData?.warehouses ?? [];
  const { data: bomData } = useQuery<{ boms: any[] }>({ queryKey: ["/api/erp/boms"] });
  const boms = bomData?.boms ?? [];
  const { data: suppliersData } = useQuery<{ suppliers: any[] }>({
    queryKey: ["/api/erp/suppliers"],
    enabled: bomOpen,
  });
  const suppliers = suppliersData?.suppliers ?? [];
  const { data: priceProductsData } = useQuery<{ products: any[] }>({
    queryKey: ["/api/erp/suppliers", bomSupplierId, "price-list", "products", bomPriceSearch],
    enabled: bomOpen && !!bomSupplierId,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (bomPriceSearch.trim()) params.set("search", bomPriceSearch.trim());
      const res = await fetch(
        `/api/erp/suppliers/${bomSupplierId}/price-list/products?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const priceProducts = priceProductsData?.products ?? [];

  const labelNumbers = useMemo(
    () =>
      [
        ...orders.map((o: any) => o.productNumber),
        ...suggestions.map((s: any) => s.productNumber),
        ...boms.map((b: any) => b.productNumber),
        ...orderForm.materials.map((m) => m.productNumber),
        ...bomForm.lines.map((m) => m.productNumber),
        ...priceProducts.map((p: any) => p.productNumber),
        orderForm.productNumber,
        bomForm.productNumber,
      ].filter(Boolean),
    [orders, suggestions, boms, orderForm, bomForm, priceProducts],
  );
  const { getLabel } = useErpProductLabels(labelNumbers);

  const loadBomForProduct = async (productNumber: string) => {
    const pn = productNumber.trim();
    if (!pn) {
      setOrderForm((prev) => ({ ...prev, productNumber: "", materials: [], bomHint: null }));
      return;
    }
    setBomLoading(true);
    try {
      const res = await fetch(`/api/erp/boms/by-product/${encodeURIComponent(pn)}`, {
        credentials: "include",
      });
      if (res.status === 404) {
        setOrderForm((prev) => ({
          ...prev,
          productNumber: pn,
          materials: [{ productNumber: "", quantity: 1 }],
          bomHint: "missing",
        }));
        return;
      }
      if (!res.ok) throw new Error("BOM load failed");
      const json = await res.json();
      const lines = (json.bom?.lines ?? []).map((l: any) => ({
        productNumber: l.productNumber,
        quantity: Number(l.quantity) || 1,
      }));
      setOrderForm((prev) => ({
        ...prev,
        productNumber: pn,
        materials: lines.length ? lines : [{ productNumber: "", quantity: 1 }],
        bomHint: "loaded",
      }));
    } catch {
      setOrderForm((prev) => ({
        ...prev,
        productNumber: pn,
        bomHint: "missing",
        materials: prev.materials.length ? prev.materials : [{ productNumber: "", quantity: 1 }],
      }));
      toast({ title: t("erp.production.bom.loadError"), variant: "destructive" });
    } finally {
      setBomLoading(false);
    }
  };

  const createOrder = useMutation({
    mutationFn: async () => {
      const bom = orderForm.materials
        .filter((m) => m.productNumber.trim() && Number(m.quantity) > 0)
        .map((m) => ({ productNumber: m.productNumber.trim(), quantity: Number(m.quantity) }));
      return apiRequest("POST", "/api/erp/production-orders", {
        productNumber: orderForm.productNumber,
        quantity: Number(orderForm.quantity),
        warehouseId: orderForm.warehouseId || undefined,
        bom,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/production-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/mrp-suggestions"] });
      setOrderOpen(false);
      setOrderForm(emptyOrderForm());
      toast({ title: t("erp.saved") });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("POST", `/api/erp/production-orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/production-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/mrp-suggestions"] });
      toast({ title: t("erp.saved") });
    },
  });

  const saveBom = useMutation({
    mutationFn: async () => {
      const lines = bomForm.lines
        .filter((m) => m.productNumber.trim() && Number(m.quantity) > 0)
        .map((m) => ({ productNumber: m.productNumber.trim(), quantity: Number(m.quantity) }));
      if (!bomForm.productNumber.trim()) throw new Error("product required");
      if (!lines.length) throw new Error("lines required");
      if (bomForm.id) {
        return apiRequest("PUT", `/api/erp/boms/${bomForm.id}`, {
          name: bomForm.name || null,
          notes: bomForm.notes || null,
          lines,
        });
      }
      return apiRequest("POST", "/api/erp/boms", {
        productNumber: bomForm.productNumber.trim(),
        name: bomForm.name || undefined,
        notes: bomForm.notes || undefined,
        lines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/boms"] });
      setBomOpen(false);
      setBomForm(emptyBomForm());
      toast({ title: t("erp.saved") });
    },
    onError: () => {
      toast({ title: t("erp.production.bom.saveError"), variant: "destructive" });
    },
  });

  const deleteBom = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/erp/boms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/boms"] });
      toast({ title: t("erp.saved") });
    },
  });

  const openEditBom = async (id: string) => {
    try {
      const res = await apiRequest("GET", `/api/erp/boms/${id}`);
      const json = await res.json();
      const bom = json.bom;
      setBomForm({
        id: bom.id,
        productNumber: bom.productNumber,
        name: bom.name || "",
        notes: bom.notes || "",
        lines: (bom.lines?.length ? bom.lines : [{ productNumber: "", quantity: 1 }]).map(
          (l: any) => ({
            productNumber: l.productNumber,
            quantity: Number(l.quantity) || 1,
          }),
        ),
      });
      setBomOpen(true);
    } catch {
      toast({ title: t("erp.production.bom.loadError"), variant: "destructive" });
    }
  };

  const nextStatus = (status: string) => {
    if (status === "planned") return "released";
    if (status === "released") return "in_progress";
    if (status === "in_progress") return "completed";
    return null;
  };

  const updateOrderMaterial = (index: number, patch: Partial<BomLineForm>) => {
    setOrderForm((prev) => ({
      ...prev,
      materials: prev.materials.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  };

  const updateBomLine = (index: number, patch: Partial<BomLineForm>) => {
    setBomForm((prev) => ({
      ...prev,
      lines: prev.lines.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  };

  const toggleBomPriceSelection = (productNumber: string) => {
    setBomSelectedFromList((prev) => {
      const next = new Set(prev);
      if (next.has(productNumber)) next.delete(productNumber);
      else next.add(productNumber);
      return next;
    });
  };

  const addSelectedPriceListLines = () => {
    if (!bomSelectedFromList.size) return;
    setBomForm((prev) => {
      const existing = new Set(
        prev.lines.map((l) => l.productNumber.trim()).filter(Boolean),
      );
      const additions: BomLineForm[] = [];
      for (const pn of bomSelectedFromList) {
        if (existing.has(pn)) continue;
        additions.push({ productNumber: pn, quantity: 1 });
      }
      let lines = prev.lines;
      if (
        lines.length === 1 &&
        !lines[0].productNumber.trim() &&
        additions.length
      ) {
        lines = [];
      }
      return { ...prev, lines: [...lines, ...additions] };
    });
    setBomSelectedFromList(new Set());
    toast({ title: t("erp.production.bom.fromPriceListAdded") });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Factory className="h-8 w-8" />
            {t("erp.production.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.production.description")}</p>
        </div>
        <Button
          onClick={() => {
            setOrderForm(emptyOrderForm());
            setOrderOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t("erp.production.create")}
        </Button>
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">{t("erp.production.orders")}</TabsTrigger>
          <TabsTrigger value="boms">{t("erp.production.bom.tab")}</TabsTrigger>
          <TabsTrigger value="mrp">MRP</TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.number")}</TableHead>
                    <TableHead>{t("erp.product")}</TableHead>
                    <TableHead>{t("erp.quantity")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => {
                    const next = nextStatus(o.status);
                    return (
                      <TableRow key={o.id}>
                        <TableCell>{o.number}</TableCell>
                        <TableCell>
                          <ErpProductCell productNumber={o.productNumber} label={getLabel(o.productNumber)} />
                        </TableCell>
                        <TableCell>{o.quantity}</TableCell>
                        <TableCell>
                          <Badge variant={getProductionOrderStatusBadgeVariant(o.status)}>{o.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {next ? (
                            <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: next })}>
                              → {next}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {orders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {t("erp.empty")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boms">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>{t("erp.production.bom.title")}</CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setBomForm(emptyBomForm());
                  setBomOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {t("erp.production.bom.create")}
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.production.bom.finishedProduct")}</TableHead>
                    <TableHead>{t("erp.production.bom.name")}</TableHead>
                    <TableHead>{t("erp.production.bom.lineCount")}</TableHead>
                    <TableHead>{t("erp.status")}</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boms.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <ErpProductCell productNumber={b.productNumber} label={getLabel(b.productNumber)} />
                      </TableCell>
                      <TableCell>{b.name || "—"}</TableCell>
                      <TableCell>{b.lineCount ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={b.active ? "success" : "secondary"}>
                          {b.active ? t("erp.production.bom.active") : t("erp.production.bom.inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" onClick={() => openEditBom(b.id)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(t("erp.production.bom.deleteConfirm"))) {
                              deleteBom.mutate(b.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {boms.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        {t("erp.production.bom.empty")}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mrp">
          <Card>
            <CardHeader>
              <CardTitle>{t("erp.production.mrp")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("erp.product")}</TableHead>
                    <TableHead>{t("erp.required")}</TableHead>
                    <TableHead>{t("erp.available")}</TableHead>
                    <TableHead>{t("erp.shortfall")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestions.map((s) => (
                    <TableRow key={s.productNumber}>
                      <TableCell>
                        <ErpProductCell productNumber={s.productNumber} label={getLabel(s.productNumber)} />
                      </TableCell>
                      <TableCell>{s.required}</TableCell>
                      <TableCell>{s.available}</TableCell>
                      <TableCell>
                        {s.shortfall > 0 ? <Badge variant="destructive">{s.shortfall}</Badge> : 0}
                      </TableCell>
                    </TableRow>
                  ))}
                  {suggestions.length === 0 ? (
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
      </Tabs>

      <Dialog
        open={orderOpen}
        onOpenChange={(open) => {
          setOrderOpen(open);
          if (!open) setOrderForm(emptyOrderForm());
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("erp.production.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.product")}</Label>
              <ErpProductAutocomplete
                value={orderForm.productNumber}
                onChange={(productNumber) => {
                  void loadBomForProduct(productNumber);
                }}
              />
              {bomLoading ? (
                <p className="text-xs text-muted-foreground mt-1">{t("erp.production.bom.loading")}</p>
              ) : null}
              {orderForm.bomHint === "loaded" ? (
                <p className="text-xs text-muted-foreground mt-1">{t("erp.production.bom.loadedHint")}</p>
              ) : null}
              {orderForm.bomHint === "missing" ? (
                <p className="text-xs text-muted-foreground mt-1">{t("erp.production.bom.missingHint")}</p>
              ) : null}
            </div>
            <div>
              <Label>{t("erp.quantity")}</Label>
              <Input
                type="number"
                value={orderForm.quantity}
                onChange={(e) => setOrderForm({ ...orderForm, quantity: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={orderForm.warehouseId}
                onChange={(e) => setOrderForm({ ...orderForm, warehouseId: e.target.value })}
              >
                <option value="">{t("erp.select")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("erp.production.material")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setOrderForm((prev) => ({
                      ...prev,
                      materials: [...prev.materials, { productNumber: "", quantity: 1 }],
                    }))
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("erp.production.bom.addLine")}
                </Button>
              </div>
              {orderForm.materials.map((m, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <ErpProductAutocomplete
                      value={m.productNumber}
                      onChange={(productNumber) => updateOrderMaterial(index, { productNumber })}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-xs">{t("erp.production.materialQty")}</Label>
                    <Input
                      type="number"
                      value={m.quantity}
                      onChange={(e) => updateOrderMaterial(index, { quantity: Number(e.target.value) })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={orderForm.materials.length <= 1}
                    onClick={() =>
                      setOrderForm((prev) => ({
                        ...prev,
                        materials: prev.materials.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createOrder.mutate()} disabled={!orderForm.productNumber.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bomOpen}
        onOpenChange={(open) => {
          setBomOpen(open);
          if (!open) {
            setBomForm(emptyBomForm());
            setBomSupplierId("");
            setBomPriceSearch("");
            setBomSelectedFromList(new Set());
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {bomForm.id ? t("erp.production.bom.edit") : t("erp.production.bom.create")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.production.bom.finishedProduct")}</Label>
              {bomForm.id ? (
                <div className="border rounded-md h-10 px-3 flex items-center bg-muted/40">
                  <ErpProductCell
                    productNumber={bomForm.productNumber}
                    label={getLabel(bomForm.productNumber)}
                  />
                </div>
              ) : (
                <ErpProductAutocomplete
                  value={bomForm.productNumber}
                  onChange={(productNumber) => setBomForm({ ...bomForm, productNumber })}
                />
              )}
            </div>
            <div>
              <Label>{t("erp.production.bom.name")}</Label>
              <Input
                value={bomForm.name}
                onChange={(e) => setBomForm({ ...bomForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("erp.production.bom.notes")}</Label>
              <Input
                value={bomForm.notes}
                onChange={(e) => setBomForm({ ...bomForm, notes: e.target.value })}
              />
            </div>

            <div className="border rounded-md p-3 space-y-2 bg-muted/20">
              <Label>{t("erp.production.bom.fromPriceList")}</Label>
              <p className="text-xs text-muted-foreground">{t("erp.production.bom.fromPriceListHint")}</p>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={bomSupplierId}
                onChange={(e) => {
                  setBomSupplierId(e.target.value);
                  setBomSelectedFromList(new Set());
                }}
              >
                <option value="">{t("erp.select")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} — {s.name}
                  </option>
                ))}
              </select>
              {bomSupplierId ? (
                <>
                  <Input
                    placeholder={t("erp.production.bom.priceListSearch")}
                    value={bomPriceSearch}
                    onChange={(e) => setBomPriceSearch(e.target.value)}
                  />
                  <div className="max-h-40 overflow-y-auto border rounded-md">
                    <Table>
                      <TableBody>
                        {priceProducts.map((p: any) => (
                          <TableRow key={p.productNumber}>
                            <TableCell className="w-8">
                              <input
                                type="checkbox"
                                checked={bomSelectedFromList.has(p.productNumber)}
                                onChange={() => toggleBomPriceSelection(p.productNumber)}
                              />
                            </TableCell>
                            <TableCell>
                              <ErpProductCell
                                productNumber={p.productNumber}
                                label={getLabel(p.productNumber)}
                              />
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground whitespace-nowrap">
                              {p.unitPrice}
                            </TableCell>
                          </TableRow>
                        ))}
                        {priceProducts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-muted-foreground text-sm">
                              {t("erp.production.bom.priceListEmpty")}
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!bomSelectedFromList.size}
                    onClick={addSelectedPriceListLines}
                  >
                    {t("erp.production.bom.addFromPriceList", {
                      count: bomSelectedFromList.size,
                    })}
                  </Button>
                </>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("erp.production.bom.materials")}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setBomForm((prev) => ({
                      ...prev,
                      lines: [...prev.lines, { productNumber: "", quantity: 1 }],
                    }))
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t("erp.production.bom.addLine")}
                </Button>
              </div>
              {bomForm.lines.map((m, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <ErpProductAutocomplete
                      value={m.productNumber}
                      onChange={(productNumber) => updateBomLine(index, { productNumber })}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-xs">{t("erp.quantity")}</Label>
                    <Input
                      type="number"
                      value={m.quantity}
                      onChange={(e) => updateBomLine(index, { quantity: Number(e.target.value) })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={bomForm.lines.length <= 1}
                    onClick={() =>
                      setBomForm((prev) => ({
                        ...prev,
                        lines: prev.lines.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{t("erp.production.bom.qtyHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveBom.mutate()} disabled={saveBom.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
