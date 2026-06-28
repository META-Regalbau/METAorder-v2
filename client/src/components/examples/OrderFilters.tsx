import { useState } from 'react';
import OrderFilters, { type InvoiceFilter, type OrderNumberFilter } from '../OrderFilters';
import type { OrderStatus } from '@shared/schema';

export default function OrderFiltersExample() {
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [orderNumberFilter, setOrderNumberFilter] = useState<OrderNumberFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  
  const activeFiltersCount = [
    statusFilter !== "all",
    invoiceFilter !== "all",
    orderNumberFilter !== "all",
    dateFrom !== "",
    dateTo !== ""
  ].filter(Boolean).length;
  
  return (
    <div className="p-4 max-w-sm">
      <OrderFilters
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        invoiceFilter={invoiceFilter}
        onInvoiceFilterChange={setInvoiceFilter}
        orderNumberFilter={orderNumberFilter}
        onOrderNumberFilterChange={setOrderNumberFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClearFilters={() => {
          setStatusFilter("all");
          setInvoiceFilter("all");
          setOrderNumberFilter("all");
          setDateFrom("");
          setDateTo("");
        }}
        activeFiltersCount={activeFiltersCount}
      />
    </div>
  );
}
