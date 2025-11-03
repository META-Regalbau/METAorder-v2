import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

interface Template {
  id: string;
  title: string;
  category?: string | null;
  content: string;
}

interface CreateTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingTemplate?: Template | null;
}

export default function CreateTemplateDialog({
  isOpen,
  onClose,
  editingTemplate,
}: CreateTemplateDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (editingTemplate) {
      setTitle(editingTemplate.title);
      setCategory(editingTemplate.category || "");
      setContent(editingTemplate.content);
    } else {
      setTitle("");
      setCategory("");
      setContent("");
    }
  }, [editingTemplate, isOpen]);

  const createTemplateMutation = useMutation({
    mutationFn: async (data: { title: string; category?: string; content: string }) => {
      const endpoint = editingTemplate 
        ? `/api/templates/${editingTemplate.id}`
        : "/api/templates";
      const method = editingTemplate ? "PUT" : "POST";
      const response = await apiRequest(method, endpoint, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      toast({
        title: editingTemplate ? t('templates.updateSuccess') : t('templates.createSuccess'),
      });
      resetForm();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: editingTemplate ? t('templates.updateFailed') : t('templates.createFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setTitle("");
    setCategory("");
    setContent("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !content.trim()) {
      toast({
        title: t('errors.validationFailed'),
        description: t('templates.titleRequired') + " / " + t('templates.contentRequired'),
        variant: "destructive",
      });
      return;
    }

    createTemplateMutation.mutate({
      title: title.trim(),
      category: category.trim() || undefined,
      content: content.trim(),
    });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-create-template">
        <DialogHeader>
          <DialogTitle>
            {editingTemplate ? t('templates.editTemplate') : t('templates.createTemplate')}
          </DialogTitle>
          <DialogDescription>
            {editingTemplate 
              ? "Bearbeiten Sie die Vorlage"
              : "Erstellen Sie eine neue Vorlage für häufig verwendete Antworten"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title" className="text-sm font-medium mb-2">
              {t('templates.templateTitle')} *
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('templates.titlePlaceholder')}
              data-testid="input-template-title"
            />
          </div>

          <div>
            <Label htmlFor="category" className="text-sm font-medium mb-2">
              {t('templates.templateCategory')}
            </Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('templates.categoryPlaceholder')}
              data-testid="input-template-category"
            />
          </div>

          <div>
            <Label htmlFor="content" className="text-sm font-medium mb-2">
              {t('templates.templateContent')} *
            </Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('templates.contentPlaceholder')}
              rows={8}
              data-testid="textarea-template-content"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              data-testid="button-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createTemplateMutation.isPending}
              data-testid="button-submit-template"
            >
              {createTemplateMutation.isPending 
                ? t('common.saving') 
                : editingTemplate 
                ? t('common.save') 
                : t('common.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
