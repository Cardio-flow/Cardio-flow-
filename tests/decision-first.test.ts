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

test("K 5.8 on spironolactone 25 mg: halve to 12.5 mg, stop the NSAID, recheck within 3 days — no question left", () => {
  const { out, view } = run(ctx(5.8, [spiro, arni, ibu]));
  const labels = out.map((o) => o.label);
  assert.ok(labels.includes("Spironolactone: 25 mg → 12.5 mg OD"), labels.join(" | "));
  assert.ok(labels.includes("Ibuprofen: stop"));
  assert.ok(labels.some((l) => /^Renal function and potassium check · Mon 26 Oct 2026/.test(l)));
  assert.ok(!labels.some((l) => /Sacubitril/.test(l)), "the ARNI is kept when the MRA is reduced");
  assert.deepEqual(view.needed.map((q) => q.id), [], "nothing to answer");
  assert.ok(view.why.some((w) => /halve Spironolactone/.test(w.why)));
  assert.ok(view.instead.some((x) => x.value === "binder") && view.instead.some((x) => x.value === "repeat"));
  assert.ok(view.check.some((c) => /Creatinine 102 → 121/.test(c)) && view.check.some((c) => /Ibuprofen/.test(c)));
});

test("binder instead: keep the doses, patiromer 8.4 g once daily with early potassium review", () => {
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
  assert.deepEqual(view.needed.map((q) => q.id), ["symptoms", "ecg"]);
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

test("Lokelma requests a correction prescription; no maintenance dose against an elevated result", () => {
  const c = ctx(5.8, [spiro, arni]);
  const { answers } = prefill("hyperkalaemia", c);
  const alt = decisionView("hyperkalaemia", answers, c).instead.find((x) => x.value === "binder-szc")!;
  assert.match(alt.why, /400 mg sodium/);
  const a2 = applyInstead({ ...answers, recheck: undefined as any }, "hyperkalaemia", alt.question, alt.value, alt.replaces);
  const out = buildOutcome("hyperkalaemia", a2, c);
  assert.ok(!out.some(o=>o.kind === "start"), "maintenance is not correction");
  assert.ok(out.some(o=>o.kind === "plan" && /10 g three times daily/.test(o.title)));
  assert.ok(out.some(o=>o.kind === "medication" && /Spironolactone/.test(o.label)), "requesting correction does not silently undo the MRA reduction");
  assert.deepEqual(decisionView("hyperkalaemia", a2, c).needed.map((q) => q.id), ["recheck"]);
});

// ---- all pathways (23 Oct 2026): screens are assumed, doses follow the guideline step ----
const furo = (dose: number) => med("f1", "furosemide", "Furosemide", dose, ["loop"]);
const decide = (w: string, c: WizardContext) => { const { answers } = prefill(w, c); return { answers, out: buildOutcome(w, answers, c), view: decisionView(w, answers, c) }; };

test("congestion on furosemide 40 mg: double to 80 mg (HFA 2019); red flags remain an essential check", () => {
  const c = ctx(4.6, [furo(40), spiro], { dx: ["hfref", "hf"] } as any);
  const { out: incomplete, view } = decide("congestion", c);
  assert.ok(!incomplete.some(o => o.kind === "medication"), "do not increase the loop before confirming clinical congestion and stability");
  const completed = prefill("congestion",c,{signs:["oedema"],redflags:["none"]}).answers;
  const out = buildOutcome("congestion",completed,c);
  assert.ok(out.some((o) => o.label === "Furosemide: 40 mg → 80 mg OD"), out.map((o) => o.label).join(" | "));
  assert.ok(!view.assumed.some((q) => q.id === "redflags"));
  assert.ok(decisionView("congestion",completed,c).why.some((w) => /double the dose/.test(w.why)));
  assert.deepEqual(view.needed.map((q) => q.id), ["signs", "redflags"], "no weight trend: the signs are asked");
  const c2 = ctx(4.6, [furo(40)], { dx: ["hfref", "hf"], values: { weight: { value: 81.5, at: "2026-10-21", prev: 78 } } } as any);
  assert.deepEqual(decide("congestion", c2).view.needed.map((q) => q.id), ["redflags"], "a recorded weight rise fills signs but cannot exclude red flags");
});

test("renal function, dry on furosemide 80 mg: one step lower to 40 mg", () => {
  const c = ctx(4.8, [furo(80), arni], { values: { creatinine: { value: 130, at: "2026-10-22", prev: 100 }, potassium: { value: 4.8, at: "2026-10-22", prev: 4.5 } } } as any);
  const p2 = prefill("renal-function", c, { volume: "dry" }).answers;
  const out = buildOutcome("renal-function", p2, c);
  assert.ok(out.some((o) => o.label === "Furosemide: 80 mg → 40 mg OD"), out.map((o) => o.label).join(" | "));
});

test("structural plan checklists default to pending and are listed as assumed, not asked", () => {
  const c = ctx(4.5, [], { dx: ["as-severe"] } as any);
  const { view } = decide("tavi-plan", c);
  const ids = view.assumed.map((q) => q.id);
  for (const id of ["team", "coronary", "labs", "infection"]) assert.ok(ids.includes(id), `${id} assumed: ${ids.join(",")}`);
  assert.ok(!view.needed.some((q) => ["team", "coronary", "labs", "infection"].includes(q.id)));
});

test("the follow-up visit is assumed none and shown; a pregnancy keeps lab pathways in specialist scope", () => {
  const { view } = decide("diabetes", ctx(4.5, [], { dx: ["t2dm", "dm"] } as any));
  assert.ok(view.assumed.some((q) => q.id === "review"));
  const preg = decide("anaemia-result", ctx(4.5, [], { dx: ["pregnancy-care"] } as any)).answers;
  assert.equal(preg.scope, "specialist");
});

// ---- label start doses (23 Oct 2026) ----
import { startItem, statinUp } from "../shared/start-doses.js";
test("starts carry the label dose: SGLT2i 10 mg, finerenone by eGFR, metformin, spironolactone by eGFR; refused below the label limit", () => {
  const c = (egfr: number, k = 4.5, meds: WizardMed[] = []) => ctx(k, meds, { values: { egfr: { value: egfr, at: "x", prev: null }, potassium: { value: k, at: "x", prev: null } } } as any);
  // one source with the HF alert engine (27 Oct 2026): dapagliflozin from eGFR 25, empagliflozin at 20–24
  assert.match((startItem("sglt2", c(45), "hf", "sglt2") as any).label, /^Dapagliflozin 10 mg once daily: start/);
  assert.match((startItem("sglt2", c(22), "hf", "sglt2") as any).label, /^Empagliflozin 10 mg once daily: start/);
  assert.equal((startItem("sglt2", c(18), "hf", "sglt2") as any).kind, "note");
  assert.equal(startItem("sglt2", c(45, 4.5, [med("e", "empagliflozin", "Empagliflozin", 10, ["sglt2"])]), "hf", "sglt2"), null, "already on one");
  assert.equal((startItem("finerenone", c(70), "ckd") as any).doseValue, 20);
  assert.equal((startItem("finerenone", c(40), "ckd") as any).doseValue, 10);
  assert.equal((startItem("finerenone", c(40, 5.2), "ckd") as any).kind, "note");
  assert.equal((startItem("mra", c(40), "hf") as any).doseValue, 25, "label start 25 mg (Aldactone SmPC)");
  assert.equal((startItem("mra", c(70), "hf") as any).doseValue, 25);
  assert.equal((startItem("mra", c(29), "hf") as any).kind, "note", "not below eGFR 30");
  assert.deepEqual((startItem("mra", ctx(4.5, [], { values: { potassium: { value: 4.5, at: "x", prev: null } } } as any), "hf") as any).needs, ["egfr"], "a missing eGFR is asked for");
  assert.match((startItem("metformin", c(40), "dm") as any).label, /maximum 1000 mg\/day/);
});
test("missing eGFR prevents an SGLT2 start; statin intensity uses the known dose", () => {
  const c = ctx(4.6, [], { dx: ["hfref", "hf"] } as any);
  const out = buildOutcome("congestion",prefill("congestion",c,{signs:["oedema"],redflags:["none"]}).answers,c);
  assert.ok(out.some(o=>o.kind === "note" && /Record eGFR/.test(o.label)));
  const starts = out.filter((o) => o.kind === "start").map((o: any) => `${o.code} ${o.doseValue}`);
  assert.deepEqual(starts.sort(), ["furosemide 40"]);
  const atorva = med("a", "atorvastatin", "Atorvastatin", 20, ["statin"]);
  assert.match(statinUp(ctx(4.5, [atorva]))[0].label, /20 mg → 40 mg/);
  const rosu = med("r", "rosuvastatin", "Rosuvastatin", 20, ["statin"]);
  assert.equal(statinUp(ctx(4.5, [rosu], { values: { egfr: { value: 25, at: "x", prev: null } } } as any))[0].kind, "note", "rosuvastatin 40 mg not with eGFR <30");
});
test("diabetes above target on metformin with HF: dapagliflozin 10 mg is started and counts as the glucose step", () => {
  const met = med("mt", "metformin", "Metformin", 1000, ["metformin"]);
  const c = ctx(4.5, [met], { dx: ["t2dm", "dm", "hf", "hfref"], values: { hba1c: { value: 8.4, at: "x", prev: null }, egfr: { value: 60, at: "x", prev: null } }, glycaemicTarget: { value: 7, label: "<7%" } } as any);
  const { out } = decide("diabetes", c);
  assert.ok(out.some((o: any) => o.kind === "start" && o.code === "dapagliflozin" && o.doseValue === 10), out.map((o) => o.label).join(" | "));
  assert.ok(!out.some((o) => /Start an SGLT2 inhibitor:/.test(o.label)), "no undosed plan item");
});
