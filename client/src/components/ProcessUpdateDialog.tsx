import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ProcessUpdate {
  id: string;
  title: string;
  content: string;
  tags?: string[] | null;
  effectiveDate: string;
}

interface ProcessUpdateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingUpdate?: ProcessUpdate | null;
}

const formatDateForInput = (value?: string) => {
  if (!value) return "";
  try {
    return format(new Date(value), "yyyy-MM-dd");
  } catch {
    return "";
  }
};

export default function ProcessUpdateDialog({
  isOpen,
  onClose,
  editingUpdate,
}: ProcessUpdateDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const defaultDate = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  useEffect(() => {
    if (editingUpdate) {
      setTitle(editingUpdate.title);
      setContent(editingUpdate.content);
      setTags(editingUpdate.tags?.join(", ") || "");
      setEffectiveDate(formatDateForInput(editingUpdate.effectiveDate));
    } else {
      setTitle("");
      setContent("");
      setTags("");
      setEffectiveDate(defaultDate);
    }
  }, [editingUpdate, isOpen, defaultDate]);

  const processUpdateMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; tags?: string[]; effectiveDate: string }) => {
      const endpoint = editingUpdate
        ? `/api/process-updates/${editingUpdate.id}`
        : "/api/process-updates";
      const method = editingUpdate ? "PUT" : "POST";
      const response = await apiRequest(method, endpoint, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/process-updates"] });
      toast({
        title: editingUpdate ? t("processUpdates.updateSuccess") : t("processUpdates.createSuccess"),
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: editingUpdate ? t("processUpdates.updateFailed") : t("processUpdates.createFailed"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!title.trim() || !content.trim() || !effectiveDate) {
      toast({
        title: t("errors.validationFailed"),
        description: t("processUpdates.validationRequired"),
        variant: "destructive",
      });
      return;
    }

    const tagList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    processUpdateMutation.mutate({
      title: title.trim(),
      content: content.trim(),
      tags: tagList.length > 0 ? tagList : undefined,
      effectiveDate,
    });
  };

  const handleClose = () => {
    setTitle("");
    setContent("");
    setTags("");
    setEffectiveDate(defaultDate);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-process-update">
        <DialogHeader>
          <DialogTitle>
            {editingUpdate ? t("processUpdates.editTitle") : t("processUpdates.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {editingUpdate ? t("processUpdates.editDescription") : t("processUpdates.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="process-title" className="text-sm font-medium mb-2">
              {t("processUpdates.fields.title")} *
            </Label>
            <Input
              id="process-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("processUpdates.placeholders.title")}
              data-testid="input-process-title"
            />
          </div>

          <div>
            <Label htmlFor="process-date" className="text-sm font-medium mb-2">
              {t("processUpdates.fields.effectiveDate")} *
            </Label>
            <Input
              id="process-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              data-testid="input-process-effective-date"
            />
          </div>

          <div>
            <Label htmlFor="process-tags" className="text-sm font-medium mb-2">
              {t("processUpdates.fields.tags")}
            </Label>
            <Input
              id="process-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder={t("processUpdates.placeholders.tags")}
              data-testid="input-process-tags"
            />
          </div>

          <div>
            <Label htmlFor="process-content" className="text-sm font-medium mb-2">
              {t("processUpdates.fields.content")} *
            </Label>
            <Textarea
              id="process-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={t("processUpdates.placeholders.content")}
              rows={8}
              data-testid="textarea-process-content"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel-process-update">
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={processUpdateMutation.isPending} data-testid="button-submit-process-update">
              {processUpdateMutation.isPending
                ? t("common.saving")
                : editingUpdate
                ? t("common.save")
                : t("common.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
