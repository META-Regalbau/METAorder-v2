import { Package } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type CpqPreviewLineItem = {
  productId: string;
  productNumber: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  componentType: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  length?: number;
};

function formatDimensions(item: CpqPreviewLineItem): string | null {
  const parts: string[] = [];
  if (item.width != null) parts.push(`${Math.round(item.width)} B`);
  if (item.height != null) parts.push(`${Math.round(item.height)} H`);
  if (item.length != null) parts.push(`${Math.round(item.length)} T`);
  return parts.length > 0 ? parts.join(" × ") + " mm" : null;
}

type CpqProductPreviewProps = {
  items: CpqPreviewLineItem[];
};

export default function CpqProductPreview({ items }: CpqProductPreviewProps) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">Gewählte Produkte</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, index) => {
          const dims = formatDimensions(item);
          return (
            <Card key={`${item.productId}-${index}`} className="overflow-hidden">
              <div className="flex gap-3 p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-start gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {item.componentType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">× {item.quantity}</span>
                  </div>
                  <p className="truncate text-sm font-medium" title={item.name}>
                    {item.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{item.productNumber}</p>
                  {dims ? <p className="text-xs text-muted-foreground">{dims}</p> : null}
                  <p className="text-sm font-medium">
                    {item.unitPrice.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">/ Stk.</span>
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
