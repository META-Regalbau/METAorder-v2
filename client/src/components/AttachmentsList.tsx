import { Download, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TicketAttachment } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";

interface AttachmentsListProps {
  ticketId: string;
  attachments: TicketAttachment[];
  canDelete?: boolean;
}

export function AttachmentsList({ ticketId, attachments, canDelete = false }: AttachmentsListProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [attachmentToDelete, setAttachmentToDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (attachmentId: string) => {
      return await apiRequest('DELETE', `/api/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      toast({
        title: t('tickets.attachmentDeleted'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/tickets', ticketId, 'attachments'] });
      setDeleteDialogOpen(false);
      setAttachmentToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: t('tickets.uploadFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDownload = async (attachment: TicketAttachment) => {
    try {
      const response = await fetch(`/api/attachments/${attachment.id}/download`, {
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: t('tickets.uploadFailed'),
        description: 'Failed to download attachment',
        variant: "destructive",
      });
    }
  };

  const handleDeleteClick = (attachmentId: string) => {
    setAttachmentToDelete(attachmentId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (attachmentToDelete) {
      deleteMutation.mutate(attachmentToDelete);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) {
      return <ImageIcon className="h-5 w-5 text-blue-500" />;
    }
    if (mimeType === 'application/pdf') {
      return <FileText className="h-5 w-5 text-red-500" />;
    }
    return <FileText className="h-5 w-5 text-muted-foreground" />;
  };

  if (attachments.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-attachments">
        {t('tickets.noAttachments')}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex items-center gap-3 p-3 rounded-md bg-muted hover-elevate"
            data-testid={`attachment-item-${attachment.id}`}
          >
            <div className="flex-shrink-0">
              {getFileIcon(attachment.mimeType)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{attachment.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {(attachment.fileSize / 1024).toFixed(1)} KB
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDownload(attachment)}
                title={t('tickets.downloadAttachment')}
                data-testid={`button-download-attachment-${attachment.id}`}
              >
                <Download className="h-4 w-4" />
              </Button>
              {canDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteClick(attachment.id)}
                  title={t('tickets.deleteAttachment')}
                  data-testid={`button-delete-attachment-${attachment.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="dialog-delete-attachment">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tickets.deleteAttachment')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('common.confirmDelete')} {t('common.actionCannotBeUndone')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
