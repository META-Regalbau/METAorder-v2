import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  columns: number;
  rows?: number;
  showHeader?: boolean;
}

export default function TableSkeleton({ columns, rows = 5, showHeader = true }: TableSkeletonProps) {
  return (
    <div className="border rounded-lg">
      <Table>
        {showHeader && (
          <TableHeader>
            <TableRow className="bg-muted/50">
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={`header-${i}`}>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={`row-${rowIndex}`}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <TableCell key={`cell-${rowIndex}-${colIndex}`}>
                  <Skeleton 
                    className="h-4" 
                    style={{ 
                      width: colIndex === 0 
                        ? '120px' 
                        : colIndex === columns - 1 
                        ? '80px' 
                        : `${80 + Math.random() * 100}px`
                    }} 
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
