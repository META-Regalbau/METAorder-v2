import { useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Megaphone } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card data-testid="widget-process-updates">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("processUpdates.title")}</CardTitle>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setIsDialogOpen(true)} data-testid="button-create-process-update">
              <Plus className="h-4 w-4 mr-2" />
              {t("processUpdates.createButton")}
            </Button>
          )}
        </div>
        <CardDescription>{t("processUpdates.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : updates.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("processUpdates.empty")}</div>
        ) : (
          <div className="space-y-4">
            {updates.map((update) => (
              <div key={update.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{update.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("processUpdates.effectiveDate")}{" "}
                      {format(new Date(update.effectiveDate), "dd.MM.yyyy")}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(update)}
                        data-testid={`button-edit-process-update-${update.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeletingUpdateId(update.id)}
                        data-testid={`button-delete-process-update-${update.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {update.tags && update.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {update.tags.map((tag) => (
                      <Badge key={`${update.id}-${tag}`} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="text-sm text-muted-foreground line-clamp-3">{update.content}</div>

                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedUpdate(update)}
                    data-testid={`button-view-process-update-${update.id}`}
                  >
                    {t("processUpdates.viewDetails")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

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
    </Card>
  );
}
