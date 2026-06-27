import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, FileSpreadsheet, X, Play, Eye, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type RowStatus =
  | "would_create"
  | "would_create_nachlieferung"
  | "would_create_original"
  | "would_field_only"
  | "created"
  | "created_nachlieferung"
  | "created_original"
  | "field_only"
  | "skipped_exists"
  | "skipped_conflict"
  | "not_found"
  | "error";

interface RowResult {
  rowNumber: number;
  orderNumber: string;
  invoiceNumber: string;
  nettowert?: number;
  isNachlieferung: boolean;
  existingNumbers?: string[];
  status: RowStatus;
  message?: string;
}

interface ImportResult {
  mode: "apply" | "dry-run";
  totalRows: number;
  options: {
    apply: boolean;
    fieldOnConflict: boolean;
    skipOriginalBackfill: boolean;
    markUnsent: boolean;
    sendInvoice?: boolean;
  };
  summary: Record<string, number>;
  markedUnsentCount: number;
  sentCount?: number;
  rows: RowResult[];
}

const STATUS_VARIANT: Record<RowStatus, "default" | "secondary" | "destructive" | "outline"> = {
  would_create: "default",
  would_create_nachlieferung: "default",
  would_create_original: "default",
  would_field_only: "secondary",
  created: "default",
  created_nachlieferung: "default",
  created_original: "default",
  field_only: "secondary",
  skipped_exists: "outline",
  skipped_conflict: "destructive",
  not_found: "destructive",
  error: "destructive",
};

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

const PROBLEM_STATUSES: RowStatus[] = ["not_found", "skipped_conflict", "error"];

export default function ShopFakturenImportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fieldOnConflict, setFieldOnConflict] = useState(true);
  const [skipOriginalBackfill, setSkipOriginalBackfill] = useState(false);
  const [markUnsent, setMarkUnsent] = useState(true);
  const [sendInvoice, setSendInvoice] = useState(false);
  const [isLoading, setIsLoading] = useState<"dry-run" | "apply" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const statusLabel = (status: RowStatus): string =>
    t(`shopFakturen.status.${status}`, { defaultValue: status });

  const submit = async (apply: boolean) => {
    if (!file) return;
    setIsLoading(apply ? "apply" : "dry-run");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("apply", String(apply));
      formData.append("fieldOnConflict", String(fieldOnConflict));
      formData.append("skipOriginalBackfill", String(skipOriginalBackfill));
      formData.append("markUnsent", String(markUnsent));
      formData.append("sendInvoice", String(sendInvoice));

      const headers: Record<string, string> = {};
      const csrfToken = getCsrfToken();
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const res = await fetch("/api/accounting/shop-fakturen/import", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }

      const data: ImportResult = await res.json();
      setResult(data);
      if (apply) {
        toast({ title: t("shopFakturen.appliedToast") });
      }
    } catch (error: any) {
      toast({
        title: t("shopFakturen.errorTitle"),
        description: error?.message || t("shopFakturen.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const problemRows = result?.rows.filter((r) => PROBLEM_STATUSES.includes(r.status)) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("shopFakturen.title")}</h1>
          <p className="text-muted-foreground">{t("shopFakturen.description")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("shopFakturen.uploadTitle")}</CardTitle>
          <CardDescription>{t("shopFakturen.uploadHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) setFile(dropped);
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            data-testid="fakturen-dropzone"
          >
            <FileUp className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{t("shopFakturen.dropzone")}</p>
            <p className="text-sm text-muted-foreground">{t("shopFakturen.dropzoneSub")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0] ?? null;
                setFile(selected);
                e.target.value = "";
              }}
              data-testid="fakturen-file-input"
            />
          </div>

          {file ? (
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span className="flex items-center gap-2 truncate">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{file.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={t("shopFakturen.removeFile")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">{t("shopFakturen.optionsTitle")}</p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="fieldOnConflict"
                checked={fieldOnConflict}
                onCheckedChange={(v) => setFieldOnConflict(v === true)}
                data-testid="opt-field-on-conflict"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="fieldOnConflict">{t("shopFakturen.opt.fieldOnConflict")}</Label>
                <p className="text-xs text-muted-foreground">{t("shopFakturen.opt.fieldOnConflictHint")}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="skipOriginalBackfill"
                checked={skipOriginalBackfill}
                onCheckedChange={(v) => setSkipOriginalBackfill(v === true)}
                data-testid="opt-skip-backfill"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="skipOriginalBackfill">{t("shopFakturen.opt.skipOriginalBackfill")}</Label>
                <p className="text-xs text-muted-foreground">{t("shopFakturen.opt.skipOriginalBackfillHint")}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="markUnsent"
                checked={markUnsent}
                disabled={sendInvoice}
                onCheckedChange={(v) => setMarkUnsent(v === true)}
                data-testid="opt-mark-unsent"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="markUnsent">{t("shopFakturen.opt.markUnsent")}</Label>
                <p className="text-xs text-muted-foreground">{t("shopFakturen.opt.markUnsentHint")}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id="sendInvoice"
                checked={sendInvoice}
                onCheckedChange={(v) => {
                  const checked = v === true;
                  setSendInvoice(checked);
                  // Verschicken und "als nicht verschickt markieren" schliessen sich aus.
                  if (checked) setMarkUnsent(false);
                }}
                data-testid="opt-send-invoice"
              />
              <div className="grid gap-0.5">
                <Label htmlFor="sendInvoice">{t("shopFakturen.opt.sendInvoice")}</Label>
                <p className="text-xs text-muted-foreground">{t("shopFakturen.opt.sendInvoiceHint")}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => submit(false)}
              disabled={!file || isLoading !== null}
              data-testid="fakturen-dryrun"
            >
              <Eye className="h-4 w-4 mr-2" />
              {isLoading === "dry-run" ? t("shopFakturen.running") : t("shopFakturen.dryRun")}
            </Button>
            <Button
              onClick={() => submit(true)}
              disabled={!file || isLoading !== null}
              data-testid="fakturen-apply"
            >
              <Play className="h-4 w-4 mr-2" />
              {isLoading === "apply" ? t("shopFakturen.running") : t("shopFakturen.apply")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <>
          <Alert variant={result.mode === "apply" ? "default" : undefined}>
            {result.mode === "apply" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            <AlertTitle>
              {result.mode === "apply" ? t("shopFakturen.appliedTitle") : t("shopFakturen.dryRunTitle")}
            </AlertTitle>
            <AlertDescription>
              {t("shopFakturen.resultSummaryLine", {
                total: result.totalRows,
                unsent: result.markedUnsentCount,
              })}
              {result.sentCount && result.sentCount > 0
                ? ` ${t("shopFakturen.resultSentLine", { sent: result.sentCount })}`
                : ""}
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>{t("shopFakturen.summaryTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.summary).map(([status, count]) => (
                  <Badge key={status} variant={STATUS_VARIANT[status as RowStatus] ?? "secondary"}>
                    {statusLabel(status as RowStatus)}: {count}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {problemRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  {t("shopFakturen.problemsTitle")}
                </CardTitle>
                <CardDescription>{t("shopFakturen.problemsHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResultTable rows={problemRows} statusLabel={statusLabel} t={t} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("shopFakturen.allRowsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResultTable rows={result.rows} statusLabel={statusLabel} t={t} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ResultTable({
  rows,
  statusLabel,
  t,
}: {
  rows: RowResult[];
  statusLabel: (status: RowStatus) => string;
  t: (key: string, opts?: any) => string;
}) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[64px]">{t("shopFakturen.table.row")}</TableHead>
            <TableHead className="w-[140px]">{t("shopFakturen.table.order")}</TableHead>
            <TableHead className="w-[140px]">{t("shopFakturen.table.invoice")}</TableHead>
            <TableHead className="w-[180px]">{t("shopFakturen.table.status")}</TableHead>
            <TableHead>{t("shopFakturen.table.message")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.rowNumber}-${row.invoiceNumber}`}>
              <TableCell className="text-muted-foreground">{row.rowNumber}</TableCell>
              <TableCell className="font-mono">{row.orderNumber || "—"}</TableCell>
              <TableCell className="font-mono">
                {row.invoiceNumber || "—"}
                {row.isNachlieferung ? (
                  <Badge variant="outline" className="ml-2">
                    {t("shopFakturen.nachlieferung")}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>{statusLabel(row.status)}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{row.message || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
