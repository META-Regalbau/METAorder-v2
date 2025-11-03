import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BulkActionsBarProps {
  selectedCount: number;
  onUpdateTracking: () => void;
  onCancel: () => void;
}

export default function BulkActionsBar({
  selectedCount,
  onUpdateTracking,
  onCancel,
}: BulkActionsBarProps) {
  const { t } = useTranslation();

  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50" data-testid="bar-bulk-actions">
      <Card className="p-4 shadow-lg border-2">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium" data-testid="text-selected-count">
            {t('bulkActions.selectedCount', { count: selectedCount })}
          </span>
          <div className="flex gap-2">
            <Button
              onClick={onUpdateTracking}
              data-testid="button-update-tracking"
            >
              {t('bulkActions.updateTracking')}
            </Button>
            <Button
              variant="outline"
              onClick={onCancel}
              data-testid="button-cancel-selection"
            >
              <X className="h-4 w-4 mr-2" />
              {t('bulkActions.cancel')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
