import { useState } from "react";
import { Download, FileSpreadsheet, Calendar, Filter, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type SalesChannel = {
  id: string;
  name: string;
};

type InvoiceDownloadResult = {
  orderNumber: string;
  status: "ok" | "not_found" | "no_invoice" | "error" | "forbidden";
  orderId?: string;
  downloadUrl?: string;
  filename?: string;
  message?: string;
};

export default function ExportPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [format, setFormat] = useState("csv");
  const [selectedSalesChannels, setSelectedSalesChannels] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "orderNumber",
    "customerName",
    "orderDate",
    "status",
    "totalAmount",
  ]);
  const [invoiceOrderNumbersText, setInvoiceOrderNumbersText] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<InvoiceDownloadResult[]>([]);
  const [isDownloadingInvoices, setIsDownloadingInvoices] = useState(false);

  // Fetch current user to check if admin
  const { data: userData } = useQuery({
    queryKey: ['/api/auth/me'],
  });

  const user = (userData as any)?.user;
  const isAdmin = user?.roleDetails?.name === 'Administrator' || user?.role === 'admin';

  // Fetch sales channels (only for admin)
  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
    enabled: isAdmin,
  });

  const availableColumns = [
    { id: "orderNumber", label: "Order Number" },
    { id: "customerName", label: "Customer Name" },
    { id: "customerEmail", label: "Customer Email" },
    { id: "orderDate", label: "Order Date" },
    { id: "status", label: "Status" },
    { id: "totalAmount", label: "Total Amount" },
    { id: "carrier", label: "Shipping Carrier" },
    { id: "trackingNumber", label: "Tracking Number" },
    { id: "invoiceNumber", label: "Invoice Number" },
    { id: "deliveryNoteNumber", label: "Delivery Note Number" },
    { id: "erpNumber", label: "ERP Number" },
  ];

  const toggleColumn = (columnId: string) => {
    setSelectedColumns((prev) =>
      prev.includes(columnId)
        ? prev.filter((id) => id !== columnId)
        : [...prev, columnId]
    );
  };

  const toggleSalesChannel = (channelId: string) => {
    setSelectedSalesChannels((prev) =>
      prev.includes(channelId)
        ? prev.filter((id) => id !== channelId)
        : [...prev, channelId]
    );
  };

  const parseOrderNumbers = (value: string) =>
    Array.from(new Set(value.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean)));

  const updateInvoiceResult = (orderNumber: string, updates: Partial<InvoiceDownloadResult>) => {
    setInvoiceResults((prev) =>
      prev.map((result) =>
        result.orderNumber === orderNumber ? { ...result, ...updates } : result
      )
    );
  };

  const handleExport = async () => {
    try {
      toast({
        title: "Export started",
        description: `Your ${format.toUpperCase()} file is being generated...`,
      });

      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
      }

      const response = await fetch('/api/orders/export', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dateFrom,
          dateTo,
          format,
          columns: selectedColumns,
          salesChannelIds: isAdmin && selectedSalesChannels.length > 0 ? selectedSalesChannels : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get filename from Content-Disposition header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `orders-export-${Date.now()}.${format}`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Export completed",
        description: `Your ${format.toUpperCase()} file has been downloaded.`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export failed",
        description: "An error occurred while exporting the orders.",
        variant: "destructive",
      });
    }
  };

  const handleInvoiceDownload = async () => {
    const orderNumbers = parseOrderNumbers(invoiceOrderNumbersText);
    if (orderNumbers.length === 0) {
      toast({
        title: "Please enter order numbers",
        description: "Please enter order numbers",
        variant: "destructive",
      });
      return;
    }

    setIsDownloadingInvoices(true);
    setInvoiceResults([]);

    try {
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
      }

      const response = await fetch("/api/orders/invoices/by-order-numbers", {
        method: "POST",
        headers,
        body: JSON.stringify({ orderNumbers }),
      });

      if (!response.ok) {
        throw new Error("Invoice resolve failed");
      }

      const data = await response.json();
      const results: InvoiceDownloadResult[] = data.results || [];
      setInvoiceResults(results);

      const downloadable = results.filter((result) => result.status === "ok" && result.downloadUrl);
      if (downloadable.length === 0) {
        toast({
          title: "Invoices could not be prepared",
          description: "Invoices could not be prepared",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Download started",
        description: "Preparing invoices...",
      });

      for (const result of downloadable) {
        try {
          const downloadResponse = await fetch(result.downloadUrl as string);

          if (!downloadResponse.ok) {
            throw new Error("Invoice download failed");
          }

          const arrayBuffer = await downloadResponse.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: "application/pdf" });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = result.filename || `invoice-${result.orderNumber}.pdf`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } catch (error) {
          console.error("Invoice download error:", error);
          updateInvoiceResult(result.orderNumber, {
            status: "error",
            message: "Download failed",
          });
        }
      }

      toast({
        title: "Downloads complete",
        description: "Downloads complete",
      });
    } catch (error) {
      console.error("Invoice resolve error:", error);
      toast({
        title: "Invoices could not be prepared",
        description: "Invoices could not be prepared",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingInvoices(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">Export & Reports</h1>
        <p className="text-sm text-muted-foreground">
          Download order data in various formats
        </p>
      </div>

      <div className="space-y-6">
        <Card className="p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Date Range
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium mb-2">From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-export-date-from"
              />
            </div>
            <div>
              <Label className="text-sm font-medium mb-2">To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-export-date-to"
              />
            </div>
          </div>
        </Card>

        {isAdmin && (
          <Card className="p-6">
            <h2 className="text-sm font-medium uppercase tracking-wide mb-4 flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Sales Channels (Optional)
            </h2>
            <div className="space-y-3">
              {salesChannels.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {salesChannels.map((channel) => (
                    <div key={channel.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`channel-${channel.id}`}
                        checked={selectedSalesChannels.includes(channel.id)}
                        onCheckedChange={() => toggleSalesChannel(channel.id)}
                        data-testid={`checkbox-channel-${channel.id}`}
                      />
                      <Label
                        htmlFor={`channel-${channel.id}`}
                        className="text-sm font-normal cursor-pointer"
                      >
                        {channel.name}
                      </Label>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Loading sales channels...</p>
              )}
              {selectedSalesChannels.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-sm text-muted-foreground mb-2">
                    Selected: {selectedSalesChannels.length} channel{selectedSalesChannels.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSalesChannels.map((channelId) => {
                      const channel = salesChannels.find(c => c.id === channelId);
                      return channel ? (
                        <Badge key={channelId} variant="secondary" className="text-xs">
                          {channel.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
              {selectedSalesChannels.length === 0 && (
                <p className="text-sm text-muted-foreground italic mt-2">
                  No channels selected - all channels will be exported
                </p>
              )}
            </div>
          </Card>
        )}

        <Card className="p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Export Format
          </h2>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger data-testid="select-export-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV (Comma-Separated Values)</SelectItem>
              <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4">
            Select Columns
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {availableColumns.map((column) => (
              <div key={column.id} className="flex items-center gap-2">
                <Checkbox
                  id={column.id}
                  checked={selectedColumns.includes(column.id)}
                  onCheckedChange={() => toggleColumn(column.id)}
                  data-testid={`checkbox-column-${column.id}`}
                />
                <Label
                  htmlFor={column.id}
                  className="text-sm font-normal cursor-pointer"
                >
                  {column.label}
                </Label>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              {selectedColumns.length} column{selectedColumns.length !== 1 ? "s" : ""}{" "}
              selected
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoices (PDF)
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Enter order numbers separated by line breaks or commas
          </p>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Order numbers</Label>
            <Textarea
              value={invoiceOrderNumbersText}
              onChange={(e) => setInvoiceOrderNumbersText(e.target.value)}
              placeholder={"e.g. 10001\n10002, 10003"}
              data-testid="textarea-invoice-order-numbers"
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleInvoiceDownload}
              disabled={isDownloadingInvoices}
              data-testid="button-download-invoices"
            >
              <Download className="h-4 w-4 mr-1" />
              Download invoices
            </Button>
          </div>
          {invoiceResults.length > 0 && (
            <div className="mt-4 space-y-2 border-t pt-4">
              {invoiceResults.map((result) => (
                <div key={result.orderNumber} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{result.orderNumber}</span>
                  <Badge
                    variant={
                      result.status === "ok"
                        ? "secondary"
                        : result.status === "no_invoice"
                        ? "outline"
                        : "destructive"
                    }
                    className="text-xs"
                  >
                    {result.status === "ok"
                      ? "Ready"
                      : result.status === "not_found"
                      ? "Not found"
                      : result.status === "no_invoice"
                      ? "No invoice"
                      : result.status === "forbidden"
                      ? "No access"
                      : "Error"}
                  </Badge>
                  {result.message && (
                    <span className="text-muted-foreground">{result.message}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setFormat("csv");
              setSelectedSalesChannels([]);
              setSelectedColumns(["orderNumber", "customerName", "orderDate", "status", "totalAmount"]);
              setInvoiceOrderNumbersText("");
              setInvoiceResults([]);
            }}
            data-testid="button-reset-export"
          >
            Reset
          </Button>
          <Button onClick={handleExport} data-testid="button-export-download">
            <Download className="h-4 w-4 mr-1" />
            Download Export
          </Button>
        </div>
      </div>
    </div>
  );
}
