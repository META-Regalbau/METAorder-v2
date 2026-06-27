/**
 * Custom React Flow node - Component Type (orbit around system)
 * Styled like original: card with icon, label, count
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";

const ROLE_ICONS: Record<string, string> = {
  frame: "📐",
  beam: "🔩",
  shelf: "📦",
  accessory: "🔧",
  connector: "🔗",
};

export function NodeType({ data, selected }: NodeProps) {
  const icon = ROLE_ICONS[(data?.role as string) || "accessory"] ?? "📦";
  const label = String(data?.label ?? "");
  const subLabel = String(data?.subLabel ?? "");
  return (
    <div
      className={`cpq-node-type min-w-[120px] px-3 py-3.5 rounded-xl text-center border bg-card shadow-md transition-all hover:border-muted-foreground ${
        selected ? "border-primary shadow-primary/20" : "border-border"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2" />
      <div className="text-xl mb-1">{icon}</div>
      <div className="text-xs font-semibold">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{subLabel}</div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2" />
    </div>
  );
}
