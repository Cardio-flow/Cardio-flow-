export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export type DataPriority = "required" | "recommended" | "advanced";

export type StructuredFieldCondition = {
  key: string;
  operator: "equals" | "not_equals" | "includes" | "one_of" | "present";
  value?: string | string[];
};

export type StructuredFieldDefinition = {
  key: string;
  label: string;
  valueType: "choice" | "multi" | "number" | "text" | "date" | "boolean";
  conceptCode?: string;
  options?: string[];
  units?: string[];
  searchable?: boolean;
  priority: DataPriority;
  conditions?: StructuredFieldCondition[];
};

export function visibleStructuredFields(
  fields: StructuredFieldDefinition[],
  values: Record<string, unknown>,
) {
  return fields.filter((field) =>
    (field.conditions ?? []).every((condition) => {
      const value = values[condition.key];
      if (condition.operator === "present")
        return value !== undefined && value !== "" && value !== null;
      if (condition.operator === "equals") return value === condition.value;
      if (condition.operator === "not_equals") return value !== condition.value;
      if (condition.operator === "one_of") {
        const choices = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        return Array.isArray(value)
          ? value.some((item) => choices.includes(String(item)))
          : choices.includes(String(value));
      }
      return (
        Array.isArray(value) &&
        typeof condition.value === "string" &&
        value.includes(condition.value)
      );
    }),
  );
}

export function searchFieldOptions(
  field: StructuredFieldDefinition,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return field.options ?? [];
  return (field.options ?? []).filter((option) =>
    option.toLocaleLowerCase().includes(normalized),
  );
}

export type UnitDefinition = {
  code: string;
  symbol: string;
  dimension: string;
  canonicalCode: string;
  factor: number;
  offset: number;
  version: number;
};

export function convertUnit(
  value: number,
  from: UnitDefinition,
  to: UnitDefinition,
) {
  if (!Number.isFinite(value)) throw new Error("A finite value is required");
  if (from.dimension !== to.dimension)
    throw new Error("Units describe different clinical dimensions");
  const canonical = value * from.factor + from.offset;
  return (canonical - to.offset) / to.factor;
}

export type ClinicalValue =
  | { type: "quantity"; value: number; unit: string }
  | { type: "coded"; code: string; display: string; system?: string }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string }
  | { type: "json"; value: Json };

export type VerificationStatus =
  "unconfirmed" | "preliminary" | "verified" | "entered_in_error";
export type SourceQuality = "unknown" | "low" | "moderate" | "high";
export type FactLifecycle = "active" | "resolved" | "retracted";

export type ClinicalFact = {
  id: string;
  logical_id: string;
  version: number;
  patient_id: string;
  encounter_id: string | null;
  concept_system: string;
  concept_code: string;
  concept_version: number;
  value: ClinicalValue;
  observed_at: string;
  effective_start: string;
  effective_end: string | null;
  recorded_at: string;
  source_type: string;
  source_id: string;
  source_label: string;
  source_quality: SourceQuality;
  verification_status: VerificationStatus;
  lifecycle_status: FactLifecycle;
  author: string;
  supersedes_fact_id: string | null;
};

export type ClinicalPreference = {
  id: string;
  patient_id: string;
  concept_system: string;
  concept_code: string;
  fact_id: string | null;
  action: "select" | "release";
  reason: string;
  actor: string;
  created_at: string;
};

export type ResolvedConcept = {
  concept_system: string;
  concept_code: string;
  current: ClinicalFact | null;
  pending: ClinicalFact[];
  history: ClinicalFact[];
  superseded: ClinicalFact[];
  conflicts: ClinicalFact[];
  rationale: string;
};

export type ClinicalState = {
  asOf: string;
  concepts: ResolvedConcept[];
};

const instant = (value: string) => {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : 0;
};

function currentAssertions(facts: ClinicalFact[]) {
  const byLogical = new Map<string, ClinicalFact>();
  for (const fact of facts) {
    const previous = byLogical.get(fact.logical_id);
    if (
      !previous ||
      fact.version > previous.version ||
      (fact.version === previous.version &&
        instant(fact.recorded_at) > instant(previous.recorded_at))
    )
      byLogical.set(fact.logical_id, fact);
  }
  return [...byLogical.values()];
}

function preferenceByConcept(preferences: ClinicalPreference[]) {
  const latest = new Map<string, ClinicalPreference>();
  for (const preference of preferences) {
    const key = `${preference.concept_system}|${preference.concept_code}`;
    const previous = latest.get(key);
    if (
      !previous ||
      instant(preference.created_at) > instant(previous.created_at)
    )
      latest.set(key, preference);
  }
  return latest;
}

const verificationRank: Record<VerificationStatus, number> = {
  entered_in_error: 0,
  unconfirmed: 1,
  preliminary: 2,
  verified: 3,
};
const qualityRank: Record<SourceQuality, number> = {
  unknown: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

function compareFacts(a: ClinicalFact, b: ClinicalFact) {
  return (
    verificationRank[b.verification_status] -
      verificationRank[a.verification_status] ||
    qualityRank[b.source_quality] - qualityRank[a.source_quality] ||
    instant(b.observed_at) - instant(a.observed_at) ||
    instant(b.recorded_at) - instant(a.recorded_at)
  );
}

export function resolveClinicalState(
  facts: ClinicalFact[],
  preferences: ClinicalPreference[] = [],
  asOf = new Date().toISOString(),
): ClinicalState {
  const cutoff = instant(asOf),
    preferred = preferenceByConcept(preferences),
    grouped = new Map<string, ClinicalFact[]>();
  for (const fact of facts) {
    const key = `${fact.concept_system}|${fact.concept_code}`;
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  const concepts = [...grouped.entries()]
    .map(([key, history]): ResolvedConcept => {
      const [concept_system, concept_code] = key.split("|"),
        assertions = currentAssertions(history),
        pending = assertions.filter(
          (fact) =>
            fact.verification_status === "unconfirmed" ||
            fact.verification_status === "preliminary",
        ),
        eligible = assertions.filter(
          (fact) =>
            fact.verification_status === "verified" &&
            fact.lifecycle_status === "active" &&
            instant(fact.effective_start) <= cutoff &&
            (!fact.effective_end || instant(fact.effective_end) > cutoff),
        ),
        override = preferred.get(key),
        selected =
          override?.action === "select"
            ? eligible.find((fact) => fact.id === override.fact_id)
            : undefined,
        ranked = [...eligible].sort(compareFacts),
        current = selected ?? ranked[0] ?? null,
        sameRank = current
          ? ranked.filter(
              (fact) =>
                fact.id !== current.id &&
                verificationRank[fact.verification_status] ===
                  verificationRank[current.verification_status] &&
                qualityRank[fact.source_quality] ===
                  qualityRank[current.source_quality] &&
                instant(fact.observed_at) === instant(current.observed_at),
            )
          : [];
      return {
        concept_system,
        concept_code,
        current,
        pending: pending.filter((fact) => fact.id !== current?.id),
        history: [...history].sort(
          (a, b) => instant(b.observed_at) - instant(a.observed_at),
        ),
        superseded: history.filter(
          (fact) =>
            fact.id !== current?.id &&
            !pending.some((candidate) => candidate.id === fact.id),
        ),
        conflicts: sameRank,
        rationale: selected
          ? `Clinician preference selected ${selected.source_label}.`
          : current
            ? `Selected by verification, source quality, observation time, then recording time.`
            : "No active valid assertion at the requested time.",
      };
    })
    .sort((a, b) => a.concept_code.localeCompare(b.concept_code));
  return { asOf, concepts };
}

export function currentFact(state: ClinicalState, conceptCode: string) {
  return state.concepts.find((item) => item.concept_code === conceptCode)
    ?.current;
}

export type FactOperator =
  | "exists"
  | "not_exists"
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "includes";

export type RuleCondition =
  | { kind: "all"; conditions: RuleCondition[] }
  | { kind: "any"; conditions: RuleCondition[] }
  | { kind: "not"; condition: RuleCondition }
  | {
      kind: "fact";
      conceptCode: string;
      operator: FactOperator;
      value?: string | number | boolean;
      maxAgeDays?: number;
    }
  | {
      kind: "days_since";
      conceptCode: string;
      operator:
        "greater_than" | "greater_or_equal" | "less_than" | "less_or_equal";
      days: number;
    };

export type ConditionEvaluation = {
  outcome: "true" | "false" | "unknown";
  factIds: string[];
  missingConcepts: string[];
  explanation: string[];
};

function rawValue(value: ClinicalValue): string | number | boolean | Json {
  if (
    value.type === "quantity" ||
    value.type === "boolean" ||
    value.type === "text"
  )
    return value.value;
  if (value.type === "coded") return value.code;
  return value.value;
}

function compare(
  actual: string | number | boolean | Json,
  operator: FactOperator,
  expected: string | number | boolean | undefined,
) {
  if (operator === "exists") return true;
  if (operator === "not_exists") return false;
  if (operator === "equals") return actual === expected;
  if (operator === "not_equals") return actual !== expected;
  if (operator === "includes")
    return Array.isArray(actual)
      ? actual.includes(expected as never)
      : String(actual).includes(String(expected));
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "greater_than") return actual > expected;
  if (operator === "greater_or_equal") return actual >= expected;
  if (operator === "less_than") return actual < expected;
  return actual <= expected;
}

export function evaluateCondition(
  condition: RuleCondition,
  state: ClinicalState,
): ConditionEvaluation {
  if (condition.kind === "all" || condition.kind === "any") {
    const children = condition.conditions.map((child) =>
        evaluateCondition(child, state),
      ),
      wantsAll = condition.kind === "all",
      outcome = wantsAll
        ? children.some((child) => child.outcome === "false")
          ? "false"
          : children.some((child) => child.outcome === "unknown")
            ? "unknown"
            : "true"
        : children.some((child) => child.outcome === "true")
          ? "true"
          : children.some((child) => child.outcome === "unknown")
            ? "unknown"
            : "false";
    return {
      outcome,
      factIds: [...new Set(children.flatMap((child) => child.factIds))],
      missingConcepts: [
        ...new Set(children.flatMap((child) => child.missingConcepts)),
      ],
      explanation: children.flatMap((child) => child.explanation),
    };
  }
  if (condition.kind === "not") {
    const child = evaluateCondition(condition.condition, state);
    return {
      ...child,
      outcome:
        child.outcome === "unknown"
          ? "unknown"
          : child.outcome === "true"
            ? "false"
            : "true",
    };
  }
  const fact = currentFact(state, condition.conceptCode);
  if (!fact) {
    const absenceIsAnswer =
      condition.kind === "fact" && condition.operator === "not_exists";
    return {
      outcome: absenceIsAnswer ? "true" : "unknown",
      factIds: [],
      missingConcepts: absenceIsAnswer ? [] : [condition.conceptCode],
      explanation: [`${condition.conceptCode}: no current verified value`],
    };
  }
  if (condition.kind === "days_since") {
    const days = Math.floor(
      (instant(state.asOf) - instant(fact.observed_at)) / 86_400_000,
    );
    return {
      outcome: compare(days, condition.operator, condition.days)
        ? "true"
        : "false",
      factIds: [fact.id],
      missingConcepts: [],
      explanation: [`${condition.conceptCode}: ${days} days since observation`],
    };
  }
  if (
    condition.maxAgeDays !== undefined &&
    instant(state.asOf) - instant(fact.observed_at) >
      condition.maxAgeDays * 86_400_000
  )
    return {
      outcome: "unknown",
      factIds: [fact.id],
      missingConcepts: [condition.conceptCode],
      explanation: [`${condition.conceptCode}: available value is too old`],
    };
  return {
    outcome: compare(rawValue(fact.value), condition.operator, condition.value)
      ? "true"
      : "false",
    factIds: [fact.id],
    missingConcepts: [],
    explanation: [`${condition.conceptCode}: evaluated ${condition.operator}`],
  };
}

export type EvidenceReference = {
  key: string;
  version: string;
  title: string;
  organization: string;
  publicationYear: number | null;
  locator?: string;
  reviewedAt: string;
};

export type RuleTaskProposal = {
  kind: "clinical_review" | "laboratory" | "follow_up" | "reassessment";
  purpose: string;
  dueInDays?: number;
  relatedConcept?: string;
};

export type ClinicalRule = {
  key: string;
  version: number;
  status: "draft" | "active" | "retired";
  topic: string;
  priority: 1 | 2 | 3 | 4 | 5 | 6;
  trigger: RuleCondition;
  required?: RuleCondition[];
  exclusions?: RuleCondition[];
  conflictGroup?: string;
  output: {
    title: string;
    recommendation: string;
    alert?: {
      category:
        | "critical"
        | "warning"
        | "clinical_review"
        | "monitoring"
        | "treatment_opportunity"
        | "informational"
        | "administrative";
      severity: "critical" | "high" | "moderate" | "low" | "information";
    };
    tasks?: RuleTaskProposal[];
  };
  evidence: EvidenceReference[];
};

export type RuleEvaluation = {
  rule: ClinicalRule;
  status: "inactive" | "active" | "needs_data" | "excluded" | "suppressed";
  factIds: string[];
  missingConcepts: string[];
  explanation: string[];
  suppressedBy?: string;
};

export function evaluateRule(
  rule: ClinicalRule,
  state: ClinicalState,
): RuleEvaluation {
  if (rule.status !== "active")
    return {
      rule,
      status: "inactive",
      factIds: [],
      missingConcepts: [],
      explanation: ["Rule is not active."],
    };
  const trigger = evaluateCondition(rule.trigger, state);
  if (trigger.outcome === "false")
    return { rule, status: "inactive", ...withoutOutcome(trigger) };
  if (trigger.outcome === "unknown")
    return { rule, status: "needs_data", ...withoutOutcome(trigger) };
  const exclusions = (rule.exclusions ?? []).map((condition) =>
    evaluateCondition(condition, state),
  );
  if (exclusions.some((result) => result.outcome === "true"))
    return {
      rule,
      status: "excluded",
      ...mergeEvaluations([trigger, ...exclusions]),
    };
  const required = (rule.required ?? []).map((condition) =>
      evaluateCondition(condition, state),
    ),
    merged = mergeEvaluations([trigger, ...required]);
  if (required.some((result) => result.outcome !== "true"))
    return { rule, status: "needs_data", ...merged };
  return { rule, status: "active", ...merged };
}

function withoutOutcome(value: ConditionEvaluation) {
  const { outcome: _outcome, ...rest } = value;
  return rest;
}

function mergeEvaluations(values: ConditionEvaluation[]) {
  return {
    factIds: [...new Set(values.flatMap((value) => value.factIds))],
    missingConcepts: [
      ...new Set(values.flatMap((value) => value.missingConcepts)),
    ],
    explanation: values.flatMap((value) => value.explanation),
  };
}

export function evaluateRules(rules: ClinicalRule[], state: ClinicalState) {
  const evaluations = rules.map((rule) => evaluateRule(rule, state)),
    winners = new Map<string, RuleEvaluation>();
  for (const evaluation of evaluations
    .filter((item) => item.status === "active" && item.rule.conflictGroup)
    .sort((a, b) => a.rule.priority - b.rule.priority)) {
    const group = evaluation.rule.conflictGroup!;
    if (!winners.has(group)) winners.set(group, evaluation);
    else {
      evaluation.status = "suppressed";
      evaluation.suppressedBy = winners.get(group)!.rule.key;
      evaluation.explanation.push(
        `Suppressed by higher-priority rule ${evaluation.suppressedBy}.`,
      );
    }
  }
  return evaluations;
}

export type PathwayChoice = { value: string; label: string; next: string };
export type PathwayNode = {
  id: string;
  type: "decision" | "action" | "terminal";
  title: string;
  conceptCode?: string;
  choices?: PathwayChoice[];
  next?: string;
  why?: string;
  evidence?: EvidenceReference[];
};
export type PathwayDefinition = {
  key: string;
  version: number;
  status: "draft" | "active" | "retired";
  title: string;
  start: string;
  nodes: PathwayNode[];
};

export type PathwayResolution = {
  traversed: string[];
  current: PathwayNode | null;
  known: { conceptCode: string; factId: string; value: unknown }[];
  needed: string[];
  complete: boolean;
};

export function resolvePathway(
  definition: PathwayDefinition,
  state: ClinicalState,
  responses: Record<string, string> = {},
): PathwayResolution {
  const nodes = new Map(definition.nodes.map((node) => [node.id, node])),
    traversed: string[] = [],
    known: PathwayResolution["known"] = [],
    needed: string[] = [];
  let id: string | undefined = definition.start;
  for (let guard = 0; id && guard < definition.nodes.length + 1; guard++) {
    if (traversed.includes(id)) throw new Error("Pathway contains a cycle");
    const node = nodes.get(id);
    if (!node) throw new Error(`Pathway node not found: ${id}`);
    traversed.push(id);
    if (node.type === "terminal")
      return { traversed, current: node, known, needed, complete: true };
    if (node.type === "action") {
      if (!node.next)
        return { traversed, current: node, known, needed, complete: true };
      id = node.next;
      continue;
    }
    let response = responses[node.id];
    if (!response && node.conceptCode) {
      const fact = currentFact(state, node.conceptCode);
      if (fact) {
        const value = rawValue(fact.value);
        response = String(value);
        known.push({ conceptCode: node.conceptCode, factId: fact.id, value });
      }
    }
    if (!response) {
      if (node.conceptCode) needed.push(node.conceptCode);
      return { traversed, current: node, known, needed, complete: false };
    }
    const choice = node.choices?.find(
      (candidate) =>
        candidate.value.toLocaleLowerCase() === response!.toLocaleLowerCase(),
    );
    if (!choice)
      return { traversed, current: node, known, needed, complete: false };
    id = choice.next;
  }
  throw new Error("Pathway could not be resolved");
}
