import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import CreateTemplateDialog from "@/components/CreateTemplateDialog";
import type { Role } from "@shared/schema";

interface Template {
  id: string;
  title: string;
  category?: string | null;
  content: string;
  createdByUserId: string;
  createdAt: string;
}

interface TemplatesPageProps {
  userPermissions: Role['permissions'];
}

export default function TemplatesPage({ userPermissions }: TemplatesPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // Check permissions
  if (!userPermissions?.manageTickets) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Card className="p-8">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">{t('common.accessDenied')}</h2>
            <p className="text-muted-foreground">{t('common.noPermission')}</p>
          </div>
        </Card>
      </div>
    );
  }

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['/api/templates'],
    retry: false,
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/templates/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/templates'] });
      toast({
        title: t('templates.deleteSuccess'),
      });
      setDeletingTemplateId(null);
    },
    onError: (error: Error) => {
      toast({
        title: t('templates.deleteFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEdit = (template: Template) => {
    setEditingTemplate(template);
    setIsCreateDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteTemplateMutation.mutate(id);
  };

  const handleCloseDialog = () => {
    setIsCreateDialogOpen(false);
    setEditingTemplate(null);
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1" data-testid="text-templates-title">
            {t('templates.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {templates.length} {templates.length === 1 ? 'template' : 'templates'}
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-template">
          <Plus className="h-4 w-4 mr-2" />
          {t('templates.createTemplate')}
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-8">
          <div className="text-center text-muted-foreground" data-testid="text-loading">
            {t('common.loading')}
          </div>
        </Card>
      ) : templates.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <h3 className="text-lg font-medium mb-2" data-testid="text-no-templates">
              {t('templates.noTemplates')}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('templates.noTemplatesDescription')}
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-template">
              <Plus className="h-4 w-4 mr-2" />
              {t('templates.createTemplate')}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4" data-testid="list-templates">
          {templates.map((template) => (
            <Card key={template.id} data-testid={`card-template-${template.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="mb-1" data-testid={`text-template-title-${template.id}`}>
                      {template.title}
                    </CardTitle>
                    {template.category && (
                      <Badge variant="secondary" className="mb-2" data-testid={`badge-category-${template.id}`}>
                        {template.category}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(template)}
                      data-testid={`button-edit-${template.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeletingTemplateId(template.id)}
                      data-testid={`button-delete-${template.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="line-clamp-3" data-testid={`text-template-content-${template.id}`}>
                  {template.content}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateTemplateDialog
        isOpen={isCreateDialogOpen}
        onClose={handleCloseDialog}
        editingTemplate={editingTemplate}
      />

      <AlertDialog open={!!deletingTemplateId} onOpenChange={() => setDeletingTemplateId(null)}>
        <AlertDialogContent data-testid="dialog-delete-template">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('templates.deleteTemplate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('templates.deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingTemplateId && handleDelete(deletingTemplateId)}
              data-testid="button-confirm-delete"
            >
              {deleteTemplateMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
