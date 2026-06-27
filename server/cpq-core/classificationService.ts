import type { CpqClassification, CpqConfigurationInput } from "./contracts";

const SPECIAL_HEIGHTS_MM = new Set([1000, 3500, 4000, 4300, 4500]);
const STANDARD_RAL_COLORS = new Set(["7035", "5010", "2001"]);

export type ClassificationSignals = {
  forceClassC?: boolean;
};

export function hasSpecialHeight(configuration: CpqConfigurationInput): boolean {
  return SPECIAL_HEIGHTS_MM.has(configuration.frame.heightMm);
}

export function hasSpecialRal(configuration: CpqConfigurationInput): boolean {
  const rawColor = configuration.ralColor?.trim();
  if (!rawColor) {
    return false;
  }

  return !STANDARD_RAL_COLORS.has(rawColor);
}

export function has10DayLeadTime(configuration: CpqConfigurationInput): boolean {
  return (configuration.leadTimeDays ?? 3) >= 10;
}

export function classifyConfiguration(
  configuration: CpqConfigurationInput,
  signals: ClassificationSignals = {}
): CpqClassification {
  if (signals.forceClassC || hasSpecialHeight(configuration) || hasSpecialRal(configuration)) {
    return "C";
  }

  if (has10DayLeadTime(configuration)) {
    return "B";
  }

  return "A";
}
