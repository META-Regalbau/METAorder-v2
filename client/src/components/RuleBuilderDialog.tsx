import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import type { AutomationRule, InsertAutomationRule } from "@shared/schema";

interface RuleBuilderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingRule?: AutomationRule | null;
}

type Condition = {
  field: string;
  operator: "equals" | "notEquals" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual" | "contains";
  value: string | number;
};

type Action = {
  type: "create_ticket" | "update_order_status" | "send_notification" | "assign_ticket" | "update_ticket_priority" | "send_email" | "run_ai_analysis";
  params: Record<string, any>;
};

const RULE_TEMPLATES = [
  {
    id: "delayed_orders",
    nameKey: "automation.templates.delayedOrders.name",
    descriptionKey: "automation.templates.delayedOrders.description",
    triggerType: "scheduled",
    priority: 70,
    enabled: true,
    conditions: [
      { field: "orderAge", operator: "greaterThan", value: 3 }
    ],
    actions: [
      {
        type: "create_ticket",
        params: {
          title: "Delayed Order Alert",
          category: "shipping_issue",
          priority: "high"
        }
      }
    ]
  },
  {
    id: "auto_status",
    nameKey: "automation.templates.autoStatus.name",
    descriptionKey: "automation.templates.autoStatus.description",
    triggerType: "order_status_changed",
    priority: 50,
    enabled: false,
    conditions: [
      { field: "paymentStatus", operator: "equals", value: "paid" }
    ],
    actions: [
      {
        type: "update_order_status",
        params: {
          status: "in_progress"
        }
      }
    ]
  },
  {
    id: "sentiment_priority",
    nameKey: "automation.templates.sentimentPriority.name",
    descriptionKey: "automation.templates.sentimentPriority.description",
    triggerType: "ticket_created",
    priority: 90,
    enabled: true,
    conditions: [
      { field: "sentiment", operator: "equals", value: "negative" }
    ],
    actions: [
      {
        type: "update_ticket_priority",
        params: {
          priority: "high"
        }
      }
    ]
  },
  {
    id: "smart_categorization",
    nameKey: "automation.templates.smartCategorization.name",
    descriptionKey: "automation.templates.smartCategorization.description",
    triggerType: "ticket_created",
    priority: 60,
    enabled: true,
    conditions: [],
    actions: [
      {
        type: "run_ai_analysis",
        params: {
          analysisType: "categorize"
        }
      }
    ]
  }
];

export function RuleBuilderDialog({ isOpen, onClose, editingRule }: RuleBuilderDialogProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [showTemplates, setShowTemplates] = useState(!editingRule);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  type TriggerType = "order_created" | "order_status_changed" | "order_payment_changed" | "ticket_created" | "ticket_status_changed" | "scheduled";
  const [triggerType, setTriggerType] = useState<TriggerType>("order_created");
  const [priority, setPriority] = useState(50);
  const [enabled, setEnabled] = useState(1);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [actions, setActions] = useState<Action[]>([]);

  useEffect(() => {
    if (editingRule) {
      setName(editingRule.name);
      setDescription(editingRule.description || "");
      setTriggerType(editingRule.triggerType as any);
      setPriority(editingRule.priority);
      setEnabled(editingRule.enabled ? 1 : 0);
      
      // Parse conditions - handle both string and already-parsed arrays
      if (editingRule.conditions) {
        try {
          const parsedConditions = typeof editingRule.conditions === 'string' 
            ? JSON.parse(editingRule.conditions) 
            : editingRule.conditions;
          setConditions(Array.isArray(parsedConditions) ? parsedConditions : []);
        } catch (e) {
          console.error('Failed to parse conditions:', e);
          setConditions([]);
        }
      } else {
        setConditions([]);
      }
      
      // Parse actions - handle both string and already-parsed arrays
      if (editingRule.actions) {
        try {
          const parsedActions = typeof editingRule.actions === 'string'
            ? JSON.parse(editingRule.actions)
            : editingRule.actions;
          setActions(Array.isArray(parsedActions) ? parsedActions : []);
        } catch (e) {
          console.error('Failed to parse actions:', e);
          setActions([]);
        }
      } else {
        setActions([]);
      }
      
      setShowTemplates(false);
    } else {
      resetForm();
    }
  }, [editingRule, isOpen]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setTriggerType("order_created");
    setPriority(50);
    setEnabled(1);
    setConditions([]);
    setActions([]);
    setShowTemplates(true);
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertAutomationRule) => {
      return apiRequest("POST", "/api/automation-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: t('automation.createSuccess') });
      onClose();
    },
    onError: (error: any) => {
      toast({ title: t('automation.createError'), description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertAutomationRule> }) => {
      return apiRequest("PATCH", `/api/automation-rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: t('automation.updateSuccess') });
      onClose();
    },
    onError: (error: any) => {
      toast({ title: t('automation.updateError'), description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: t('automation.nameRequired'), variant: "destructive" });
      return;
    }

    const data: any = {
      name: name.trim(),
      description: description.trim() || null,
      triggerType,
      priority,
      enabled,
      conditions: conditions,
      actions: actions,
    };

    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const loadTemplate = (template: typeof RULE_TEMPLATES[0]) => {
    setName(t(template.nameKey));
    setDescription(t(template.descriptionKey));
    setTriggerType(template.triggerType as any);
    setPriority(template.priority);
    setEnabled(template.enabled ? 1 : 0);
    setConditions(template.conditions as any);
    setActions(template.actions as any);
    setShowTemplates(false);
  };

  const addCondition = () => {
    setConditions([...conditions, { field: "", operator: "equals", value: "" }]);
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    const updated = [...conditions];
    updated[index] = { ...updated[index], ...updates };
    setConditions(updated);
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const addAction = () => {
    setActions([...actions, { type: "create_ticket", params: {} }]);
  };

  const updateAction = (index: number, updates: Partial<Action>) => {
    const updated = [...actions];
    updated[index] = { ...updated[index], ...updates };
    setActions(updated);
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingRule ? t('automation.editRule') : t('automation.newRule')}
          </DialogTitle>
        </DialogHeader>

        {showTemplates && !editingRule && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4" />
              <h3 className="font-medium">{t('automation.templates.title')}</h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {RULE_TEMPLATES.map((template) => (
                <Card
                  key={template.id}
                  className="p-3 cursor-pointer hover-elevate"
                  onClick={() => loadTemplate(template)}
                  data-testid={`template-${template.id}`}
                >
                  <h4 className="font-medium text-sm mb-1">{t(template.nameKey)}</h4>
                  <p className="text-xs text-muted-foreground">{t(template.descriptionKey)}</p>
                </Card>
              ))}
            </div>
            <div className="flex items-center gap-2 my-4">
              <div className="flex-1 border-t" />
              <span className="text-xs text-muted-foreground">{t('automation.templates.orCustom')}</span>
              <div className="flex-1 border-t" />
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label htmlFor="name">{t('automation.form.name')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('automation.form.namePlaceholder')}
              data-testid="input-rule-name"
            />
          </div>

          <div>
            <Label htmlFor="description">{t('automation.form.description')}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('automation.form.descriptionPlaceholder')}
              data-testid="input-rule-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="trigger">{t('automation.form.trigger')}</Label>
              <Select value={triggerType} onValueChange={(value) => setTriggerType(value as TriggerType)}>
                <SelectTrigger id="trigger" data-testid="select-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="order_created">{t('automation.triggers.order_created')}</SelectItem>
                  <SelectItem value="order_status_changed">{t('automation.triggers.order_status_changed')}</SelectItem>
                  <SelectItem value="ticket_created">{t('automation.triggers.ticket_created')}</SelectItem>
                  <SelectItem value="scheduled">{t('automation.triggers.scheduled')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority">{t('automation.form.priority')}</Label>
              <Input
                id="priority"
                type="number"
                min="0"
                max="100"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                data-testid="input-priority"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{t('automation.form.conditions')}</Label>
              <Button size="sm" variant="outline" onClick={addCondition} data-testid="button-add-condition">
                <Plus className="w-3 h-3 mr-1" />
                {t('automation.form.addCondition')}
              </Button>
            </div>
            {conditions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('automation.form.noConditions')}</p>
            ) : (
              <div className="space-y-2">
                {conditions.map((condition, index) => (
                  <Card key={index} className="p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={condition.field}
                        onChange={(e) => updateCondition(index, { field: e.target.value })}
                        placeholder={t('automation.form.conditionField')}
                        className="flex-1"
                        data-testid={`input-condition-field-${index}`}
                      />
                      <Select
                        value={condition.operator}
                        onValueChange={(value) => updateCondition(index, { operator: value as Condition["operator"] })}
                      >
                        <SelectTrigger className="w-32" data-testid={`select-operator-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">=</SelectItem>
                          <SelectItem value="notEquals">≠</SelectItem>
                          <SelectItem value="greaterThan">&gt;</SelectItem>
                          <SelectItem value="lessThan">&lt;</SelectItem>
                          <SelectItem value="greaterThanOrEqual">≥</SelectItem>
                          <SelectItem value="lessThanOrEqual">≤</SelectItem>
                          <SelectItem value="contains">{t('automation.operators.contains')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={condition.value === undefined || condition.value === null ? "" : String(condition.value)}
                        onChange={(e) => updateCondition(index, { value: e.target.value })}
                        placeholder={t('automation.form.conditionValue')}
                        className="flex-1"
                        data-testid={`input-condition-value-${index}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeCondition(index)}
                        data-testid={`button-remove-condition-${index}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{t('automation.form.actions')}</Label>
              <Button size="sm" variant="outline" onClick={addAction} data-testid="button-add-action">
                <Plus className="w-3 h-3 mr-1" />
                {t('automation.form.addAction')}
              </Button>
            </div>
            {actions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('automation.form.noActions')}</p>
            ) : (
              <div className="space-y-2">
                {actions.map((action, index) => (
                  <Card key={index} className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <Select
                          value={action.type}
                          onValueChange={(value) => updateAction(index, { type: value as Action["type"] })}
                        >
                          <SelectTrigger data-testid={`select-action-type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="create_ticket">{t('automation.actions.create_ticket')}</SelectItem>
                            <SelectItem value="update_order_status">{t('automation.actions.update_order_status')}</SelectItem>
                            <SelectItem value="send_notification">{t('automation.actions.send_notification')}</SelectItem>
                            <SelectItem value="assign_ticket">{t('automation.actions.assign_ticket')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Textarea
                          value={JSON.stringify(action.params, null, 2)}
                          onChange={(e) => {
                            try {
                              const params = JSON.parse(e.target.value);
                              updateAction(index, { params });
                            } catch {}
                          }}
                          placeholder={t('automation.form.actionParams')}
                          className="font-mono text-xs"
                          rows={3}
                          data-testid={`textarea-action-params-${index}`}
                        />
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeAction(index)}
                        data-testid={`button-remove-action-${index}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
            data-testid="button-save-rule"
          >
            {editingRule ? t('common.update') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
