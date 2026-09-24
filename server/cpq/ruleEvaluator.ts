/**
 * CPQ Rule Evaluator - evaluates condition and action JSON from cpq_rules
 *
 * Logik lebt jetzt in shared/cpqRuleEvaluator.ts (auch vom Client genutzt, z.B.
 * CpqCompatibilityMatrix.tsx). Re-Export hier, damit bestehende Server-Imports
 * unverändert funktionieren.
 */

export {
  evaluateCondition,
  evaluateCalculation,
  compareValues,
  type CpqCondition,
  type CpqAction,
  type ConfigContext,
} from "@shared/cpqRuleEvaluator";
