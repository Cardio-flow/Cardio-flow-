// Valve rules (valve module). Slice 1: a moderate or severe lesion graded on the latest echo that is
// not on the problem list, or is listed with a lower severity. Descriptive: the grade is the
// echocardiographer's; the valve rules read the problem list, so the lesion has to be listed.
import { DIAGNOSIS } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
import { latestValveEcho } from "./valve-profile.js";

const RANK: Record<string, number> = { None: 0, Mild: 1, Moderate: 2, Severe: 3, Unknown: 0 };
const NAME: Record<string, string> = { as: "aortic stenosis", ar: "aortic regurgitation", mr: "mitral regurgitation", ms: "mitral stenosis", tr: "tricuspid regurgitation" };

export const VALVE_RULES: RuleDef[] = [
  {
    id: "valve.echo-lesion-unlisted",
    kind: "clinical",
    title: "Valve lesion on echo not on the problem list",
    inputs: ["studies", "conditions"],
    defaultParams: { days: 365 },
    evidence: "A moderate or severe valve lesion reported on echo drives the valve rules (intervention triggers, surveillance, antithrombotic therapy) only once it is on the problem list with its severity.",
    evaluate(s: PatientState, p) {
      const e = latestValveEcho(s);
      if (!e || (Date.parse(s.today) - Date.parse(e.at)) / 86400000 > Number(p.days)) return [];
      const out: Finding[] = [];
      for (const [valve, grade] of Object.entries(e.valves)) {
        if (RANK[grade] < 2) continue;
        const codes = valve === "mr" ? (e.mrType === "Primary" ? ["mr-primary"] : e.mrType === "Secondary" ? ["mr-secondary"] : ["mr-primary", "mr-secondary"]) : [valve];
        const c = s.conditions.find((x) => codes.includes(x.code) && x.status === "active");
        if (c && RANK[c.attributes?.severity ?? "Unknown"] >= RANK[grade]) continue;
        // a prosthesis in that position: the native-lesion grade is not a new diagnosis
        const pos = valve === "as" || valve === "ar" ? "Aortic" : valve === "tr" ? "Tricuspid" : "Mitral";
        if (s.conditions.some((x) => x.code === "prosthetic-valve" && x.status === "active" && x.attributes?.position === pos)) continue;
        const name = `${grade} ${valve === "mr" && e.mrType ? `${e.mrType.toLowerCase()} ` : ""}${NAME[valve]}`;
        out.push({
          key: `echo-${valve}`, signature: `${e.id}:${valve}`, severity: grade === "Severe" ? "orange" : "yellow",
          title: c
            ? `Echo ${fmtDay(e.at)}: ${name.toLowerCase()} — listed as ${String(c.attributes?.severity ?? "severity not recorded").toLowerCase()}`
            : `Echo ${fmtDay(e.at)}: ${name.toLowerCase()} — not on the problem list`,
          detail: `Update the problem list (${DIAGNOSIS[codes[0]]?.display ?? NAME[valve]}, severity ${grade.toLowerCase()}) so the valve rules can follow it.`,
          facts: [{ label: "Echo", value: `${grade} ${valve.toUpperCase()}`, date: e.at }, { label: "Problem list", value: c ? `${c.display} · ${c.attributes?.severity ?? "severity not recorded"}` : "Not listed" }],
          missing: [], action: { type: "history", focus: "cardiac", label: "Update history" },
        });
      }
      return out;
    },
  },
];
