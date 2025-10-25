import { useState } from 'react';
import OrderFilters from '../OrderFilters';
import type { OrderStatus } from '@shared/schema';

export default function OrderFiltersExample() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  
  const activeFiltersCount = [
    statusFilter !== "all",
    dateFrom !== "",
    dateTo !== ""
  ].filter(Boolean).length;
  
  return (
    <div className="p-4 max-w-sm">
      <OrderFilters
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClearFilters={() => {
          setStatusFilter("all");
          setDateFrom("");
          setDateTo("");
        }}
        activeFiltersCount={activeFiltersCount}
      />
    </div>
  );
}
