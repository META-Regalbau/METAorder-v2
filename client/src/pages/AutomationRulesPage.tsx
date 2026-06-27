import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Edit, Trash2, Play, History, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import { RuleBuilderDialog } from "@/components/RuleBuilderDialog";
import { ExecutionHistoryDialog } from "@/components/ExecutionHistoryDialog";
import ErpAutomationWidget from "@/components/ErpAutomationWidget";
import type { AutomationRule } from "@shared/schema";

export default function AutomationRulesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [historyRuleId, setHistoryRuleId] = useState<string | null>(null);

  const { data: authData } = useQuery<{ user: { id: string; role: "employee" | "admin" } }>({
    queryKey: ["/api/auth/me"],
  });
  const user = authData?.user;

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/automation-rules"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest("POST", `/api/automation-rules/${id}/toggle`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: t('automation.toggleSuccess') });
    },
    onError: (error: any) => {
      toast({ title: t('automation.toggleError'), description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/automation-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: t('automation.deleteSuccess') });
    },
    onError: (error: any) => {
      toast({ title: t('automation.deleteError'), description: error.message, variant: "destructive" });
    },
  });

  const handleToggle = (rule: AutomationRule) => {
    toggleMutation.mutate({ id: rule.id, enabled: !rule.enabled });
  };

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(rule);
    setIsCreateDialogOpen(true);
  };

  const handleDelete = (rule: AutomationRule) => {
    if (window.confirm(t('automation.deleteConfirm'))) {
      deleteMutation.mutate(rule.id);
    }
  };

  const handleDialogClose = () => {
    setIsCreateDialogOpen(false);
    setEditingRule(null);
  };

  const getTriggerLabel = (trigger: string): string => {
    return t(`automation.triggers.${trigger}`, trigger);
  };

  const getPriorityColor = (priority: number): "default" | "destructive" | "outline" | "secondary" => {
    if (priority >= 80) return "destructive";
    if (priority >= 50) return "default";
    return "secondary";
  };

  // Sort by priority (highest first)
  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <Zap className="w-6 h-6" />
            {t('automation.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('automation.description')}
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-automation">
          <Plus className="w-4 h-4 mr-2" />
          {t('automation.newRule')}
        </Button>
      </div>

      {/* ERP Automation Widget (Admin Only) */}
      {user?.role === 'admin' && (
        <ErpAutomationWidget userRole={user.role} />
      )}

      <div className="border-t pt-6">
        <h2 className="text-xl font-semibold mb-4">{t('automation.customRules', 'Custom Automation Rules')}</h2>

      {isLoading ? (
        <Card className="p-6">
          <div className="text-center text-muted-foreground">{t('common.loading')}</div>
        </Card>
      ) : rules.length === 0 ? (
        <Card className="p-8 text-center">
          <Zap className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">{t('automation.noRules')}</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t('automation.noRulesDescription')}
          </p>
          <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-automation">
            <Plus className="w-4 h-4 mr-2" />
            {t('automation.createFirst')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedRules.map((rule: AutomationRule) => (
            <Card key={rule.id} className="p-4" data-testid={`automation-rule-${rule.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="font-medium text-base">{rule.name}</h3>
                    <Badge variant={getPriorityColor(rule.priority)}>
                      {t('automation.priority')}: {rule.priority}
                    </Badge>
                    <Badge variant="outline">
                      {getTriggerLabel(rule.triggerType)}
                    </Badge>
                    {!rule.enabled && (
                      <Badge variant="secondary">{t('automation.disabled')}</Badge>
                    )}
                  </div>

                  {rule.description && (
                    <p className="text-sm text-muted-foreground mb-3">{rule.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Play className="w-3 h-3" />
                      <span>{t('automation.executions')}: {rule.executionCount || 0}</span>
                    </div>
                    {rule.lastExecutedAt && (
                      <div>
                        {t('automation.lastRun')}: {new Date(rule.lastExecutedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!rule.enabled}
                    onCheckedChange={() => handleToggle(rule)}
                    data-testid={`switch-toggle-${rule.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setHistoryRuleId(rule.id)}
                    data-testid={`button-history-${rule.id}`}
                  >
                    <History className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEdit(rule)}
                    data-testid={`button-edit-${rule.id}`}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(rule)}
                    data-testid={`button-delete-${rule.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      </div>

      <RuleBuilderDialog
        isOpen={isCreateDialogOpen}
        onClose={handleDialogClose}
        editingRule={editingRule}
      />

      {historyRuleId && (
        <ExecutionHistoryDialog
          ruleId={historyRuleId}
          onClose={() => setHistoryRuleId(null)}
        />
      )}
    </div>
  );
}
