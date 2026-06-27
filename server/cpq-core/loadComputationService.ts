import type {
  CpqConfigurationInput,
  CpqEffectiveFachlastEntry,
  CpqShelfInput,
} from "./contracts";

type EffectiveLoadResult = {
  effectiveFachlasten: CpqEffectiveFachlastEntry[];
  hasFieldLoadReduction: boolean;
  hasSevereReduction: boolean;
};

function expandShelves(shelves: CpqShelfInput[]): CpqShelfInput[] {
  const expanded: CpqShelfInput[] = [];

  for (const shelf of shelves) {
    const count = Math.max(1, shelf.count ?? 1);
    for (let i = 0; i < count; i += 1) {
      expanded.push({
        ...shelf,
        count: 1,
      });
    }
  }

  return expanded;
}

export function computeEffectiveFachlasten(
  configuration: CpqConfigurationInput
): EffectiveLoadResult {
  const expandedShelves = expandShelves(configuration.shelves);
  const maxFeldlastKg = configuration.frame.maxFeldlastKg ?? Number.POSITIVE_INFINITY;

  const nominalPerShelf = expandedShelves.map((shelf) => {
    if (shelf.position === "abdeckboden") {
      return Math.min(shelf.maxFachlastKg, 200);
    }
    return shelf.maxFachlastKg;
  });

  const nominalSum = nominalPerShelf.reduce((sum, value) => sum + value, 0);
  const reductionFactor =
    nominalSum > 0 && nominalSum > maxFeldlastKg ? maxFeldlastKg / nominalSum : 1;

  const effectiveFachlasten = nominalPerShelf.map((nominalKg, shelfIndex) => {
    const effectiveKg = Number((nominalKg * reductionFactor).toFixed(2));
    const reducedByFieldLimit = reductionFactor < 1;

    return {
      shelfIndex,
      nominalKg,
      effectiveKg,
      reducedByFieldLimit,
      reason: reducedByFieldLimit
        ? "Feldlast-Limit reduziert die effektive Fachlast"
        : undefined,
    };
  });

  const hasSevereReduction = effectiveFachlasten.some(
    (entry) => entry.nominalKg > 0 && entry.effectiveKg / entry.nominalKg < 0.8
  );

  return {
    effectiveFachlasten,
    hasFieldLoadReduction: reductionFactor < 1,
    hasSevereReduction,
  };
}
