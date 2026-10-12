// Ingredient identities come from the existing catalogue combination names. No dose
// ceiling or clinical contraindication is inferred from duplication alone.
const COMBINATIONS: Record<string, string[]> = {
  "sacubitril-valsartan": ["sacubitril", "valsartan"],
  "amlodipine-valsartan": ["amlodipine", "valsartan"],
  "valsartan-hctz": ["valsartan", "hydrochlorothiazide"],
  "losartan-hctz": ["losartan", "hydrochlorothiazide"],
  "telmisartan-amlodipine": ["telmisartan", "amlodipine"],
  "perindopril-indapamide": ["perindopril", "indapamide"],
  "perindopril-amlodipine": ["perindopril", "amlodipine"],
};
export const ingredientsFor = (code: string) => COMBINATIONS[code] ?? [code];
type Medicine = {
  id: string;
  code: string;
  name: string;
  tags: string[];
  status: string;
};
export function medicationOverlaps(meds: Medicine[]) {
  const live = meds.filter((m) =>
    ["active", "held", "not_taking"].includes(m.status),
  );
  const pairs: { ids: string[]; names: string[]; detail: string }[] = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i],
        b = live[j];
      const common = ingredientsFor(a.code).filter((c) =>
        ingredientsFor(b.code).includes(c),
      );
      const statins = a.tags.includes("statin") && b.tags.includes("statin");
      if (common.length || statins)
        pairs.push({
          ids: [a.id, b.id],
          names: [a.name, b.name],
          detail: common.length
            ? `Shared ingredient: ${common.join(", ")}`
            : "Two current statins",
        });
    }
  return pairs;
}
