import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, Search, Copy, X, FileText, CheckCircle2, AlertCircle, Download, User, ScanLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface ObxMissingArticle {
  artNr: string;
  description?: string;
  occurrences: number;
}

interface ObxFoundArticle extends ObxMissingArticle {
  productNumber: string;
  name: string;
  matchedBy: "productNumber" | "manufacturerNumber" | "wdu_ifs_productnumber";
}

interface ObxAddress {
  name1?: string;
  name2?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

interface ObxHeader {
  orderDate?: string;
  customerNo?: string;
  iln?: string;
  consignmentNumber?: string;
  oneTimeAddress?: ObxAddress;
  customerContact?: ObxAddress;
}

interface ObxFileSummary {
  fileName: string;
  articleCount: number;
  header?: ObxHeader;
}

interface ObxSearchResult {
  files: ObxFileSummary[];
  totalUniqueArticles: number;
  foundCount: number;
  missingCount: number;
  missing: ObxMissingArticle[];
  found: ObxFoundArticle[];
  missingCsv: string;
}

function hasCustomerInfo(header?: ObxHeader): boolean {
  if (!header) return false;
  return Boolean(
    header.customerNo ||
      header.iln ||
      header.consignmentNumber ||
      header.oneTimeAddress ||
      header.customerContact,
  );
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

export default function ObxSearchPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ObxSearchResult | null>(null);
  const [showFound, setShowFound] = useState(false);
  const [selectedHeaderFile, setSelectedHeaderFile] = useState<ObxFileSummary | null>(null);
  const [quickOrderText, setQuickOrderText] = useState("");
  const [quickOrderCustomerId, setQuickOrderCustomerId] = useState("");
  const [barcodeCode, setBarcodeCode] = useState("");
  const [quickOrderLoading, setQuickOrderLoading] = useState(false);
  const [quickOrderResults, setQuickOrderResults] = useState<
    Array<{
      identifier: string;
      quantity: number;
      matched: boolean;
      productNumber: string | null;
      productName: string | null;
    }>
  | null>(null);
  const [barcodeProduct, setBarcodeProduct] = useState<{ productNumber: string; name: string } | null>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    setFiles((prev) => {
      const byKey = new Map(prev.map((f) => [`${f.name}:${f.size}`, f]));
      for (const f of next) byKey.set(`${f.name}:${f.size}`, f);
      return Array.from(byKey.values());
    });
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setIsLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      for (const file of files) formData.append("files", file);

      const headers: Record<string, string> = {};
      const csrfToken = getCsrfToken();
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

      const res = await fetch("/api/products/obx-search", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }

      const data: ObxSearchResult = await res.json();
      setResult(data);
    } catch (error: any) {
      toast({
        title: t("obxSearch.errorTitle"),
        description: error?.message || t("obxSearch.errorGeneric"),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const parseQuickOrderRows = (text: string) => {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;\t,]/).map((p) => p.trim());
        const identifier = parts[0] || "";
        const qty = Number(parts[1]?.replace(",", "."));
        return { identifier, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
      })
      .filter((row) => row.identifier.length > 0);
  };

  const runQuickOrderMatch = async () => {
    const rows = parseQuickOrderRows(quickOrderText);
    if (rows.length === 0) {
      toast({ title: t("common.error"), description: t("b2b.quickOrder.placeholder"), variant: "destructive" });
      return;
    }
    setQuickOrderLoading(true);
    setQuickOrderResults(null);
    try {
      const res = await apiRequest("POST", "/api/b2b/quick-order/match", {
        rows,
        customerId: quickOrderCustomerId.trim() || undefined,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || res.statusText);
      }
      const data = await res.json();
      setQuickOrderResults(data.matched || []);
    } catch (error: any) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    } finally {
      setQuickOrderLoading(false);
    }
  };

  const lookupBarcode = async () => {
    const code = barcodeCode.trim();
    if (!code) return;
    setBarcodeProduct(null);
    try {
      const res = await fetch(`/api/b2b/quick-order/barcode/${encodeURIComponent(code)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || res.statusText);
      }
      const data = await res.json();
      setBarcodeProduct({ productNumber: data.productNumber, name: data.name });
    } catch (error: any) {
      toast({ title: t("common.error"), description: error.message, variant: "destructive" });
    }
  };

  const copyMissing = async () => {
    if (!result?.missingCsv) return;
    try {
      await navigator.clipboard.writeText(result.missingCsv);
      toast({ title: t("obxSearch.copied") });
    } catch {
      toast({ title: t("obxSearch.copyFailed"), variant: "destructive" });
    }
  };

  const downloadCsv = () => {
    if (!result || result.missing.length === 0) return;
    const escapeCsv = (value: unknown): string => {
      const s = String(value ?? "");
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      t("obxSearch.table.artNr"),
      t("obxSearch.table.description"),
      t("obxSearch.table.occurrences"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const article of result.missing) {
      lines.push(
        [article.artNr, article.description ?? "", article.occurrences].map(escapeCsv).join(","),
      );
    }
    // UTF-8 BOM, damit Excel Umlaute korrekt darstellt
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "obx-fehlende-artikel.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const matchedByLabel = useMemo(
    () => ({
      productNumber: t("obxSearch.matchedBy.productNumber"),
      manufacturerNumber: t("obxSearch.matchedBy.manufacturerNumber"),
      wdu_ifs_productnumber: t("obxSearch.matchedBy.ifs"),
    }),
    [t],
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <FileUp className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("obxSearch.title")}</h1>
          <p className="text-muted-foreground">{t("obxSearch.description")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("obxSearch.uploadTitle")}</CardTitle>
          <CardDescription>{t("obxSearch.uploadHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(e.dataTransfer.files);
            }}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            data-testid="obx-dropzone"
          >
            <FileUp className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">{t("obxSearch.dropzone")}</p>
            <p className="text-sm text-muted-foreground">{t("obxSearch.dropzoneSub")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".obx,.xml,application/xml,text/xml"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              data-testid="obx-file-input"
            />
          </div>

          {files.length > 0 ? (
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={`${file.name}:${file.size}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t("obxSearch.removeFile")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <Button
            onClick={handleSubmit}
            disabled={files.length === 0 || isLoading}
            data-testid="obx-submit"
          >
            <Search className="h-4 w-4 mr-2" />
            {isLoading ? t("obxSearch.searching") : t("obxSearch.startSearch")}
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("obxSearch.stats.total")}</p>
                <p className="text-2xl font-semibold">{result.totalUniqueArticles}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {t("obxSearch.stats.found")}
                </p>
                <p className="text-2xl font-semibold text-green-600">{result.foundCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  {t("obxSearch.stats.missing")}
                </p>
                <p className="text-2xl font-semibold text-destructive">{result.missingCount}</p>
              </CardContent>
            </Card>
          </div>

          {result.files.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("obxSearch.filesTitle")}</CardTitle>
                <CardDescription>{t("obxSearch.filesHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.files.map((file, index) => {
                    const showCustomer = hasCustomerInfo(file.header);
                    return (
                      <div
                        key={`${file.fileName}:${index}`}
                        className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{file.fileName}</span>
                          <Badge variant="secondary" className="shrink-0">
                            {t("obxSearch.files.articleCount", { count: file.articleCount })}
                          </Badge>
                        </span>
                        {showCustomer ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setSelectedHeaderFile(file)}
                            data-testid={`obx-customer-info-${index}`}
                          >
                            <User className="h-4 w-4 mr-1" />
                            {t("obxSearch.files.customerInfo")}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("obxSearch.missingTitle")}</CardTitle>
              <CardDescription>{t("obxSearch.missingHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {result.missingCount === 0 ? (
                <p className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  {t("obxSearch.allFound")}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Textarea
                      readOnly
                      value={result.missingCsv}
                      className="font-mono text-sm h-28"
                      data-testid="obx-missing-csv"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={copyMissing} data-testid="obx-copy">
                        <Copy className="h-4 w-4 mr-2" />
                        {t("obxSearch.copyButton")}
                      </Button>
                      <Button variant="outline" onClick={downloadCsv} data-testid="obx-download">
                        <Download className="h-4 w-4 mr-2" />
                        {t("obxSearch.downloadButton")}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">{t("obxSearch.table.artNr")}</TableHead>
                          <TableHead>{t("obxSearch.table.description")}</TableHead>
                          <TableHead className="w-[120px] text-right">{t("obxSearch.table.occurrences")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.missing.map((article) => (
                          <TableRow key={article.artNr}>
                            <TableCell className="font-mono">{article.artNr}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {article.description || "—"}
                            </TableCell>
                            <TableCell className="text-right">{article.occurrences}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {result.foundCount > 0 ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{t("obxSearch.foundTitle")}</CardTitle>
                  <CardDescription>{t("obxSearch.foundHint")}</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowFound((v) => !v)}>
                  {showFound ? t("obxSearch.hide") : t("obxSearch.show")}
                </Button>
              </CardHeader>
              {showFound ? (
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[160px]">{t("obxSearch.table.artNr")}</TableHead>
                          <TableHead>{t("obxSearch.table.matchedProduct")}</TableHead>
                          <TableHead className="w-[180px]">{t("obxSearch.table.matchedBy")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.found.map((article) => (
                          <TableRow key={article.artNr}>
                            <TableCell className="font-mono">{article.artNr}</TableCell>
                            <TableCell>
                              <span className="font-medium">{article.productNumber}</span>
                              <span className="text-muted-foreground"> — {article.name}</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{matchedByLabel[article.matchedBy]}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("b2b.quickOrder.title")}</CardTitle>
          <CardDescription>{t("b2b.quickOrder.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder={t("b2b.assortments.customerIdPlaceholder")}
            value={quickOrderCustomerId}
            onChange={(e) => setQuickOrderCustomerId(e.target.value)}
          />
          <Textarea
            rows={6}
            placeholder={t("b2b.quickOrder.placeholder")}
            value={quickOrderText}
            onChange={(e) => setQuickOrderText(e.target.value)}
          />
          <Button onClick={runQuickOrderMatch} disabled={quickOrderLoading}>
            {quickOrderLoading ? t("common.loading") : t("b2b.quickOrder.match")}
          </Button>

          {quickOrderResults ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("b2b.productNumber")}</TableHead>
                    <TableHead>{t("b2b.name")}</TableHead>
                    <TableHead className="text-right">{t("b2b.quantity")}</TableHead>
                    <TableHead>{t("b2b.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quickOrderResults.map((row) => (
                    <TableRow key={`${row.identifier}-${row.quantity}`}>
                      <TableCell className="font-mono">{row.productNumber || row.identifier}</TableCell>
                      <TableCell>{row.productName || "—"}</TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={row.matched ? "default" : "destructive"}>
                          {row.matched ? t("b2b.quickOrder.matched") : t("b2b.quickOrder.notMatched")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 pt-2 border-t">
            <div className="flex-1 min-w-[200px] space-y-1">
              <p className="text-sm font-medium flex items-center gap-2">
                <ScanLine className="h-4 w-4" />
                {t("b2b.quickOrder.barcode")}
              </p>
              <Input
                placeholder={t("b2b.quickOrder.barcodePlaceholder")}
                value={barcodeCode}
                onChange={(e) => setBarcodeCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void lookupBarcode()}
              />
            </div>
            <Button variant="outline" onClick={() => void lookupBarcode()}>
              {t("b2b.quickOrder.lookup")}
            </Button>
          </div>
          {barcodeProduct ? (
            <p className="text-sm text-muted-foreground">
              {barcodeProduct.productNumber} — {barcodeProduct.name}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={!!selectedHeaderFile}
        onOpenChange={(open) => {
          if (!open) setSelectedHeaderFile(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              {t("obxSearch.customerModal.title")}
            </DialogTitle>
            <DialogDescription>{selectedHeaderFile?.fileName}</DialogDescription>
          </DialogHeader>

          {selectedHeaderFile?.header ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2">
                {selectedHeaderFile.header.customerNo ? (
                  <>
                    <dt className="text-muted-foreground">{t("obxSearch.customerModal.customerNo")}</dt>
                    <dd className="font-medium font-mono">{selectedHeaderFile.header.customerNo}</dd>
                  </>
                ) : null}
                {selectedHeaderFile.header.orderDate ? (
                  <>
                    <dt className="text-muted-foreground">{t("obxSearch.customerModal.orderDate")}</dt>
                    <dd className="font-medium">{selectedHeaderFile.header.orderDate}</dd>
                  </>
                ) : null}
                {selectedHeaderFile.header.iln ? (
                  <>
                    <dt className="text-muted-foreground">{t("obxSearch.customerModal.iln")}</dt>
                    <dd className="font-medium font-mono">{selectedHeaderFile.header.iln}</dd>
                  </>
                ) : null}
                {selectedHeaderFile.header.consignmentNumber ? (
                  <>
                    <dt className="text-muted-foreground">{t("obxSearch.customerModal.consignmentNumber")}</dt>
                    <dd className="font-medium">{selectedHeaderFile.header.consignmentNumber}</dd>
                  </>
                ) : null}
              </dl>

              {selectedHeaderFile.header.customerContact ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-1">{t("obxSearch.customerModal.customerContact")}</p>
                  <AddressBlock address={selectedHeaderFile.header.customerContact} />
                </div>
              ) : null}

              {selectedHeaderFile.header.oneTimeAddress ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium mb-1">{t("obxSearch.customerModal.oneTimeAddress")}</p>
                  <AddressBlock address={selectedHeaderFile.header.oneTimeAddress} />
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddressBlock({ address }: { address: ObxAddress }) {
  const name = [address.name1, address.name2].filter(Boolean).join(" ");
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(" ");
  const lines = [name, address.street, cityLine, address.country].filter(
    (line) => line && line.trim().length > 0,
  );
  if (lines.length === 0) return <p className="text-muted-foreground">—</p>;
  return (
    <div className="text-muted-foreground space-y-0.5">
      {lines.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}
