/**
 * CpqRuleConditionEditor - Geführter Editor für CPQ-Regel-Bedingungen
 * Ermöglicht Nutzern ohne JSON-Kenntnisse, Kompatibilitätsregeln zu erstellen.
 */

import { useEffect } from "react";
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

const COMPONENT_TYPE_OPTIONS = [
  { value: "frame", label: "Ständer" },
  { value: "beam", label: "Traverse" },
  { value: "shelf", label: "Fachboden" },
  { value: "accessory", label: "Zubehör" },
  { value: "connector", label: "Verbinder" },
];

const ATTRIBUTE_OPTIONS = [
  { value: "depth", label: "Tiefe (mm)" },
  { value: "width", label: "Breite (mm)" },
  { value: "height", label: "Höhe (mm)" },
  { value: "load_capacity", label: "Tragfähigkeit (kg)" },
  { value: "hole_pattern_start", label: "Lochraster Start (mm)" },
  { value: "hole_pattern_pitch", label: "Lochraster Abstand (mm)" },
  { value: "other", label: "Sonstige (Attributname eingeben)" },
];

const OPERATOR_OPTIONS = [
  { value: "equals", label: "ist gleich" },
  { value: "not_equals", label: "ist ungleich" },
  { value: "in", label: "ist einer von (kommagetrennt)" },
  { value: "not_in", label: "ist keiner von" },
  { value: ">", label: "größer als" },
  { value: ">=", label: "größer oder gleich" },
  { value: "<", label: "kleiner als" },
  { value: "<=", label: "kleiner oder gleich" },
];

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
      <h4 className="font-medium text-sm">Kompatibilitätsbedingung</h4>
      <p className="text-xs text-muted-foreground">
        WENN [Komponente A] [Attribut] [Operator] [Komponente B / Fester Wert] – dann erlauben
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Quelle – Komponente</Label>
          <Select
            value={guided.sourceComponentType}
            onValueChange={(v) => update({ sourceComponentType: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Komponente wählen" />
            </SelectTrigger>
            <SelectContent>
              {COMPONENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Quelle – Attribut</Label>
          <Select
            value={guided.sourceAttribute}
            onValueChange={(v) => update({ sourceAttribute: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Attribut wählen" />
            </SelectTrigger>
            <SelectContent>
              {ATTRIBUTE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sourceAttrDisplay && (
            <Input
              placeholder="z.B. custom_attr"
              className="mt-1"
              value={guided.sourceAttributeCustom ?? ""}
              onChange={(e) => update({ sourceAttributeCustom: e.target.value.trim() })}
            />
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Operator</Label>
        <Select value={guided.operator} onValueChange={(v) => update({ operator: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Operator wählen" />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Ziel – Vergleichen mit</Label>
        <Select
          value={guided.targetMode}
          onValueChange={(v: "other_component" | "fixed_value") =>
            update({ targetMode: v, fixedValue: v === "fixed_value" ? guided.fixedValue : undefined })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="other_component">Andere Komponente (gleiches Attribut muss übereinstimmen)</SelectItem>
            <SelectItem value="fixed_value">Fester Wert (Zahl oder kommagetrennte Liste)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {guided.targetMode === "other_component" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Ziel – Komponente</Label>
            <Select
              value={guided.targetComponentType}
              onValueChange={(v) => update({ targetComponentType: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Komponente wählen" />
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Ziel – Attribut</Label>
            <Select
              value={guided.targetAttribute}
              onValueChange={(v) => update({ targetAttribute: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Attribut wählen" />
              </SelectTrigger>
              <SelectContent>
                {ATTRIBUTE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetAttrDisplay && (
              <Input
                placeholder="z.B. custom_attr"
                className="mt-1"
                value={guided.targetAttributeCustom ?? ""}
                onChange={(e) => update({ targetAttributeCustom: e.target.value.trim() })}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label>Fester Wert (z.B. 800 oder 400, 500, 600)</Label>
          <Input
            value={guided.fixedValue ?? ""}
            onChange={(e) => update({ fixedValue: e.target.value })}
            placeholder="800 oder 400, 500, 600"
          />
        </div>
      )}
    </div>
  );
}
