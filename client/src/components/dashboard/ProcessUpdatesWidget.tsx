import { useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Megaphone } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@shared/schema";
import ProcessUpdateDialog from "@/components/ProcessUpdateDialog";

interface ProcessUpdate {
  id: string;
  title: string;
  content: string;
  tags?: string[] | null;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

interface ProcessUpdatesWidgetProps {
  userPermissions: Role["permissions"];
}

export default function ProcessUpdatesWidget({ userPermissions }: ProcessUpdatesWidgetProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<ProcessUpdate | null>(null);
  const [deletingUpdateId, setDeletingUpdateId] = useState<string | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<ProcessUpdate | null>(null);

  const canManage = !!userPermissions?.manageSettings;

  const { data: updates = [], isLoading } = useQuery<ProcessUpdate[]>({
    queryKey: ["/api/process-updates"],
    retry: false,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/process-updates/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/process-updates"] });
      toast({ title: t("processUpdates.deleteSuccess") });
      setDeletingUpdateId(null);
    },
    onError: (error: Error) => {
      toast({
        title: t("processUpdates.deleteFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = (update: ProcessUpdate) => {
    setEditingUpdate(update);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingUpdate(null);
  };

  return (
    <div className="mcard" data-testid="widget-process-updates">
      <div className="mcard-head">
        <div className="mcard-head-left">
          <Megaphone className="h-5 w-5" />
          <div>
            <h3 className="mcard-title">{t("processUpdates.title")}</h3>
            <p className="mcard-desc">{t("processUpdates.description")}</p>
          </div>
        </div>
        {canManage && (
          <button
            className="mbtn primary sm"
            onClick={() => setIsDialogOpen(true)}
            data-testid="button-create-process-update"
          >
            <Plus className="h-4 w-4" />
            {t("processUpdates.createButton")}
          </button>
        )}
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : updates.length === 0 ? (
          <div className="mempty">{t("processUpdates.empty")}</div>
        ) : (
          <div className="mlist">
            {updates.map((update) => (
              <div
                key={update.id}
                className="mrow"
                style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div className="mrow-main">
                    <div className="mrow-title truncate">{update.title}</div>
                    <div className="mrow-meta">
                      <span>
                        {t("processUpdates.effectiveDate")}{" "}
                        {format(new Date(update.effectiveDate), "dd.MM.yyyy")}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div className="mrow-side" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="mbtn icon ghost"
                        onClick={() => handleEdit(update)}
                        data-testid={`button-edit-process-update-${update.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="mbtn icon ghost"
                        onClick={() => setDeletingUpdateId(update.id)}
                        data-testid={`button-delete-process-update-${update.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {update.tags && update.tags.length > 0 && (
                  <div className="mrow-badges">
                    {update.tags.map((tag) => (
                      <span key={`${update.id}-${tag}`} className="mbadge b-outline">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mrow-snippet" style={{ WebkitLineClamp: 3 }}>
                  {update.content}
                </p>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className="mbtn ghost sm"
                    onClick={() => setSelectedUpdate(update)}
                    data-testid={`button-view-process-update-${update.id}`}
                  >
                    {t("processUpdates.viewDetails")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ProcessUpdateDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        editingUpdate={editingUpdate}
      />

      <AlertDialog open={!!deletingUpdateId} onOpenChange={() => setDeletingUpdateId(null)}>
        <AlertDialogContent data-testid="dialog-delete-process-update">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("processUpdates.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("processUpdates.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-process-update">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingUpdateId && deleteMutation.mutate(deletingUpdateId)}
              data-testid="button-confirm-delete-process-update"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!selectedUpdate} onOpenChange={() => setSelectedUpdate(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-process-update-details">
          <DialogHeader>
            <DialogTitle>{selectedUpdate?.title}</DialogTitle>
            <DialogDescription>
              {selectedUpdate?.effectiveDate
                ? `${t("processUpdates.effectiveDate")} ${format(
                    new Date(selectedUpdate.effectiveDate),
                    "dd.MM.yyyy"
                  )}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedUpdate?.tags && selectedUpdate.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedUpdate.tags.map((tag) => (
                <Badge key={`detail-${tag}`} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <div className="text-sm whitespace-pre-wrap">{selectedUpdate?.content}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
