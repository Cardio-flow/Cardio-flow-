// Overview triage (workflow redesign, slice 1): the open findings sorted into four lanes so the first
// screen answers "what do I do now" instead of listing every rule result.
//  - act:      red findings and orange safety / acute events (interactions, contraindications, bleeding,
//              potassium, congestion, bradycardia, new events that open a pathway)
//  - decide:   treatment and pathway decisions
//  - order:    labs, tests, checks and visits that are due — shown as one list with one "enter results" step
//  - consider: blue prevention suggestions, folded away
// Merges (display only; every finding stays in the record with its own "Why?"):
//  - findings that open the same pathway become one card;
//  - HF foundational therapy + uptitration become one "heart failure medicines" card; the
//    "optimise therapy first, then reassess for ICD/CRT" note is folded into it;
//  - combined-antithrombotic findings (plan, OAC + antiplatelet, PPI) become one card.
export type Lane = "act" | "decide" | "order" | "consider";
export type Finding = { id: string; rule_id: string; severity: "red" | "orange" | "yellow" | "blue"; title: string; detail: string; action?: any; [k: string]: any };
export type Card = { key: string; lane: Lane; severity: Finding["severity"]; title: string; lead: Finding; items: Finding[]; note?: string };

const SEV_RANK = { red: 0, orange: 1, yellow: 2, blue: 3 } as const;
const LANE_RANK: Record<Lane, number> = { act: 0, decide: 1, order: 2, consider: 3 };

// orange findings that are safety or acute events rather than treatment choices
const ACT_PREFIX = ["med.interaction", "med.contraindication", "safety.", "event.", "acute."];
const ACT_RULES = new Set(["hf.congestion", "hf.hyperkalaemia-review", "hf.symptomatic-hypotension", "rhythm.bradycardia", "dm.hf-unsafe-agent", "hf.readmission-30d", "valve.doac-contraindicated", "cad.potent-p2y12-with-oac", "rhythm.ecg-af-undiagnosed"]);
// plan templates that book a test, check or visit (not a referral or treatment decision)
const TEST_TEMPLATE = /^(mon-|ecg$|echo$|cmp-cmr$|cmp-echo$|valve-echo$|renal-k$|lipids$|device-check$|device-first-check$|wound-check$|remote-monitoring$|hcm-lvot$|genetic-test$|amyloid-typing$|dm-eyes$|dm-feet$|holter$)/;
const ORDER_RULES = new Set(["ops.plan-due", "dm.annual-checks", "ops.monitoring-after-change"]);

export function laneOf(f: Finding): Lane {
  if (f.severity === "red") return "act";
  if (f.severity === "orange" && (ACT_RULES.has(f.rule_id) || ACT_PREFIX.some((p) => f.rule_id.startsWith(p)))) return "act";
  const a = f.action ?? {};
  if (a.type === "add-labs" || ORDER_RULES.has(f.rule_id)) return "order";
  if (a.type === "add-plan" && TEST_TEMPLATE.test(a.template ?? "") && f.severity !== "blue") return "order";
  if (f.severity === "blue") return "consider";
  return "decide";
}

const BUNDLES: { key: string; title: (n: number) => string; rules: string[] }[] = [
  { key: "hf-meds", title: (n) => `Heart failure medicines: ${n} step${n === 1 ? "" : "s"}`, rules: ["hf.foundational-therapy", "hf.titration", "hf.improved-ef-continue"] },
  { key: "antithrombotic", title: () => "Antithrombotic therapy to review", rules: ["cad.antithrombotic-plan", "med.oac-antiplatelet", "cad.ppi-combined-antithrombotic"] },
];

const worst = (xs: Finding[]) => [...xs].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0];
const minLane = (ls: Lane[]) => ls.sort((a, b) => LANE_RANK[a] - LANE_RANK[b])[0];

export function triage(findings: Finding[]): Card[] {
  let rest = [...findings];
  const cards: Card[] = [];
  const hfOpen = rest.some((f) => f.rule_id === "hf.foundational-therapy" || f.rule_id === "hf.titration");
  let deviceNote: string | undefined;
  if (hfOpen) {
    const opt = rest.find((f) => f.rule_id === "hf.device-assessment" && f.severity === "blue");
    if (opt) {
      deviceNote = "Then reassess for ICD / CRT once therapy is optimised.";
      rest = rest.filter((f) => f !== opt);
    }
  }
  for (const b of BUNDLES) {
    const members = rest.filter((f) => b.rules.includes(f.rule_id) && laneOf(f) !== "act");
    const strong = members.filter((f) => f.rule_id !== "cad.ppi-combined-antithrombotic");
    if (members.length < 2 || !strong.length) continue;
    members.sort((x, y) => b.rules.indexOf(x.rule_id) - b.rules.indexOf(y.rule_id) || SEV_RANK[x.severity] - SEV_RANK[y.severity]);
    const lead = worst(members);
    cards.push({ key: b.key, lane: minLane(members.map((m) => (laneOf(m) === "consider" ? "decide" : laneOf(m)))), severity: lead.severity, title: b.title(members.length), lead, items: members, note: b.key === "hf-meds" ? deviceNote : undefined });
    rest = rest.filter((f) => !members.includes(f));
    if (b.key === "hf-meds") deviceNote = undefined;
  }
  // findings that open the same pathway: one card
  const byWizard = new Map<string, Finding[]>();
  for (const f of rest) if (f.action?.type === "wizard") byWizard.set(f.action.wizard, [...(byWizard.get(f.action.wizard) ?? []), f]);
  for (const [w, fs] of byWizard) {
    if (fs.length < 2) continue;
    const lead = worst(fs);
    cards.push({ key: "wiz-" + w, lane: minLane(fs.map(laneOf)), severity: lead.severity, title: lead.title, lead, items: fs });
    rest = rest.filter((f) => !fs.includes(f));
  }
  for (const f of rest) cards.push({ key: f.id, lane: laneOf(f), severity: f.severity, title: f.title, lead: f, items: [f] });
  if (deviceNote) {
    // no bundle formed (a single HF medicine finding): attach the note to it
    const c = cards.find((c) => c.items.some((f) => f.rule_id === "hf.foundational-therapy" || f.rule_id === "hf.titration"));
    if (c) c.note = deviceNote;
  }
  return cards.sort((a, b) => LANE_RANK[a.lane] - LANE_RANK[b.lane] || SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

// the module panel a finding belongs to (opens that panel by default on the overview)
export const PANEL_OF = (ruleId: string) =>
  ruleId.startsWith("hf.") ? "hf" : ruleId.startsWith("cad.") || ruleId.startsWith("lipids.") ? "cad" : ruleId.startsWith("rhythm.") ? "rhythm" : ruleId.startsWith("valve.") ? "valve" : ruleId.startsWith("cmp.") ? "cmp" : ruleId.startsWith("ph.") ? "ph" : null;
