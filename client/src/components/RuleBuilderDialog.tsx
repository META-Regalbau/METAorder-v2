import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Clock, Eye, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import type { AutomationRule } from "@shared/schema";
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_ACTIONS,
  AUTOMATION_FIELDS,
  AUTOMATION_PLACEHOLDERS,
  AUTOMATION_TRIGGERS,
  AUTOMATION_TRIGGER_TYPES,
  OPERATORS_BY_FIELD_TYPE,
  ORDER_EVENT_MAX_AGE_HOURS,
  SCHEDULED_LOOKBACK_DAYS,
  SCHEDULED_MAX_PER_RULE_PER_RUN,
  fieldsForTrigger,
  parseStoredRuleList,
  validateAutomationRule,
  type AutomationActionInput,
  type AutomationActionTypeId,
  type AutomationConditionInput,
  type AutomationParamDef,
  type AutomationTriggerTypeId,
} from "@shared/automation";

interface RuleBuilderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingRule?: AutomationRule | null;
}

type Template = {
  id: string;
  triggerType: AutomationTriggerTypeId;
  priority: number;
  conditions: AutomationConditionInput[];
  actions: AutomationActionInput[];
};

// Vorlagen nur mit verfuegbaren Ausloesern/Aktionen
const RULE_TEMPLATES: Template[] = [
  {
    id: "delayedOrders",
    triggerType: "scheduled",
    priority: 60,
    conditions: [
      { field: "order.paymentStatus", operator: "equals", value: "paid" },
      { field: "order.status", operator: "notEquals", value: "completed" },
      { field: "order.status", operator: "notEquals", value: "cancelled" },
      { field: "order.daysPastDeliveryDate", operator: "greaterThanOrEqual", value: 3 },
    ],
    actions: [{
      type: "create_ticket",
      params: {
        title: "Bestellung {{order.orderNumber}} verspätet",
        description: "Bestellung {{order.orderNumber}} von {{order.customerName}} ({{order.customerEmail}}) liegt seit {{order.daysPastDeliveryDate}} Tagen über dem spätesten Lieferdatum.",
        priority: "high",
        category: "order_issue",
      },
    }],
  },
  {
    id: "paymentFailed",
    triggerType: "order_payment_changed",
    priority: 50,
    conditions: [{ field: "order.paymentStatus", operator: "equals", value: "failed" }],
    actions: [{
      type: "create_ticket",
      params: {
        title: "Zahlung fehlgeschlagen: {{order.orderNumber}}",
        description: "Zahlung für Bestellung {{order.orderNumber}} von {{order.customerName}} ({{order.customerEmail}}) ist fehlgeschlagen (vorher: {{order.previousPaymentStatus}}).",
        priority: "high",
        category: "order_issue",
      },
    }],
  },
  {
    id: "sentimentPriority",
    triggerType: "ticket_created",
    priority: 50,
    conditions: [{ field: "ticket.sentiment", operator: "equals", value: "negative" }],
    actions: [{ type: "update_ticket_priority", params: { priority: "high" } }],
  },
  {
    id: "smartCategorization",
    triggerType: "ticket_created",
    priority: 40,
    conditions: [],
    actions: [{ type: "run_ai_analysis", params: { applyCategory: true, escalateNegative: false } }],
  },
  {
    id: "complaintNotify",
    triggerType: "ticket_created",
    priority: 30,
    conditions: [{ field: "ticket.category", operator: "equals", value: "complaint" }],
    actions: [{ type: "send_notification", params: { userId: "", title: "Reklamation {{ticket.ticketNumber}}", message: "{{ticket.title}} ({{ticket.customerName}})" } }],
  },
  {
    id: "customerReplied",
    triggerType: "ticket_status_changed",
    priority: 30,
    conditions: [
      { field: "ticket.previousStatus", operator: "equals", value: "waiting_for_customer" },
      { field: "ticket.status", operator: "equals", value: "open" },
    ],
    actions: [{ type: "update_ticket_priority", params: { priority: "high" } }],
  },
];

type PreviewResult = {
  matching: number;
  alreadyDone: number;
  nextRun: number;
  sample: Array<{ orderNumber: string; customerName: string; orderDate: string; status: string; paymentStatus: string; daysPastDeliveryDate: number | null }>;
};

function parseArray<T>(raw: unknown): T[] {
  return parseStoredRuleList<T>(raw) ?? [];
}

function defaultParams(type: AutomationActionTypeId): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(AUTOMATION_ACTIONS[type].params)) {
    params[name] = def.kind === "boolean" ? true : "";
  }
  return params;
}

export function RuleBuilderDialog({ isOpen, onClose, editingRule }: RuleBuilderDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<AutomationTriggerTypeId>("ticket_created");
  const [priority, setPriority] = useState(50);
  const [enabled, setEnabled] = useState(true);
  const [conditions, setConditions] = useState<AutomationConditionInput[]>([]);
  const [actions, setActions] = useState<AutomationActionInput[]>([]);
  const [showTemplates, setShowTemplates] = useState(!editingRule);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: users = [] } = useQuery<Array<{ id: string; username: string }>>({
    queryKey: ["/api/automation-rules/users"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (editingRule) {
      setName(editingRule.name);
      setDescription(editingRule.description || "");
      setTriggerType((editingRule.triggerType as AutomationTriggerTypeId) || "ticket_created");
      setPriority(editingRule.priority);
      setEnabled(editingRule.enabled === 1);
      setConditions(parseArray<AutomationConditionInput>(editingRule.conditions));
      setActions(parseArray<AutomationActionInput>(editingRule.actions));
      setShowTemplates(false);
    } else {
      setName("");
      setDescription("");
      setTriggerType("ticket_created");
      setPriority(50);
      setEnabled(true);
      setConditions([]);
      setActions([]);
      setShowTemplates(true);
    }
  }, [editingRule, isOpen]);

  useEffect(() => setPreview(null), [triggerType, conditions]);

  const runPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await apiRequest("POST", "/api/automation-rules/preview", { triggerType, conditions, ruleId: editingRule?.id });
      setPreview(await res.json());
    } catch (error: any) {
      toast({ title: t("automation.scheduled.previewError"), description: error.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const errors = useMemo(
    () => validateAutomationRule({ triggerType, conditions, actions }),
    [triggerType, conditions, actions],
  );

  const onSaved = (key: "createSuccess" | "updateSuccess") => () => {
    queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
    toast({ title: t(`automation.${key}`) });
    onClose();
  };
  const onFailed = (key: "createError" | "updateError") => (error: any) => {
    toast({ title: t(`automation.${key}`), description: error.message, variant: "destructive" });
  };
  const createMutation = useMutation({
    mutationFn: (data: unknown) => apiRequest("POST", "/api/automation-rules", data),
    onSuccess: onSaved("createSuccess"),
    onError: onFailed("createError"),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => apiRequest("PATCH", `/api/automation-rules/${id}`, data),
    onSuccess: onSaved("updateSuccess"),
    onError: onFailed("updateError"),
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast({ title: t("automation.nameRequired"), variant: "destructive" });
      return;
    }
    if (errors.length > 0) return;
    const data = { name: name.trim(), description: description.trim() || null, triggerType, priority, enabled, conditions, actions };
    if (editingRule) updateMutation.mutate({ id: editingRule.id, data });
    else createMutation.mutate(data);
  };

  const loadTemplate = (template: Template) => {
    setName(t(`automation.templates.${template.id}.name`));
    setDescription(t(`automation.templates.${template.id}.description`));
    setTriggerType(template.triggerType);
    setPriority(template.priority);
    setEnabled(true);
    setConditions(template.conditions.map((c) => ({ ...c })));
    setActions(template.actions.map((a) => ({ ...a, params: { ...a.params } })));
    setShowTemplates(false);
  };

  const availableFields = fieldsForTrigger(triggerType);
  const triggerEntity = AUTOMATION_TRIGGERS[triggerType].entity;

  const valueLabel = (field: string, value: string) => {
    switch (field) {
      case "ticket.priority":
      case "priority":
        return t(`tickets.priorityValues.${value}`, value);
      case "ticket.status":
      case "ticket.previousStatus":
        return t(`tickets.statusValues.${value}`, value);
      case "order.status":
      case "order.previousStatus":
        return t(`automation.values.orderStatus.${value}`, value);
      case "order.paymentStatus":
      case "order.previousPaymentStatus":
        return t(`automation.values.paymentStatus.${value}`, value);
      default:
        return t(`automation.values.${value}`, value);
    }
  };

  // --- Bedingungen ---------------------------------------------------------
  const addCondition = () => {
    const field = availableFields[0];
    const def = AUTOMATION_FIELDS[field];
    setConditions([...conditions, { field, operator: OPERATORS_BY_FIELD_TYPE[def.type][0], value: def.options?.[0] ?? (def.type === "boolean" ? true : "") }]);
  };
  const updateCondition = (index: number, updates: Partial<AutomationConditionInput>) => {
    setConditions(conditions.map((c, i) => {
      if (i !== index) return c;
      const next = { ...c, ...updates };
      if (updates.field && updates.field !== c.field) {
        // Neues Feld: passenden Operator und Wert vorbelegen
        const def = AUTOMATION_FIELDS[updates.field];
        next.operator = OPERATORS_BY_FIELD_TYPE[def.type][0];
        next.value = def.options?.[0] ?? (def.type === "boolean" ? true : "");
      }
      return next;
    }));
  };

  // --- Aktionen ------------------------------------------------------------
  const addAction = () => setActions([...actions, { type: "assign_ticket", params: defaultParams("assign_ticket") }]);
  const updateAction = (index: number, updates: Partial<AutomationActionInput>) =>
    setActions(actions.map((a, i) => (i === index ? { ...a, ...updates } : a)));
  const setParam = (index: number, param: string, value: unknown) =>
    setActions(actions.map((a, i) => (i === index ? { ...a, params: { ...a.params, [param]: value } } : a)));

  const renderParam = (index: number, action: AutomationActionInput, param: string, def: AutomationParamDef) => {
    const id = `action-${index}-${param}`;
    const value = action.params?.[param];
    const label = <Label htmlFor={id} className="text-xs">{t(`automation.params.${param}`)}{"required" in def && def.required ? " *" : ""}</Label>;
    switch (def.kind) {
      case "user":
        return (
          <div key={param} className="space-y-1">
            {label}
            <Select value={String(value ?? "")} onValueChange={(v) => setParam(index, param, v)}>
              <SelectTrigger id={id} data-testid={`select-${id}`}><SelectValue placeholder={t("automation.form.selectUser")} /></SelectTrigger>
              <SelectContent>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        );
      case "enum":
        return (
          <div key={param} className="space-y-1">
            {label}
            <Select value={String(value ?? "")} onValueChange={(v) => setParam(index, param, v)}>
              <SelectTrigger id={id} data-testid={`select-${id}`}><SelectValue placeholder={t("automation.form.choose")} /></SelectTrigger>
              <SelectContent>
                {def.options.map((o) => <SelectItem key={o} value={o}>{valueLabel(param, o)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        );
      case "boolean":
        return (
          <div key={param} className="flex items-center gap-2">
            <Switch id={id} checked={Boolean(value)} onCheckedChange={(v) => setParam(index, param, v)} data-testid={`switch-${id}`} />
            <Label htmlFor={id} className="text-sm font-normal">{t(`automation.params.${param}`)}</Label>
          </div>
        );
      case "text":
      case "email": {
        const multiline = def.kind === "text" && def.multiline;
        const Field = multiline ? Textarea : Input;
        return (
          <div key={param} className="space-y-1">
            {label}
            <Field
              id={id}
              value={String(value ?? "")}
              onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setParam(index, param, e.target.value)}
              {...(multiline ? { rows: 3 } : {})}
              data-testid={`input-${id}`}
            />
          </div>
        );
      }
    }
  };

  const placeholderHint = AUTOMATION_PLACEHOLDERS[triggerEntity].map((p) => `{{${p}}}`).join("  ");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingRule ? t("automation.editRule") : t("automation.newRule")}</DialogTitle>
        </DialogHeader>

        {showTemplates && !editingRule ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h3 className="font-semibold">{t("automation.templates.title")}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {RULE_TEMPLATES.map((template) => (
                <Card key={template.id} className="p-4 cursor-pointer hover-elevate" onClick={() => loadTemplate(template)} data-testid={`template-${template.id}`}>
                  <h4 className="font-medium mb-1">{t(`automation.templates.${template.id}.name`)}</h4>
                  <p className="text-sm text-muted-foreground">{t(`automation.templates.${template.id}.description`)}</p>
                </Card>
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={() => setShowTemplates(false)} data-testid="button-custom-rule">
              {t("automation.templates.orCustom")}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="rule-name">{t("automation.form.name")}</Label>
                <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("automation.form.namePlaceholder")} data-testid="input-rule-name" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="rule-description">{t("automation.form.description")}</Label>
                <Textarea id="rule-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("automation.form.descriptionPlaceholder")} rows={2} data-testid="input-rule-description" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-trigger">{t("automation.form.trigger")}</Label>
                <Select value={triggerType} onValueChange={(v) => setTriggerType(v as AutomationTriggerTypeId)}>
                  <SelectTrigger id="rule-trigger" data-testid="select-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AUTOMATION_TRIGGER_TYPES.map((tt) => (
                      <SelectItem key={tt} value={tt} disabled={!AUTOMATION_TRIGGERS[tt].available}>
                        {t(`automation.triggers.${tt}`)}{AUTOMATION_TRIGGERS[tt].available ? "" : ` (${t("automation.form.comingSoon")})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-priority">{t("automation.form.priority")}</Label>
                <Input id="rule-priority" type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value) || 0)} data-testid="input-rule-priority" />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch id="rule-enabled" checked={enabled} onCheckedChange={setEnabled} data-testid="switch-rule-enabled" />
                <Label htmlFor="rule-enabled" className="font-normal">{t("automation.form.enabled")}</Label>
              </div>
            </div>

            {triggerType === "scheduled" && (
              <Alert data-testid="alert-scheduled-info">
                <Clock className="h-4 w-4" />
                <AlertTitle>{t("automation.scheduled.title")}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p className="text-sm">{t("automation.scheduled.description", { days: SCHEDULED_LOOKBACK_DAYS, max: SCHEDULED_MAX_PER_RULE_PER_RUN })}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runPreview}
                    disabled={previewLoading || conditions.length === 0 || errors.some((e) => e.startsWith("Bedingung"))}
                    data-testid="button-preview"
                  >
                    <Eye className="w-4 h-4 mr-1" />{previewLoading ? t("common.loading") : t("automation.scheduled.preview")}
                  </Button>
                  {preview && (
                    <div className="space-y-2" data-testid="preview-result">
                      <p className="text-sm font-medium">
                        {t("automation.scheduled.previewSummary", { matching: preview.matching, done: preview.alreadyDone, next: preview.nextRun })}
                      </p>
                      {preview.sample.length > 0 && (
                        <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
                          {preview.sample.map((o) => (
                            <li key={o.orderNumber} className="font-mono">
                              {o.orderNumber} · {o.customerName} · {new Date(o.orderDate).toLocaleDateString()} · {valueLabel("order.status", o.status)} · {valueLabel("order.paymentStatus", o.paymentStatus)}
                              {o.daysPastDeliveryDate !== null ? ` · +${o.daysPastDeliveryDate} ${t("automation.scheduled.days")}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {AUTOMATION_TRIGGERS[triggerType].entity === "order" && triggerType !== "scheduled" && (
              <Alert data-testid="alert-order-event-info">
                <RefreshCw className="h-4 w-4" />
                <AlertTitle>{t("automation.orderEvents.title")}</AlertTitle>
                <AlertDescription>
                  <p className="text-sm">{t("automation.orderEvents.description", { hours: ORDER_EVENT_MAX_AGE_HOURS })}</p>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("automation.form.conditions")}</Label>
                <Button size="sm" variant="outline" onClick={addCondition} disabled={availableFields.length === 0} data-testid="button-add-condition">
                  <Plus className="w-4 h-4 mr-1" />{t("automation.form.addCondition")}
                </Button>
              </div>
              {conditions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("automation.form.noConditions")}</p>
              ) : (
                conditions.map((condition, index) => {
                  const def = AUTOMATION_FIELDS[condition.field];
                  return (
                    <Card key={index} className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={availableFields.includes(condition.field) ? condition.field : undefined} onValueChange={(v) => updateCondition(index, { field: v })}>
                          <SelectTrigger aria-label={t("automation.form.conditionField")} className="w-56" data-testid={`select-condition-field-${index}`}>
                            <SelectValue placeholder={condition.field || t("automation.form.conditionField")} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableFields.map((f) => <SelectItem key={f} value={f}>{t(`automation.fields.${f}`, f)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={condition.operator} onValueChange={(v) => updateCondition(index, { operator: v })}>
                          <SelectTrigger aria-label={t("automation.form.conditionOperator")} className="w-40" data-testid={`select-condition-operator-${index}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(def ? OPERATORS_BY_FIELD_TYPE[def.type] : []).map((op) => <SelectItem key={op} value={op}>{t(`automation.operators.${op}`)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {def?.type === "enum" ? (
                          <Select value={String(condition.value)} onValueChange={(v) => updateCondition(index, { value: v })}>
                            <SelectTrigger aria-label={t("automation.form.conditionValue")} className="w-48" data-testid={`select-condition-value-${index}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {def.options!.map((o) => <SelectItem key={o} value={o}>{valueLabel(condition.field, o)}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : def?.type === "boolean" ? (
                          <Select value={String(condition.value)} onValueChange={(v) => updateCondition(index, { value: v === "true" })}>
                            <SelectTrigger aria-label={t("automation.form.conditionValue")} className="w-32" data-testid={`select-condition-value-${index}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">{t("automation.values.yes")}</SelectItem>
                              <SelectItem value="false">{t("automation.values.no")}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            className="flex-1 min-w-40"
                            type={def?.type === "number" ? "number" : "text"}
                            value={String(condition.value ?? "")}
                            onChange={(e) => updateCondition(index, { value: def?.type === "number" ? Number(e.target.value) : e.target.value })}
                            placeholder={t("automation.form.conditionValue")}
                            data-testid={`input-condition-value-${index}`}
                          />
                        )}
                        <Button aria-label={t("common.remove")} size="icon" variant="ghost" onClick={() => setConditions(conditions.filter((_, i) => i !== index))} data-testid={`button-remove-condition-${index}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      {def?.computed && <p className="mt-2 text-xs text-muted-foreground">{t("automation.form.computedHint")}</p>}
                    </Card>
                  );
                })
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("automation.form.actions")}</Label>
                <Button size="sm" variant="outline" onClick={addAction} data-testid="button-add-action">
                  <Plus className="w-4 h-4 mr-1" />{t("automation.form.addAction")}
                </Button>
              </div>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("automation.form.noActions")}</p>
              ) : (
                actions.map((action, index) => {
                  const def = AUTOMATION_ACTIONS[action.type as AutomationActionTypeId];
                  const hasPlaceholders = def && Object.values(def.params).some((p) => "placeholders" in p && p.placeholders);
                  return (
                    <Card key={index} className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-3">
                          <Select value={action.type} onValueChange={(v) => updateAction(index, { type: v, params: defaultParams(v as AutomationActionTypeId) })}>
                            <SelectTrigger aria-label={t("automation.form.actionType")} data-testid={`select-action-type-${index}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {AUTOMATION_ACTION_TYPES.map((type) => {
                                const a = AUTOMATION_ACTIONS[type];
                                const blocked = !a.available || (a.needsTicket && triggerEntity !== "ticket");
                                return (
                                  <SelectItem key={type} value={type} disabled={blocked}>
                                    {t(`automation.actions.${type}`)}{a.available ? "" : ` (${t("automation.form.comingSoon")})`}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          {def && Object.entries(def.params).map(([param, p]) => renderParam(index, action, param, p))}
                          {action.type === "send_email" && <p className="text-xs text-muted-foreground">{t("automation.form.emailHint")}</p>}
                          {hasPlaceholders && (
                            <p className="text-xs text-muted-foreground break-words">{t("automation.form.placeholders")}: <span className="font-mono">{placeholderHint}</span></p>
                          )}
                        </div>
                        <Button aria-label={t("common.remove")} size="icon" variant="ghost" onClick={() => setActions(actions.filter((_, i) => i !== index))} data-testid={`button-remove-action-${index}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>

            {errors.length > 0 && (
              <Alert variant="destructive" data-testid="alert-rule-errors">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t("automation.form.incomplete")}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 text-sm">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">{t("common.cancel")}</Button>
          {!(showTemplates && !editingRule) && (
            <Button onClick={handleSubmit} disabled={errors.length > 0 || createMutation.isPending || updateMutation.isPending} data-testid="button-save-rule">
              {editingRule ? t("common.update") : t("common.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
