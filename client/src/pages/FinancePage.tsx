import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Landmark, Download, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

export default function FinancePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [form, setForm] = useState({
    type: "receivable",
    partnerType: "customer",
    partnerName: "",
    documentNumber: "",
    amount: 0,
  });

  const { data } = useQuery<{ openItems: any[] }>({ queryKey: ["/api/erp/open-items"] });
  const openItems = data?.openItems ?? [];
  const { data: vatData } = useQuery<{ summary: any }>({ queryKey: ["/api/erp/finance/vat-summary"] });
  const summary = vatData?.summary;

  const createItem = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/open-items", {
        ...form,
        amount: Number(form.amount),
        openAmount: Number(form.amount),
        documentDate: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/open-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/finance/vat-summary"] });
      setOpen(false);
      toast({ title: t("erp.saved") });
    },
  });

  const pay = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/erp/payments", {
        openItemId: payOpen,
        amount: Number(payAmount),
        method: "bank",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/open-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/finance/vat-summary"] });
      setPayOpen(null);
      toast({ title: t("erp.saved") });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Landmark className="h-8 w-8" />
            {t("erp.finance.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("erp.finance.description")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounting">
            <Button variant="outline">{t("erp.finance.bankMatch")}</Button>
          </Link>
          <Button variant="outline" asChild>
            <a href="/api/erp/finance/datev-export">
              <Download className="h-4 w-4 mr-2" />
              DATEV
            </a>
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("erp.finance.addOpenItem")}
          </Button>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("erp.finance.receivables")}</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{summary.receivablesOpen?.toFixed?.(2)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("erp.finance.payables")}</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{summary.payablesOpen?.toFixed?.(2)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("erp.finance.vatEstimate")}</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{summary.estimatedVat19?.toFixed?.(2)}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">BWA</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">{t("erp.finance.bwaHint")}</CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("erp.number")}</TableHead>
                <TableHead>{t("erp.type")}</TableHead>
                <TableHead>{t("erp.name")}</TableHead>
                <TableHead>{t("erp.amount")}</TableHead>
                <TableHead>{t("erp.openAmount")}</TableHead>
                <TableHead>{t("erp.status")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.documentNumber}</TableCell>
                  <TableCell>{item.type}</TableCell>
                  <TableCell>{item.partnerName || item.partnerId || "—"}</TableCell>
                  <TableCell>{item.amount}</TableCell>
                  <TableCell>{item.openAmount}</TableCell>
                  <TableCell><Badge>{item.status}</Badge></TableCell>
                  <TableCell>
                    {item.status !== "paid" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPayOpen(item.id);
                          setPayAmount(Math.abs(item.openAmount));
                        }}
                      >
                        {t("erp.finance.pay")}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {openItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">{t("erp.empty")}</TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.finance.addOpenItem")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("erp.type")}</Label>
              <select
                className="w-full border rounded-md h-10 px-3 bg-background"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="receivable">receivable</option>
                <option value="payable">payable</option>
              </select>
            </div>
            <div>
              <Label>{t("erp.name")}</Label>
              <Input value={form.partnerName} onChange={(e) => setForm({ ...form, partnerName: e.target.value })} />
            </div>
            <div>
              <Label>{t("erp.number")}</Label>
              <Input value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} />
            </div>
            <div>
              <Label>{t("erp.amount")}</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createItem.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!payOpen} onOpenChange={(v) => !v && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("erp.finance.pay")}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>{t("erp.amount")}</Label>
            <Input type="number" value={payAmount} onChange={(e) => setPayAmount(Number(e.target.value))} />
          </div>
          <DialogFooter>
            <Button onClick={() => pay.mutate()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
