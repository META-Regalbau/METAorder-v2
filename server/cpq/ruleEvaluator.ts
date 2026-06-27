/**
 * CPQ Rule Evaluator - evaluates condition and action JSON from cpq_rules
 */

export type CpqCondition = {
  source?: { component_type: string; attribute: string; value: number | number[]; operator?: string };
  target?: { component_type: string; attribute: string; operator?: string; value: number | number[] };
  component_type?: string;
  attribute?: string;
  operator?: string;
  value?: number | number[] | string | boolean;
  [key: string]: unknown;
};

export type CpqAction = {
  type: string;
  target_type?: string;
  target_attribute?: string;
  target_value?: string | number;
  value?: string | number;
  [key: string]: unknown;
};

export type ConfigContext = {
  [key: string]: unknown;
  frame_quantity?: number;
  beam_quantity?: number;
  shelf_quantity?: number;
  field_count?: number;
  level_count?: number;
  max_field_load?: number;
  selected_frame?: Record<string, unknown>;
  selected_beam?: Record<string, unknown>;
  selected_shelf?: Record<string, unknown>;
};

/**
 * Evaluate a condition against config context
 */
export function evaluateCondition(condition: CpqCondition | null | undefined, config: ConfigContext): boolean {
  if (!condition) return true;

  // Source/Target compatibility check
  if (condition.source && condition.target) {
    const sourceType = condition.source.component_type;
    const sourceAttr = condition.source.attribute;
    const sourceValue = condition.source.value;

    const targetType = condition.target.component_type;
    const targetAttr = condition.target.attribute;
    const targetOp = condition.target.operator || "equals";
    const targetValue = condition.target.value;

    const sourceData = getComponentData(config, sourceType);
    const targetData = getComponentData(config, targetType);

    if (!sourceData || !targetData) return false;

    const sourceVal = (sourceData as Record<string, unknown>)[sourceAttr] ?? (sourceData.attributes as Record<string, unknown>)?.[sourceAttr];
    const targetVal = (targetData as Record<string, unknown>)[targetAttr] ?? (targetData.attributes as Record<string, unknown>)?.[targetAttr];

    if (sourceVal === undefined) return false;

    // Wenn target.value vorhanden: Vergleich mit festem Wert; sonst: Vergleich mit Ziel-Komponente (targetVal)
    const raw = targetValue !== undefined && targetValue !== null ? targetValue : targetVal;
    if (raw === undefined || raw === null) return false;
    const t = typeof raw;
    const valid = t === "number" || t === "string" || t === "boolean" || (Array.isArray(raw) && raw.every((x) => typeof x === "number"));
    if (!valid) return false;
    return compareValues(sourceVal as number | string | boolean, targetOp, raw as number | number[] | string | boolean);
  }

  // Single component condition (e.g. physical rules)
  const componentType = condition.component_type;
  const attribute = condition.attribute;
  const operator = condition.operator || "equals";
  const value = condition.value;

  if (!componentType || !attribute) return true;

  const data = getComponentData(config, componentType);
  const actual = data ? ((data as Record<string, unknown>)[attribute] ?? (data.attributes as Record<string, unknown>)?.[attribute]) : undefined;

  if (actual === undefined) return false;
  if (value === null) return false;
  return compareValues(actual as number | string | boolean, operator, value);
}

function getComponentData(config: ConfigContext, componentType: string): Record<string, unknown> | undefined {
  const key = `selected_${componentType}`;
  const val = config[key];
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : undefined;
}

function compareValues(
  actual: number | string | boolean,
  operator: string,
  expected: number | number[] | string | boolean | undefined
): boolean {
  if (expected === undefined) return false;
  const a = typeof actual === "number" ? actual : Number(actual);
  const e = typeof expected === "number" ? expected : Array.isArray(expected) ? expected : Number(expected);

  switch (operator) {
    case "equals":
    case "==":
      return a === e || (Array.isArray(expected) && expected.includes(a));
    case "not_equals":
    case "!=":
      return Array.isArray(expected) ? !expected.includes(a) : a !== e;
    case "in":
      return Array.isArray(expected) && expected.includes(a);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(a);
    case ">":
      return a > (Array.isArray(expected) ? Math.max(...expected) : (e as number));
    case ">=":
      return a >= (Array.isArray(expected) ? Math.min(...expected) : (e as number));
    case "<":
      return a < (Array.isArray(expected) ? Math.min(...expected) : (e as number));
    case "<=":
      return a <= (Array.isArray(expected) ? Math.max(...expected) : (e as number));
    default:
      return a === e;
  }
}

/**
 * Evaluate a configuration rule calculation (e.g. "config.frame_quantity = config.field_count + 1")
 * Simple expression evaluator for configuration rules
 */
export function evaluateCalculation(calculation: string, config: ConfigContext): ConfigContext {
  if (!calculation || typeof calculation !== "string") return config;

  const trimmed = calculation.trim();
  const match = trimmed.match(/config\.(\w+)\s*=\s*(.+)/);
  if (!match) return config;

  const [, targetKey, expr] = match;
  const result = evalExpression(expr, config);
  if (result !== undefined) {
    return { ...config, [targetKey]: result };
  }
  return config;
}

function evalExpression(expr: string, config: ConfigContext): number | undefined {
  // Replace config.field_name with numeric values
  let safe = expr.replace(/config\.(\w+)/g, (_, key) => {
    const v = config[key];
    return typeof v === "number" ? String(v) : "0";
  });

  // Replace min(a, b, ...) and max(a, b, ...)
  safe = safe.replace(/min\s*\(([^)]+)\)/g, (_, args) => {
    const vals = args.split(",").map((s: string) => parseFloat(s.trim()) || 0);
    return String(Math.min(...vals));
  });
  safe = safe.replace(/max\s*\(([^)]+)\)/g, (_, args) => {
    const vals = args.split(",").map((s: string) => parseFloat(s.trim()) || 0);
    return String(Math.max(...vals));
  });

  // Only allow digits, operators +, -, *, /, parentheses, spaces
  if (!/^[\d\s+\-*/().]+$/.test(safe)) return undefined;

  try {
    const result = new Function(`"use strict"; return (${safe})`)();
    return typeof result === "number" && !Number.isNaN(result) ? result : undefined;
  } catch {
    return undefined;
  }
}
