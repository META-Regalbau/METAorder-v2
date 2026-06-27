/**
 * Custom React Flow node - System (center)
 * Styled like original: gradient, accent border, icon
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";

export function NodeSystem({ data, selected }: NodeProps) {
  const label = String(data?.label ?? "");
  const subLabel = String(data?.subLabel ?? "");
  return (
    <div
      className={`cpq-node-system min-w-[140px] px-4 py-5 rounded-2xl text-center border-2 bg-gradient-to-br from-primary/20 to-primary/5 shadow-lg transition-all ${
        selected ? "border-primary shadow-primary/20" : "border-primary/70"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2" />
      <div className="text-2xl mb-1.5">🏗️</div>
      <div className="text-sm font-bold">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{subLabel}</div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2" />
    </div>
  );
}
