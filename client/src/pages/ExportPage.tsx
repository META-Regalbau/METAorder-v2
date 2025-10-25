import { useState } from "react";
import { Download, FileSpreadsheet, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

export default function ExportPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [format, setFormat] = useState("csv");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([
    "orderNumber",
    "customerName",
    "orderDate",
    "status",
    "totalAmount",
  ]);

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

  const handleExport = () => {
    console.log("Exporting with:", { dateFrom, dateTo, format, selectedColumns });
    toast({
      title: "Export started",
      description: `Your ${format.toUpperCase()} file is being generated...`,
    });
    // TODO: Implement actual export functionality
  };

  return (
    <div className="max-w-4xl">
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

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setFormat("csv");
              setSelectedColumns(["orderNumber", "customerName", "orderDate", "status", "totalAmount"]);
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
