/**
 * CPQ Unit tests – Rule Evaluator und Constraint Engine
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import { evaluateCondition, evaluateCalculation, type ConfigContext } from "../../server/cpq/ruleEvaluator";
import { evaluateRules } from "../../server/cpq/constraintEngine";
import type { CpqRule } from "../../shared/schema";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  const msg = message ?? `Expected ${String(expected)}, got ${String(actual)}`;
  assert(actual === expected, msg);
}

// Aus scripts/testCpqUnits.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("CpqUnits", () => {
  it("ruleEvaluator.evaluateCondition (single component)", () => {
    // Conditions use selected_<type> (e.g. selected_frame) from config
    const config: ConfigContext = {
      selected_frame: { height: 2500, depth: 600, attributes: { height: 2500, depth: 600 } },
      field_count: 4,
    };
    assert(evaluateCondition({ component_type: "frame", attribute: "height", operator: ">", value: 2000 }, config) === true, "height > 2000");
    assert(evaluateCondition({ component_type: "frame", attribute: "height", operator: ">", value: 3000 }, config) === false, "height > 3000 false");
    assert(evaluateCondition({ component_type: "frame", attribute: "depth", operator: "in", value: [400, 500, 600] }, config) === true, "depth in [400,500,600]");
    assert(evaluateCondition({ component_type: "frame", attribute: "depth", operator: "in", value: [400, 500] }, config) === false, "depth not in [400,500]");
  });

  it("ruleEvaluator.evaluateCalculation", () => {
    const config: ConfigContext = { field_count: 4, level_count: 5 };
    let out = evaluateCalculation("config.frame_quantity = config.field_count + 1", config);
    assertEqual(out.frame_quantity, 5, "frame_quantity = field_count + 1");

    out = evaluateCalculation("config.beam_quantity = config.level_count * config.field_count * 2", { ...config, ...out });
    assertEqual(out.beam_quantity, 40, "beam_quantity = level_count * field_count * 2");

    out = evaluateCalculation("config.shelf_quantity = config.level_count * config.field_count", { ...config, ...out });
    assertEqual(out.shelf_quantity, 20, "shelf_quantity = level_count * field_count");
  });

  it("constraintEngine.evaluateRules (configuration)", () => {
    const rules: CpqRule[] = [
      {
        id: "r1",
        systemId: "sys1",
        name: "frame qty",
        type: "configuration",
        priority: 10,
        status: "active",
        message: null,
        version: 1,
        condition: { calculation: "config.frame_quantity = config.field_count + 1" },
        action: {},
        fallback: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "r2",
        systemId: "sys1",
        name: "beam qty",
        type: "configuration",
        priority: 10,
        status: "active",
        message: null,
        version: 1,
        condition: { calculation: "config.beam_quantity = config.level_count * config.field_count * 2" },
        action: {},
        fallback: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const result = evaluateRules(rules, { field_count: 3, level_count: 4 });
    assertEqual(result.config.frame_quantity, 4, "engine: frame_quantity");
    assertEqual(result.config.beam_quantity, 24, "engine: beam_quantity");
    assert(result.valid === true, "engine: valid");
  });
});
