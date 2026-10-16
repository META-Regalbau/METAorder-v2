import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiErrorFromBody } from "@/lib/apiError";
import { getCommercialUploadCsrfHeaders } from "@/lib/commercialUnifiedDraftUpload";
import type { SalesRepAssignment } from "@shared/portalRegistrations";

const QUERY_KEY = ["/api/b2b/sales-reps"];
const PAGE = 200;

type ImportResult = {
  dryRun: boolean;
  rows: number;
  imported: number;
  errors: Array<{ rowNumber: number; message: string }>;
  columns: { customerNumber: string | null; email: string | null; name: string | null };
  preview: SalesRepAssignment[];
};

export default function SalesRepTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useQuery<{ items: SalesRepAssignment[] }>({ queryKey: QUERY_KEY });
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState({ customerNumber: "", repName: "", repEmail: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  const items = query.data?.items ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = q ? items.filter((i) => `${i.customerNumber} ${i.repName} ${i.repEmail}`.toLowerCase().includes(q)) : items;
    return list.slice(0, PAGE);
  }, [items, filter]);

  const runImport = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("mode", mode);
      form.append("dryRun", dryRun ? "true" : "false");
      const res = await fetch("/api/b2b/sales-reps/import", { method: "POST", body: form, credentials: "include", headers: getCommercialUploadCsrfHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw apiErrorFromBody(res.status, body, t("portalRegistrations.salesReps.importFailed"));
      setPreview(body as ImportResult);
      if (!dryRun) {
        toast({ title: t("portalRegistrations.salesReps.imported", { count: body.imported }) });
        setFile(null);
        setPreview(null);
        if (fileInput.current) fileInput.current.value = "";
        await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      }
    } catch (err) {
      toast({ title: t("portalRegistrations.salesReps.importFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveSingle = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/b2b/sales-reps", single),
    onSuccess: async () => {
      setSingle({ customerNumber: "", repName: "", repEmail: "" });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: t("portalRegistrations.salesReps.saved") });
    },
    onError: (err: Error) => toast({ title: t("portalRegistrations.salesReps.saveFailed"), description: err.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (customerNumber: string) => apiRequest("DELETE", `/api/b2b/sales-reps/${encodeURIComponent(customerNumber)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err: Error) => toast({ title: t("portalRegistrations.salesReps.saveFailed"), description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">{t("portalRegistrations.salesReps.intro")}</p>
        {canManage ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="sales-rep-file">{t("portalRegistrations.salesReps.file")}</Label>
                <Input
                  id="sales-rep-file"
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="mt-1"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
              </div>
              <div className="min-w-[220px]">
                <Label htmlFor="sales-rep-mode">{t("portalRegistrations.salesReps.mode")}</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as "replace" | "merge")}>
                  <SelectTrigger id="sales-rep-mode" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">{t("portalRegistrations.salesReps.modeReplace")}</SelectItem>
                    <SelectItem value="merge">{t("portalRegistrations.salesReps.modeMerge")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={!file || busy} onClick={() => runImport(true)} data-testid="button-sales-rep-preview">
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4 mr-2" aria-hidden="true" />}
                {t("portalRegistrations.salesReps.check")}
              </Button>
              <Button disabled={!file || busy || !preview || preview.rows === 0} onClick={() => runImport(false)} data-testid="button-sales-rep-import">
                {t("portalRegistrations.salesReps.import")}
              </Button>
            </div>
            {preview ? (
              <div className="rounded-md border p-3 text-sm space-y-1" data-testid="sales-rep-preview">
                <p>
                  {t("portalRegistrations.salesReps.previewSummary", {
                    rows: fmt.integer(preview.rows),
                    errors: fmt.integer(preview.errors.length),
                    number: preview.columns.customerNumber ?? "–",
                    email: preview.columns.email ?? "–",
                    name: preview.columns.name ?? "–",
                  })}
                </p>
                {preview.errors.slice(0, 10).map((e) => (
                  <p key={`${e.rowNumber}-${e.message}`} className="text-xs text-destructive">
                    {t("portalRegistrations.salesReps.rowError", { row: e.rowNumber, message: e.message })}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3 border-t pt-3">
              <div>
                <Label htmlFor="sales-rep-number">{t("portalRegistrations.salesReps.customerNumber")}</Label>
                <Input id="sales-rep-number" className="mt-1 w-40" value={single.customerNumber} onChange={(e) => setSingle({ ...single, customerNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="sales-rep-name">{t("portalRegistrations.salesReps.repName")}</Label>
                <Input id="sales-rep-name" className="mt-1 w-56" value={single.repName} onChange={(e) => setSingle({ ...single, repName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="sales-rep-email">{t("portalRegistrations.salesReps.repEmail")}</Label>
                <Input id="sales-rep-email" className="mt-1 w-64" value={single.repEmail} onChange={(e) => setSingle({ ...single, repEmail: e.target.value })} />
              </div>
              <Button
                variant="outline"
                disabled={saveSingle.isPending || !single.customerNumber.trim() || !single.repEmail.trim()}
                onClick={() => saveSingle.mutate()}
                data-testid="button-sales-rep-add"
              >
                {t("portalRegistrations.salesReps.add")}
              </Button>
            </div>
          </>
        ) : null}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Label htmlFor="sales-rep-filter">{t("portalRegistrations.salesReps.search")}</Label>
            <Input id="sales-rep-filter" className="mt-1 w-72" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <p className="text-sm text-muted-foreground">{t("portalRegistrations.salesReps.count", { count: items.length, shown: fmt.integer(filtered.length) })}</p>
        </div>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("common.loading")}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="sales-reps-empty">{t("portalRegistrations.salesReps.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("portalRegistrations.salesReps.customerNumber")}</TableHead>
                <TableHead>{t("portalRegistrations.salesReps.repName")}</TableHead>
                <TableHead>{t("portalRegistrations.salesReps.repEmail")}</TableHead>
                {canManage ? <TableHead className="w-12"><span className="sr-only">{t("portalRegistrations.salesReps.delete")}</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.customerNumber}>
                  <TableCell className="font-medium">{row.customerNumber}</TableCell>
                  <TableCell>{row.repName || "–"}</TableCell>
                  <TableCell>{row.repEmail}</TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("portalRegistrations.salesReps.deleteRow", { number: row.customerNumber })}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.customerNumber)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
