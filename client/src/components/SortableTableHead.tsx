import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SortDirection = "asc" | "desc";

interface SortableTableHeadProps<T extends string> {
  label: string;
  sortKey: T;
  activeKey?: T;
  direction?: SortDirection;
  onSort?: (key: T) => void;
  className?: string;
  align?: "left" | "right" | "center";
}

export default function SortableTableHead<T extends string>({
  label,
  sortKey,
  activeKey,
  direction = "asc",
  onSort,
  className,
  align = "left",
}: SortableTableHeadProps<T>) {
  if (!onSort) {
    return <TableHead className={className}>{label}</TableHead>;
  }

  const isActive = activeKey === sortKey;
  const Icon = isActive ? (direction === "asc" ? ChevronUp : ChevronDown) : ArrowUpDown;
  const alignClass =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <TableHead className={className}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-8 px-2 w-full", alignClass)}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon className={cn("h-3 w-3 ml-1", isActive ? "opacity-90" : "opacity-50")} />
      </Button>
    </TableHead>
  );
}
