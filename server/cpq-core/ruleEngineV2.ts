import type {
  CpqConfigurationInput,
  CpqConstraintRule,
  CpqValidationContext,
  CpqValidationResult,
} from "./contracts";
import { classifyConfiguration } from "./classificationService";
import { computeEffectiveFachlasten } from "./loadComputationService";

type EvaluateInput = {
  context: CpqValidationContext;
  configuration: CpqConfigurationInput;
  rules: CpqConstraintRule[];
};

type WorkingResult = {
  errors: string[];
  disclaimers: string[];
  defaultsApplied: string[];
  forceClassC: boolean;
};

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function ensureAnchoring(configuration: CpqConfigurationInput): boolean {
  return (
    configuration.frame.anchoringIncluded ||
    configuration.accessories.some((accessory) => accessory.requiresAnchoring)
  );
}

function hasAny80KgShelf(configuration: CpqConfigurationInput): boolean {
  return configuration.shelves.some((shelf) => shelf.maxFachlastKg === 80);
}

function evaluateRule(
  rule: CpqConstraintRule,
  configuration: CpqConfigurationInput,
  result: WorkingResult
): void {
  const message = rule.messageDe;
  const totalShelfCount = configuration.shelves.reduce(
    (sum, shelf) => sum + (shelf.count ?? 1),
    0
  );

  switch (rule.ruleId) {
    case "GEO-01": {
      const invalid = configuration.shelves.some(
        (shelf) => shelf.depthMm > configuration.frame.depthMm
      );
      if (invalid) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "GEO-02": {
      const invalid = configuration.shelves.some(
        (shelf) => shelf.widthMm !== configuration.frame.widthMm
      );
      if (invalid) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "GEO-04": {
      const specialHeights = new Set([1000, 3500, 4000, 4300, 4500]);
      if (specialHeights.has(configuration.frame.heightMm)) {
        result.forceClassC = true;
        pushUnique(result.disclaimers, message);
      }
      return;
    }
    case "GEO-05": {
      const maxShelves = Math.floor(configuration.frame.heightMm / 200);
      if (totalShelfCount > maxShelves) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "GEO-06": {
      const ratio = configuration.frame.heightMm / configuration.frame.depthMm;
      if (ratio > 4 && !ensureAnchoring(configuration)) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "LAST-05":
    case "LAST-06": {
      const needsAnchoring = configuration.accessories.some((accessory) => {
        return accessory.accessoryType === "reifenregal" || accessory.accessoryType === "schublade";
      });
      if (needsAnchoring && !ensureAnchoring(configuration)) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "BODEN-02":
    case "ZUB-03": {
      const hasSystemlochungRequirement = configuration.accessories.some(
        (accessory) => accessory.requiresSystemlochung
      );
      if (hasSystemlochungRequirement && hasAny80KgShelf(configuration)) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "OBF-01": {
      const surface = configuration.surface ?? configuration.frame.surface ?? "";
      if (surface === "verzinkt" && configuration.ralColor) {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "OBF-03": {
      const ral = configuration.ralColor?.trim();
      if (ral && !["7035", "5010", "2001"].includes(ral)) {
        result.forceClassC = true;
        pushUnique(result.disclaimers, message);
      }
      return;
    }
    case "OBF-04": {
      const ral = configuration.ralColor?.trim();
      if (ral && !["7035", "5010", "2001"].includes(ral)) {
        pushUnique(result.disclaimers, message);
      }
      return;
    }
    case "ANW-01": {
      if (configuration.application === "aussen") {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "ANW-02": {
      if (configuration.application === "erdbebenzone") {
        pushUnique(result.errors, message);
      }
      return;
    }
    case "BODEN-03":
    case "BODEN-04":
    case "ANW-03":
    case "ZUB-04": {
      if (rule.severity === "default") {
        pushUnique(result.defaultsApplied, message);
      }
      return;
    }
    default:
      return;
  }
}

export function evaluateCpqRules({
  context: _context,
  configuration,
  rules,
}: EvaluateInput): CpqValidationResult {
  const sortedRules = [...rules]
    .filter((rule) => rule.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.ruleId.localeCompare(b.ruleId));

  const result: WorkingResult = {
    errors: [],
    disclaimers: [],
    defaultsApplied: [],
    forceClassC: false,
  };

  for (const rule of sortedRules) {
    evaluateRule(rule, configuration, result);
  }

  const load = computeEffectiveFachlasten(configuration);
  if (load.hasSevereReduction) {
    pushUnique(
      result.disclaimers,
      "Fachlast wurde durch Feldlast-Limit deutlich reduziert; bitte Lastklasse oder Bodenanzahl pruefen."
    );
  }

  const classification = classifyConfiguration(configuration, {
    forceClassC: result.forceClassC,
  });

  return {
    valid: result.errors.length === 0,
    classification,
    errors: result.errors,
    disclaimers: result.disclaimers,
    defaultsApplied: result.defaultsApplied,
    computed: {
      effectiveFachlasten: load.effectiveFachlasten,
    },
  };
}
