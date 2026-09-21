import type { Answers } from "./guided.js";
export type Condition =
  | { any: Condition[] }
  | { all: Condition[] }
  | { key: string; op: string; value: unknown };
export type RegistryField = {
  key: string;
  sourceKey: string;
  label: string;
  context: string;
  section: string;
  group: string;
  type: string;
  options: string[];
  unit: string;
  condition: Condition | null;
  blocked: string;
  sourceRequired: boolean;
  sourcePath: string;
};
export type RegistryPackage = {
  key: string;
  version: number;
  status: string;
  sourceSnapshot: string;
  inventoryRows: number;
  sharedIdentityRows: number;
  fields: RegistryField[];
};
export type RegistryAssessment = {
  id: string;
  patient_id: string;
  registry_key: string;
  package_version: number;
  context: string;
  encounter_id: string | null;
  answers: Answers;
  state: string;
  version: number;
  updated_by: string;
  updated_at: string;
};
export function registryVisible(
  pkg: RegistryPackage,
  answers: Answers,
  context: string,
): RegistryField[] {
  const all = new Map(
    pkg.fields.filter((f) => f.context === context).map((f) => [f.key, f]),
  );
  const cache = new Map<string, boolean>();
  function condition(c: Condition, visiting: Set<string>): boolean {
    if ("any" in c) return c.any.some((x) => condition(x, visiting));
    if ("all" in c) return c.all.every((x) => condition(x, visiting));
    const parent = all.get(c.key);
    if (!parent || !visible(parent, visiting)) return false;
    const v = answers[c.key];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length))
      return false;
    if (c.op === "eq") return v === c.value;
    if (c.op === "ne") return v !== c.value;
    if (c.op === "in") return Array.isArray(c.value) && c.value.includes(v);
    if (c.op === "contains")
      return Array.isArray(v)
        ? v.includes(String(c.value))
        : String(v).includes(String(c.value));
    if (c.op === "notEmpty") return true;
    return false;
  }
  function visible(f: RegistryField, visiting: Set<string>): boolean {
    if (cache.has(f.key)) return cache.get(f.key)!;
    if (f.blocked || visiting.has(f.key)) return false;
    const next = new Set(visiting);
    next.add(f.key);
    const show = !f.condition || condition(f.condition, next);
    cache.set(f.key, show);
    return show;
  }
  return [...all.values()].filter((f) => visible(f, new Set()));
}
export function cleanRegistry(
  pkg: RegistryPackage,
  answers: Answers,
  context: string,
): Answers {
  return Object.fromEntries(
    registryVisible(pkg, answers, context)
      .filter(
        (f) =>
          answers[f.key] !== undefined &&
          answers[f.key] !== "" &&
          (!Array.isArray(answers[f.key]) ||
            (answers[f.key] as string[]).length),
      )
      .map((f) => [f.key, answers[f.key]]),
  );
}
