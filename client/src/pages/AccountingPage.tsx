import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AccountingMatch = {
  id: string;
  status: "matched" | "partial" | "unmatched";
  reference?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  date?: string | null;
  description?: string | null;
  reason?: string | null;
  debug?: {
    matchedBy?: "orderNumber" | "invoiceNumber" | "amountDate" | "none";
    normalizedReference?: string;
    entry?: {
      date?: string | null;
      amount?: number | null;
      reference?: string | null;
      description?: string | null;
      rawKeys?: string[];
    };
    aiHints?: {
      orderNumber?: string | null;
      invoiceNumber?: string | null;
      amount?: number | null;
      date?: string | null;
    };
  };
};

export default function AccountingPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<AccountingMatch[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AccountingMatch["status"]>("all");
  const [confirmingIds, setConfirmingIds] = useState<string[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<string[]>([]);
  const [debugEnabled, setDebugEnabled] = useState(false);

  const getCsrfToken = () => {
    const match = document.cookie.match(/csrf_token=([^;]+)/);
    return match ? match[1] : null;
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("debug", debugEnabled ? "true" : "false");
    setIsUploading(true);
    try {
      const csrfToken = getCsrfToken();
      const debugParam = debugEnabled ? "?debug=true" : "";
      const response = await fetch(`/api/accounting/upload${debugParam}`, {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: csrfToken ? { "X-CSRF-Token": csrfToken } : undefined,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      setResults(data.results || []);
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async (row: AccountingMatch) => {
    if (!row.orderId) return;
    setConfirmingIds((current) => [...current, row.id]);
    try {
      const csrfToken = getCsrfToken();
      const response = await fetch("/api/accounting/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify({ orderId: row.orderId }),
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      toast({
        title: t("accounting.confirmSuccess"),
        description: row.orderNumber || row.invoiceNumber || row.reference || "",
      });
      setConfirmedIds((current) => [...current, row.id]);
    } catch (error: any) {
      toast({
        title: t("errors.failed"),
        description: t("accounting.confirmFailed"),
        variant: "destructive",
      });
    } finally {
      setConfirmingIds((current) => current.filter((id) => id !== row.id));
    }
  };

  const badgeVariant = (status: AccountingMatch["status"]) => {
    if (status === "matched") return "default";
    if (status === "partial") return "secondary";
    return "outline";
  };

  const filteredResults = results.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (!searchText.trim()) return true;
    const haystack = [
      row.reference,
      row.orderNumber,
      row.invoiceNumber,
      row.description,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchText.trim().toLowerCase());
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("accounting.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("accounting.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t("accounting.uploadTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept=".csv,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            data-testid="input-accounting-file"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={debugEnabled}
              onCheckedChange={(value) => setDebugEnabled(Boolean(value))}
              data-testid="checkbox-accounting-debug"
            />
            {t("accounting.debugLabel")}
          </label>
          <Button onClick={handleUpload} disabled={!file || isUploading} data-testid="button-accounting-upload">
            {isUploading ? t("common.saving") : t("accounting.uploadAction")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("accounting.resultsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder={t("common.search")}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              data-testid="input-accounting-search"
            />
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
              <SelectTrigger className="sm:w-56">
                <SelectValue placeholder={t("common.filter")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="matched">{t("accounting.status.matched")}</SelectItem>
                <SelectItem value="partial">{t("accounting.status.partial")}</SelectItem>
                <SelectItem value="unmatched">{t("accounting.status.unmatched")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredResults.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("accounting.noResults")}</p>
          )}
          {filteredResults.map((row) => (
            <div key={row.id} className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                <div className="text-sm font-medium">
                  {row.orderNumber || row.invoiceNumber || row.reference || t("accounting.noReference")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.description || t("accounting.noDescription")}
                </div>
                </div>
                <div className="flex items-center gap-3">
                {row.orderId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleConfirm(row)}
                    disabled={confirmingIds.includes(row.id) || confirmedIds.includes(row.id)}
                    data-testid={`button-accounting-confirm-${row.id}`}
                  >
                    {confirmingIds.includes(row.id)
                      ? t("common.saving")
                      : confirmedIds.includes(row.id)
                      ? t("accounting.confirmedLabel")
                      : t("accounting.confirmAction")}
                  </Button>
                )}
                <div className="text-sm">
                  {row.amount ? row.amount.toLocaleString("de-DE", { style: "currency", currency: "EUR" }) : "-"}
                </div>
                <Badge variant={badgeVariant(row.status)}>
                  {t(`accounting.status.${row.status}`)}
                </Badge>
                {confirmedIds.includes(row.id) && (
                  <Badge variant="outline">{t("accounting.confirmedBadge")}</Badge>
                )}
                </div>
              </div>
              {debugEnabled && row.debug && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>{t("accounting.debugMatchedBy")}: {row.debug.matchedBy || "-"}</div>
                  <div>{t("accounting.debugNormalizedRef")}: {row.debug.normalizedReference || "-"}</div>
                  {row.debug.entry && (
                    <>
                      <div>
                        {t("accounting.debugParsedEntry")}:{" "}
                        {[
                          row.debug.entry.date,
                          row.debug.entry.amount,
                          row.debug.entry.reference,
                          row.debug.entry.description,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "-"}
                      </div>
                      <div>
                        {t("accounting.debugRawKeys")}:{" "}
                        {row.debug.entry.rawKeys?.join(", ") || "-"}
                      </div>
                    </>
                  )}
                  {row.debug.aiHints && (
                    <div>
                      {t("accounting.debugAiHints")}:{" "}
                      {[
                        row.debug.aiHints.orderNumber,
                        row.debug.aiHints.invoiceNumber,
                        row.debug.aiHints.amount,
                        row.debug.aiHints.date,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "-"}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
