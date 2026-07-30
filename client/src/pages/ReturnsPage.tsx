import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RotateCcw, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ErpProductAutocomplete from "@/components/ErpProductAutocomplete";
import { ErpProductCell } from "@/components/ErpProductCell";
import { useErpProductLabels } from "@/hooks/useErpProductLabels";

export default function ReturnsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    shopwareOrderNumber: "",
    customerEmail: "",
    reason: "",
    warehouseId: "",
    productNumber: "",
    quantity: 1,
    unitPrice: 0,
  });

  const { data } = useQuery<{ returns: any[] }>({ queryKey: ["/api/erp/returns"] });
  const returns = data?.returns ?? [];
  const { data: whData } = useQuery<{ warehouses: any[] }>({ queryKey: ["/api/erp/warehouses"] });
  const warehouses = whData?.warehouses ?? [];

  const productNumbers = useMemo(
    () =>
      returns.flatMap((r) => (r.lines || []).map((l: any) => l.productNumber)).filter(Boolean),
    [returns],
  );
  const { getLabel } = useErpProductLabels(productNumbers);

  const createReturn = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/returns", {
        shopwareOrderNumber: form.shopwareOrderNumber,
        customerEmail: form.customerEmail,
        reason: form.reason,
        warehouseId: form.warehouseId || undefined,
        lines: [
          {
            productNumber: form.productNumber,
            quantity: Number(form.quantity),
            unitPrice: Number(form.unitPrice),
            restock: true,
          },
        ],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/returns"] });
      setOpen(false);
      toast({ title: t("erp.saved") });
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("POST", `/api/erp/returns/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/open-items"] });
      toast({ title: t("erp.saved") });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <RotateCcw className="h-8 w-8" />
            {t("erp.returns.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.returns.description")}</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t("erp.returns.create")}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("erp.orderNumber")}</TableHead>
                <TableHead>{t("erp.product")}</TableHead>
                <TableHead>{t("erp.status")}</TableHead>
                <TableHead>{t("erp.creditNote")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.shopwareOrderNumber || "—"}</TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      {(r.lines || []).map((line: any) => (
                        <ErpProductCell
                          key={line.id || line.productNumber}
                          productNumber={line.productNumber}
                          label={getLabel(line.productNumber)}
                        />
                      ))}
                      {!(r.lines || []).length ? "—" : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.creditNoteNumber ? `${r.creditNoteNumber} (${r.creditAmount ?? 0})` : "—"}
                  </TableCell>
                  <TableCell className="space-x-2">
                    {r.status === "requested" ? (
                      <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: r.id, status: "approved" })}>
                        {t("erp.approve")}
                      </Button>
                    ) : null}
                    {r.status === "approved" ? (
                      <Button size="sm" onClick={() => setStatus.mutate({ id: r.id, status: "received" })}>
                        {t("erp.returns.receive")}
                      </Button>
                    ) : null}
                    {r.status === "received" ? (
                      <Button size="sm" onClick={() => setStatus.mutate({ id: r.id, status: "refunded" })}>
                        {t("erp.returns.refund")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {returns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">{t("erp.empty")}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.returns.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.orderNumber")}</Label>
              <Input value={form.shopwareOrderNumber} onChange={(e) => setForm({ ...form, shopwareOrderNumber: e.target.value })} />
            </div>
            <div>
              <Label>E-Mail</Label>
              <Input value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} />
            </div>
            <div>
              <Label>{t("erp.reason")}</Label>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div>
              <Label>{t("erp.warehouse.warehouses")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={form.warehouseId}
                onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
              >
                <option value="">{t("erp.select")}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("erp.product")}</Label>
              <ErpProductAutocomplete
                value={form.productNumber}
                onChange={(productNumber) => setForm({ ...form, productNumber })}
                placeholder={t("erp.warehouse.searchProduct")}
              />
            </div>
            <div>
              <Label>{t("erp.quantity")}</Label>
              <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t("erp.unitPrice")}</Label>
              <Input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: Number(e.target.value) })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createReturn.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
