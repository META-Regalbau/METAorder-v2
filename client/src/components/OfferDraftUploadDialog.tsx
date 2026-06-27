import { CommercialUnifiedDraftUploadDialog } from "@/components/CommercialUnifiedDraftUploadDialog";
import type { CommercialUnifiedUploadResult } from "@/lib/commercialUnifiedDraftUpload";

interface OfferDraftUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess: (result: CommercialUnifiedUploadResult) => void;
}

export function OfferDraftUploadDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: OfferDraftUploadDialogProps) {
  return (
    <CommercialUnifiedDraftUploadDialog
      open={open}
      onOpenChange={onOpenChange}
      i18nPrefix="offerDrafts.upload"
      showContextFields={false}
      onSuccess={onUploadSuccess}
      dataTestId="dialog-upload-offer"
    />
  );
}
