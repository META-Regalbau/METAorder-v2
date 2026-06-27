import { CommercialUnifiedDraftUploadDialog } from "@/components/CommercialUnifiedDraftUploadDialog";
import type { CommercialUnifiedUploadResult } from "@/lib/commercialUnifiedDraftUpload";

interface OrderDraftUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess: (result: CommercialUnifiedUploadResult) => void;
}

export function OrderDraftUploadDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: OrderDraftUploadDialogProps) {
  return (
    <CommercialUnifiedDraftUploadDialog
      open={open}
      onOpenChange={onOpenChange}
      i18nPrefix="orderDrafts.upload"
      showContextFields={false}
      onSuccess={onUploadSuccess}
      dataTestId="dialog-upload"
    />
  );
}
