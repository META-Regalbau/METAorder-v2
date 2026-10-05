/**
 * CpqRuleConditionEditor - Geführter Editor für CPQ-Regel-Bedingungen
 * Ermöglicht Nutzern ohne JSON-Kenntnisse, Kompatibilitätsregeln zu erstellen.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type GuidedCondition = {
  sourceComponentType: string;
  sourceAttribute: string;
  sourceAttributeCustom?: string;
  operator: string;
  targetMode: "other_component" | "fixed_value";
  targetComponentType?: string;
  targetAttribute?: string;
  targetAttributeCustom?: string;
  fixedValue?: string;
};

export type GuidedAction = {
  type: string;
};

export function guidedToCondition(guided: GuidedCondition): object {
  const sourceAttr = guided.sourceAttribute === "other" ? (guided.sourceAttributeCustom || "depth") : guided.sourceAttribute;
  const targetAttr = guided.targetAttribute === "other" ? (guided.targetAttributeCustom || "depth") : (guided.targetAttribute || "depth");

  let targetValue: number | number[] | undefined;
  if (guided.targetMode === "fixed_value" && guided.fixedValue?.trim()) {
    const parts = guided.fixedValue.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    targetValue = parts.length === 1 ? parts[0] : parts.length > 1 ? parts : undefined;
  }

  const condition: Record<string, unknown> = {
    source: {
      component_type: guided.sourceComponentType,
      attribute: sourceAttr,
    },
    target: {
      component_type: guided.targetMode === "other_component" ? (guided.targetComponentType || "shelf") : guided.sourceComponentType,
      attribute: guided.targetMode === "other_component" ? targetAttr : sourceAttr,
      operator: guided.operator,
    },
  };

  if (guided.targetMode === "fixed_value" && targetValue !== undefined) {
    (condition.target as Record<string, unknown>).value = targetValue;
  }
  // Wenn targetMode === "other_component", wird target.value weggelassen – der Evaluator vergleicht dann mit target-Komponente

  return condition;
}

export function guidedToAction(): object {
  return { type: "allow" };
}

export function conditionToGuided(condition: unknown): GuidedCondition {
  const c = condition as {
    source?: { component_type?: string; attribute?: string };
    target?: { component_type?: string; attribute?: string; operator?: string; value?: number | number[] };
  } | null;
  if (!c?.source?.component_type) {
    return {
      sourceComponentType: "frame",
      sourceAttribute: "depth",
      operator: "equals",
      targetMode: "other_component",
      targetComponentType: "shelf",
      targetAttribute: "depth",
    };
  }
  const target = c.target || {};
  const hasFixedValue = target.value !== undefined && target.value !== null;
  return {
    sourceComponentType: c.source.component_type || "frame",
    sourceAttribute: c.source.attribute || "depth",
    operator: target.operator || "equals",
    targetMode: hasFixedValue ? "fixed_value" : "other_component",
    targetComponentType: target.component_type || "shelf",
    targetAttribute: target.attribute || "depth",
    fixedValue: hasFixedValue
      ? Array.isArray(target.value)
        ? (target.value as number[]).join(", ")
        : String(target.value)
      : undefined,
  };
}

type CpqRuleConditionEditorProps = {
  condition: unknown;
  onChange: (condition: object, action: object) => void;
};

export default function CpqRuleConditionEditor({ condition, onChange }: CpqRuleConditionEditorProps) {
  const { t } = useTranslation();
  const COMPONENT_TYPE_OPTIONS = [
    { value: "frame", label: t("cpq.ruleEditor.componentTypes.frame") },
    { value: "beam", label: t("cpq.ruleEditor.componentTypes.beam") },
    { value: "shelf", label: t("cpq.ruleEditor.componentTypes.shelf") },
    { value: "accessory", label: t("cpq.ruleEditor.componentTypes.accessory") },
    { value: "connector", label: t("cpq.ruleEditor.componentTypes.connector") },
  ];

  const ATTRIBUTE_OPTIONS = [
    { value: "depth", label: t("cpq.ruleEditor.attributes.depth") },
    { value: "width", label: t("cpq.ruleEditor.attributes.width") },
    { value: "height", label: t("cpq.ruleEditor.attributes.height") },
    { value: "load_capacity", label: t("cpq.ruleEditor.attributes.loadCapacity") },
    { value: "hole_pattern_start", label: t("cpq.ruleEditor.attributes.holePatternStart") },
    { value: "hole_pattern_pitch", label: t("cpq.ruleEditor.attributes.holePatternPitch") },
    { value: "other", label: t("cpq.ruleEditor.attributes.other") },
  ];

  const OPERATOR_OPTIONS = [
    { value: "equals", label: t("cpq.ruleEditor.operators.equals") },
    { value: "not_equals", label: t("cpq.ruleEditor.operators.notEquals") },
    { value: "in", label: t("cpq.ruleEditor.operators.in") },
    { value: "not_in", label: t("cpq.ruleEditor.operators.notIn") },
    { value: ">", label: t("cpq.ruleEditor.operators.greaterThan") },
    { value: ">=", label: t("cpq.ruleEditor.operators.greaterOrEqual") },
    { value: "<", label: t("cpq.ruleEditor.operators.lessThan") },
    { value: "<=", label: t("cpq.ruleEditor.operators.lessOrEqual") },
  ];

  const guided = conditionToGuided(condition);

  useEffect(() => {
    onChange(guidedToCondition(guided), guidedToAction());
  }, []);

  const update = (updates: Partial<GuidedCondition>) => {
    const next = { ...guided, ...updates };
    const cond = guidedToCondition(next);
    const act = guidedToAction();
    onChange(cond, act);
  };

  const sourceAttrDisplay = guided.sourceAttribute === "other";
  const targetAttrDisplay = guided.targetMode === "other_component" && guided.targetAttribute === "other";

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
      <h4 className="font-medium text-sm">{t("cpq.ruleEditor.title")}</h4>
      <p className="text-xs text-muted-foreground">
        {t("cpq.ruleEditor.syntaxHint")}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("cpq.ruleEditor.sourceComponent")}</Label>
          <Select
            value={guided.sourceComponentType}
            onValueChange={(v) => update({ sourceComponentType: v })}
          >
            <SelectTrigger aria-label={t("cpq.ruleEditor.sourceComponent")}>
              <SelectValue placeholder={t("cpq.ruleEditor.selectComponent")} />
            </SelectTrigger>
            <SelectContent>
              {COMPONENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("cpq.ruleEditor.sourceAttribute")}</Label>
          <Select
            value={guided.sourceAttribute}
            onValueChange={(v) => update({ sourceAttribute: v })}
          >
            <SelectTrigger aria-label={t("cpq.ruleEditor.sourceAttribute")}>
              <SelectValue placeholder={t("cpq.ruleEditor.selectAttribute")} />
            </SelectTrigger>
            <SelectContent>
              {ATTRIBUTE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sourceAttrDisplay && (
            <Input
              placeholder={t("cpq.ruleEditor.customAttributePlaceholder")}
              className="mt-1"
              value={guided.sourceAttributeCustom ?? ""}
              onChange={(e) => update({ sourceAttributeCustom: e.target.value.trim() })}
            />
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("cpq.ruleEditor.operator")}</Label>
        <Select value={guided.operator} onValueChange={(v) => update({ operator: v })}>
          <SelectTrigger aria-label={t("cpq.ruleEditor.operator")}>
            <SelectValue placeholder={t("cpq.ruleEditor.selectOperator")} />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>{t("cpq.ruleEditor.compareWith")}</Label>
        <Select
          value={guided.targetMode}
          onValueChange={(v: "other_component" | "fixed_value") =>
            update({ targetMode: v, fixedValue: v === "fixed_value" ? guided.fixedValue : undefined })
          }
        >
          <SelectTrigger aria-label={t("cpq.ruleEditor.compareWith")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="other_component">{t("cpq.ruleEditor.targetModes.otherComponent")}</SelectItem>
            <SelectItem value="fixed_value">{t("cpq.ruleEditor.targetModes.fixedValue")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {guided.targetMode === "other_component" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("cpq.ruleEditor.targetComponent")}</Label>
            <Select
              value={guided.targetComponentType}
              onValueChange={(v) => update({ targetComponentType: v })}
            >
              <SelectTrigger aria-label={t("cpq.ruleEditor.targetComponent")}>
                <SelectValue placeholder={t("cpq.ruleEditor.selectComponent")} />
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("cpq.ruleEditor.targetAttribute")}</Label>
            <Select
              value={guided.targetAttribute}
              onValueChange={(v) => update({ targetAttribute: v })}
            >
              <SelectTrigger aria-label={t("cpq.ruleEditor.targetAttribute")}>
                <SelectValue placeholder={t("cpq.ruleEditor.selectAttribute")} />
              </SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetAttrDisplay && (
              <Input
                placeholder={t("cpq.ruleEditor.customAttributePlaceholder")}
                className="mt-1"
                value={guided.targetAttributeCustom ?? ""}
                onChange={(e) => update({ targetAttributeCustom: e.target.value.trim() })}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>{t("cpq.ruleEditor.fixedValueLabel")}</Label>
          <Input
            value={guided.fixedValue ?? ""}
            onChange={(e) => update({ fixedValue: e.target.value })}
            placeholder={t("cpq.ruleEditor.fixedValuePlaceholder")}
          />
        </div>
      )}
    </div>
  );
}
