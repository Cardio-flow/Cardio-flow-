// Decision first (23 Oct 2026): a pathway opens on this patient's decision, computed from the record and the
// guideline; checks are a reminder list; alternatives are one tap. Hyperkalaemia is the template.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prefill } from "../shared/wizard-prefill.js";
import { buildOutcome, type WizardContext, type WizardMed } from "../shared/wizards.js";
import { applyInstead, decisionView } from "../shared/decision-first.js";

const med = (id: string, code: string, name: string, dose: number, tags: string[], unit = "mg"): WizardMed =>
  ({ id, code, name, doseValue: dose, doseUnit: unit, frequency: "OD", tags });
const ctx = (k: number, meds: WizardMed[], extra: Partial<WizardContext> = {}): WizardContext => ({
  today: "2026-10-23", meds, facts: [], detected: {},
  values: { potassium: { value: k, at: "2026-10-22", prev: 4.9 }, creatinine: { value: 121, at: "2026-10-22", prev: 102 } },
  dx: ["hfref", "hf"], ...extra,
} as any);
const spiro = med("m1", "spironolactone", "Spironolactone", 25, ["mra", "potassium-sparing"]);
const arni = med("m2", "sacubitril-valsartan", "Sacubitril/valsartan", 97, ["raas", "arni"]);
const ibu = med("m3", "ibuprofen", "Ibuprofen", 400, ["nsaid"]);
const run = (c: WizardContext) => {
  const { answers } = prefill("hyperkalaemia", c);
  return { answers, out: buildOutcome("hyperkalaemia", answers, c), view: decisionView("hyperkalaemia", answers, c) };
};

test("K 5.8 on spironolactone 25 mg: halve to 12.5 mg, stop the NSAID, recheck in 1 week — no question left", () => {
  const { out, view } = run(ctx(5.8, [spiro, arni, ibu]));
  const labels = out.map((o) => o.label);
  assert.ok(labels.includes("Spironolactone: 25 mg → 12.5 mg"), labels.join(" | "));
  assert.ok(labels.includes("Ibuprofen: stop"));
  assert.ok(labels.some((l) => /^Renal function and potassium check · Fri 30 Oct 2026/.test(l)));
  assert.ok(!labels.some((l) => /Sacubitril/.test(l)), "the ARNI is kept when the MRA is reduced");
  assert.deepEqual(view.needed.map((q) => q.id), [], "nothing to answer");
  assert.ok(view.why.some((w) => /halve Spironolactone/.test(w.why)));
  assert.ok(view.instead.some((x) => x.value === "binder") && view.instead.some((x) => x.value === "repeat"));
  assert.ok(view.check.some((c) => /Creatinine 102 → 121/.test(c)) && view.check.some((c) => /Ibuprofen/.test(c)));
});

test("binder instead: keep the doses, patiromer 8.4 g once daily (label start), recheck in 1 week", () => {
  const c = ctx(5.8, [spiro, arni]);
  const { answers } = prefill("hyperkalaemia", c);
  const alt = decisionView("hyperkalaemia", answers, c).instead.find((x) => x.value === "binder")!;
  const a2 = applyInstead(answers, "hyperkalaemia", alt.question, alt.value, alt.replaces);
  const out = buildOutcome("hyperkalaemia", a2, c);
  assert.ok(!out.some((o) => o.kind === "medication" && /Spironolactone/.test(o.label)), "the MRA dose is kept");
  const start = out.find((o) => o.kind === "start") as any;
  assert.equal(start.code, "patiromer");
  assert.equal(start.doseValue, 8.4);
});

test("K 6.2: stop MRA and ARNI, repeat today; the ECG is needed before the decision stands", () => {
  const { out, view } = run(ctx(6.2, [spiro, arni]));
  const labels = out.map((o) => o.label);
  assert.ok(labels.includes("Spironolactone: hold") && labels.includes("Sacubitril/valsartan: hold"), labels.join(" | "));
  assert.ok(labels.some((l) => /Renal function and potassium check · Fri 23 Oct 2026/.test(l)));
  assert.deepEqual(view.needed.map((q) => q.id), ["ecg"]);
  assert.ok(!view.instead.some((x) => x.value === "binder"), "no binder offered above 6.0");
});

test("K 5.3: keep the doses and protect them with patiromer by default (MKH default, ESC IIb); no binder or Lokelma are one tap", () => {
  const c = ctx(5.3, [spiro, arni]);
  const { out, view, answers } = run(c);
  assert.ok((answers.actions as string[]).includes("continue") && (answers.actions as string[]).includes("binder"));
  assert.ok(!out.some((o) => o.kind === "medication"), "doses unchanged");
  assert.equal((out.find((o) => o.kind === "start") as any)?.code, "patiromer");
  assert.ok(out.some((o) => o.kind === "plan" && /Fri 30 Oct 2026/.test(o.label)), "recheck after 1 week");
  assert.deepEqual(view.needed.map((q) => q.id), []);
  const none = view.instead.find((x) => x.value === "no-binder")!;
  const a2 = applyInstead(answers, "hyperkalaemia", none.question, none.value, none.replaces);
  assert.ok(!buildOutcome("hyperkalaemia", a2, c).some((o) => o.kind === "start"), "no binder when chosen");
  assert.ok(view.instead.some((x) => x.value === "binder-szc"));
  assert.ok(!run(ctx(5.3, [spiro, arni, med("m9", "patiromer", "Patiromer", 8.4, ["k-binder"], "g")])).out.some((o) => o.kind === "start"), "already on a binder: none started");
});

test("K 6.6: same-day emergency treatment (not dosed here)", () => {
  const { out } = run(ctx(6.6, [spiro]));
  assert.ok(out.some((o) => o.kind === "plan" && /Same-day urgent assessment/.test(o.title)));
  assert.ok(!out.some((o) => o.kind === "start"), "no acute drug is dosed");
});

test("Lokelma instead: keep the doses, 5 g once daily (SmPC maintenance; correction phase not dosed), recheck set by the clinician", () => {
  const c = ctx(5.8, [spiro, arni]);
  const { answers } = prefill("hyperkalaemia", c);
  const alt = decisionView("hyperkalaemia", answers, c).instead.find((x) => x.value === "binder-szc")!;
  assert.match(alt.why, /400 mg sodium/);
  const a2 = applyInstead({ ...answers, recheck: undefined as any }, "hyperkalaemia", alt.question, alt.value, alt.replaces);
  const out = buildOutcome("hyperkalaemia", a2, c);
  const start = out.find((o) => o.kind === "start") as any;
  assert.equal(start.code, "sodium-zirconium-cyclosilicate");
  assert.equal(start.doseValue, 5);
  assert.ok(!out.some((o) => o.kind === "medication" && /Spironolactone/.test(o.label)));
  assert.deepEqual(decisionView("hyperkalaemia", a2, c).needed.map((q) => q.id), ["recheck"]);
});
