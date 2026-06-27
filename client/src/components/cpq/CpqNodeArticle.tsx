/**
 * Custom React Flow node - Article/Mapping (around type)
 * Styled like original: compact card with status dot, label, SKU
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function NodeArticle({ data, selected }: NodeProps) {
  const label = String(data?.label ?? "");
  const sku = String(data?.sku ?? data?.label ?? "");
  return (
    <div
      className={`cpq-node-article flex items-center gap-2 px-3 py-2 rounded-lg border bg-card shadow-sm whitespace-nowrap transition-all hover:border-muted-foreground ${
        selected ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2" />
      <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10.5px] text-muted-foreground font-mono">{sku}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2" />
    </div>
  );
}
