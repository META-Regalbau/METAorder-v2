import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import type { OrderStatus } from "@shared/schema";

interface OrderFiltersProps {
  statusFilter: OrderStatus | "all";
  onStatusFilterChange: (status: OrderStatus | "all") => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
  onClearFilters: () => void;
  activeFiltersCount: number;
}

export default function OrderFilters({
  statusFilter,
  onStatusFilterChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClearFilters,
  activeFiltersCount,
}: OrderFiltersProps) {
  const { t } = useTranslation();
  
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <h2 className="text-sm font-medium uppercase tracking-wide">{t('filters.title')}</h2>
          {activeFiltersCount > 0 && (
            <span className="text-xs text-muted-foreground">({activeFiltersCount} {t('filters.active')})</span>
          )}
        </div>
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} data-testid="button-clear-filters">
            <X className="h-3 w-3 mr-1" />
            {t('filters.clearAll')}
          </Button>
        )}
      </div>
      
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium mb-2">{t('filters.statusLabel')}</Label>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger data-testid="select-status-filter">
              <SelectValue placeholder={t('filters.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
              <SelectItem value="open">{t('status.open')}</SelectItem>
              <SelectItem value="in_progress">{t('status.in_progress')}</SelectItem>
              <SelectItem value="completed">{t('status.completed')}</SelectItem>
              <SelectItem value="cancelled">{t('status.cancelled')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-medium mb-2">{t('filters.dateFrom')}</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              data-testid="input-date-from"
            />
          </div>
          <div>
            <Label className="text-sm font-medium mb-2">{t('filters.dateTo')}</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              data-testid="input-date-to"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
