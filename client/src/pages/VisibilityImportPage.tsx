import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FileUp,
  FileSpreadsheet,
  X,
  Play,
  Eye,
  Download,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  | "would_update"
  | "updated"
  | "unchanged"
  | "not_found"
  | "ambiguous"
  | "error"
  | "skipped";

interface ChannelChange {
  salesChannelName: string;
  salesChannelId: string;
  previousVisibility: number | null;
  action: "set" | "remove";
  visibility?: 10 | 20 | 30;
}

interface RowResult {
  rowNumber: number;
  identifier: string;
  productId?: string;
  productNumber?: string;
  productName?: string;
  matchStrategy?: string;
  status: RowStatus;
  changes: ChannelChange[];
  message?: string;
}

interface ImportResult {
  mode: "apply" | "dry-run";
  totalRows: number;
  matched: number;
  updated: number;
  unchanged: number;
  notFound: number;
  ambiguous: number;
  errors: number;
  unknownColumns: string[];
  rows: RowResult[];
}

const STATUS_VARIANT: Record<RowStatus, "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  would_update: "success",
  updated: "success",
  unchanged: "outline",
  not_found: "destructive",
  ambiguous: "destructive",
  error: "destructive",
  skipped: "warning",
};

const PROBLEM_STATUSES: RowStatus[] = ["not_found", "ambiguous", "error"];

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

function formatVisibility(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 30) return "30 (sichtbar)";
  if (value === 20) return "20 (listen)";
  if (value === 10) return "10 (suche)";
  return String(value);
}

function formatChange(change: ChannelChange): string {
  const from = formatVisibility(change.previousVisibility);
  if (change.action === "remove") {
    return `${change.salesChannelName}: ${from} → entfernen`;
  }
  return `${change.salesChannelName}: ${from} → ${formatVisibility(change.visibility)}`;
}

export default function VisibilityImportPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState<"dry-run" | "apply" | "template" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const statusLabel = (status: RowStatus): string =>
    t(`visibilityImport.status.${status}`, { defaultValue: status });

  const downloadTemplate = async () => {
    setIsLoading("template");
    try {
      const res = await fetch("/api/products/visibility/import-template", {
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sichtbarkeit-import-vorlage.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: t("visibilityImport.templateDownloaded") });
    } catch (error: any) {
      toast({
        title: t("visibilityImport.errorTitle"),
        description: error?.message || t("visibilityImport.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const submit = async (apply: boolean) => {
    if (!file) return;
    setIsLoading(apply ? "apply" : "dry-run");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("apply", String(apply));

      const headers: Record<string, string> = {};
      const csrfToken = getCsrfToken();
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const res = await fetch("/api/products/visibility/import", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        let message = res.statusText;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          const text = await res.text();
          if (text) message = text;
        }
        throw new Error(`${res.status}: ${message}`);
      }

      const data: ImportResult = await res.json();
      setResult(data);
      if (apply) {
        toast({ title: t("visibilityImport.appliedToast") });
      }
    } catch (error: any) {
      toast({
        title: t("visibilityImport.errorTitle"),
        description: error?.message || t("visibilityImport.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const problemRows = result?.rows.filter((r) => PROBLEM_STATUSES.includes(r.status)) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Eye className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("visibilityImport.title")}</h1>
            <p className="text-muted-foreground">{t("visibilityImport.description")}</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={downloadTemplate}
          disabled={isLoading !== null}
          data-testid="visibility-template-download"
        >
          <Download className="h-4 w-4 mr-2" />
          {isLoading === "template"
            ? t("visibilityImport.running")
            : t("visibilityImport.downloadTemplate")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("visibilityImport.uploadTitle")}</CardTitle>
          <CardDescription>{t("visibilityImport.uploadHint")}</CardDescription>
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
            data-testid="visibility-dropzone"
          >
            <FileUp className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{t("visibilityImport.dropzone")}</p>
            <p className="text-sm text-muted-foreground">{t("visibilityImport.dropzoneSub")}</p>
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
              data-testid="visibility-file-input"
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
                aria-label={t("visibilityImport.removeFile")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => submit(false)}
              disabled={!file || isLoading !== null}
              data-testid="visibility-dry-run"
            >
              <Eye className="h-4 w-4 mr-2" />
              {isLoading === "dry-run" ? t("visibilityImport.running") : t("visibilityImport.dryRun")}
            </Button>
            <Button
              onClick={() => submit(true)}
              disabled={!file || isLoading !== null}
              data-testid="visibility-apply"
            >
              <Play className="h-4 w-4 mr-2" />
              {isLoading === "apply" ? t("visibilityImport.running") : t("visibilityImport.apply")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <>
          <Alert variant={result.mode === "apply" ? "default" : "default"}>
            {result.mode === "apply" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            <AlertTitle>
              {result.mode === "apply"
                ? t("visibilityImport.appliedTitle")
                : t("visibilityImport.dryRunTitle")}
            </AlertTitle>
            <AlertDescription>
              {t("visibilityImport.resultSummaryLine", {
                total: result.totalRows,
                matched: result.matched,
                updated: result.updated,
                notFound: result.notFound,
                errors: result.errors,
              })}
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {t("visibilityImport.summary.matched")}: {result.matched}
            </Badge>
            <Badge variant="success">
              {t("visibilityImport.summary.updated")}: {result.updated}
            </Badge>
            <Badge variant="outline">
              {t("visibilityImport.summary.unchanged")}: {result.unchanged}
            </Badge>
            <Badge variant="destructive">
              {t("visibilityImport.summary.notFound")}: {result.notFound}
            </Badge>
            {result.ambiguous > 0 ? (
              <Badge variant="destructive">
                {t("visibilityImport.summary.ambiguous")}: {result.ambiguous}
              </Badge>
            ) : null}
            {result.errors > 0 ? (
              <Badge variant="destructive">
                {t("visibilityImport.summary.errors")}: {result.errors}
              </Badge>
            ) : null}
          </div>

          {result.unknownColumns.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("visibilityImport.unknownColumnsTitle")}</AlertTitle>
              <AlertDescription>
                {t("visibilityImport.unknownColumnsHint")}: {result.unknownColumns.join(", ")}
              </AlertDescription>
            </Alert>
          ) : null}

          {problemRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("visibilityImport.problemsTitle")}</CardTitle>
                <CardDescription>{t("visibilityImport.problemsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("visibilityImport.col.row")}</TableHead>
                      <TableHead>{t("visibilityImport.col.identifier")}</TableHead>
                      <TableHead>{t("visibilityImport.col.status")}</TableHead>
                      <TableHead>{t("visibilityImport.col.message")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {problemRows.map((row) => (
                      <TableRow key={`problem-${row.rowNumber}-${row.identifier}`}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell className="font-mono text-sm">{row.identifier}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[row.status]}>
                            {statusLabel(row.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.message || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("visibilityImport.allRowsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("visibilityImport.col.row")}</TableHead>
                    <TableHead>{t("visibilityImport.col.identifier")}</TableHead>
                    <TableHead>{t("visibilityImport.col.product")}</TableHead>
                    <TableHead>{t("visibilityImport.col.match")}</TableHead>
                    <TableHead>{t("visibilityImport.col.changes")}</TableHead>
                    <TableHead>{t("visibilityImport.col.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`row-${row.rowNumber}-${row.identifier}`}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell className="font-mono text-sm">{row.identifier}</TableCell>
                      <TableCell className="text-sm">
                        {row.productNumber ? (
                          <div>
                            <div className="font-medium">{row.productNumber}</div>
                            <div className="text-muted-foreground truncate max-w-[240px]">
                              {row.productName}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.matchStrategy || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.changes.length > 0 ? (
                          <ul className="list-disc pl-4 space-y-0.5">
                            {row.changes.map((c) => (
                              <li key={`${row.rowNumber}-${c.salesChannelId}`}>
                                {formatChange(c)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">{row.message || "—"}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {statusLabel(row.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
