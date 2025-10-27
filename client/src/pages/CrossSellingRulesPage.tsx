import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import type { CrossSellingRule } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import AddRuleDialog from "@/components/AddRuleDialog";
import EditRuleDialog from "@/components/EditRuleDialog";
import BulkExecutionDialog from "@/components/BulkExecutionDialog";

export default function CrossSellingRulesPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<CrossSellingRule | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  // Fetch all rules
  const { data, isLoading } = useQuery<{ rules: CrossSellingRule[] }>({
    queryKey: ["/api/cross-selling-rules"],
  });

  const rules = data?.rules || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ruleId: string) => {
      return apiRequest("DELETE", `/api/cross-selling-rules/${ruleId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
      toast({
        title: t('rules.deleted'),
        description: t('rules.deletedDescription'),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('rules.deleteError'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiRequest("PUT", `/api/cross-selling-rules/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling-rules"] });
    },
    onError: (error: any) => {
      toast({
        title: t('errors.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = (ruleId: string) => {
    if (window.confirm(t('rules.deleteConfirm'))) {
      deleteMutation.mutate(ruleId);
    }
  };

  const handleToggleActive = (rule: CrossSellingRule) => {
    toggleActiveMutation.mutate({ id: rule.id, active: !rule.active });
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-rules">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            {t('rules.title')}
          </h1>
          <p className="text-muted-foreground">{t('rules.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowBulkDialog(true)}
            disabled={rules.length === 0}
            data-testid="button-execute-bulk"
          >
            <Play className="h-4 w-4 mr-2" />
            {t('rules.executeBulk')}
          </Button>
          <Button
            onClick={() => setShowAddDialog(true)}
            data-testid="button-add-rule"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('rules.createNew')}
          </Button>
        </div>
      </div>

      {/* Rules Table */}
      <Card className="p-6">
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">{t('common.loading')}</p>
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lg font-medium">{t('rules.noRules')}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('rules.noRulesDescription')}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rules.name')}</TableHead>
                <TableHead>{t('rules.description')}</TableHead>
                <TableHead>{t('rules.status')}</TableHead>
                <TableHead>{t('rules.conditions')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id} data-testid={`row-rule-${rule.id}`}>
                  <TableCell className="font-medium" data-testid={`text-name-${rule.id}`}>
                    {rule.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground" data-testid={`text-description-${rule.id}`}>
                    {rule.description || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={rule.active ? "default" : "secondary"}
                      data-testid={`badge-status-${rule.id}`}
                    >
                      {rule.active ? t('rules.active') : t('rules.inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {rule.sourceConditions.length} {t('rules.source')} →{' '}
                    {rule.targetCriteria.length} {t('rules.target')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(rule)}
                        data-testid={`button-toggle-${rule.id}`}
                        title={rule.active ? t('rules.deactivate') : t('rules.activate')}
                      >
                        {rule.active ? (
                          <ToggleRight className="h-4 w-4" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingRule(rule)}
                        data-testid={`button-edit-${rule.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(rule.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${rule.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Dialogs */}
      <AddRuleDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
      />
      <EditRuleDialog
        rule={editingRule}
        open={!!editingRule}
        onClose={() => setEditingRule(null)}
      />
      <BulkExecutionDialog
        open={showBulkDialog}
        onClose={() => setShowBulkDialog(false)}
        rules={rules}
      />
    </div>
  );
}
