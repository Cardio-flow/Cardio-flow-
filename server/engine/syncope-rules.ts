import type { RuleDef } from "./rules.js";
import { syncopeProfile } from "./syncope-profile.js";
import { ageOn, fmtDay } from "../../shared/clinical.js";
export const SYNCOPE_RULES: RuleDef[] = [
  {
    id: "event.syncope",
    kind: "clinical",
    title: "Syncope / unexplained fall: assess risk and mechanism",
    inputs: [
      "contexts",
      "conditions",
      "studies",
      "meds",
      "sbp",
      "dbp",
      "hr",
      "lvef",
      "pathways",
    ],
    defaultParams: {},
    evidence:
      "ESC syncope 2018 (10.1093/eurheartj/ehy037): history, examination with standing BP and ECG, risk-based disposition and directed investigation; ESC pacing 2021 (10.1093/eurheartj/ehab364). NEJM review 2026 (10.1056/NEJMcp2517255).",
    evaluate(s) {
      const p = syncopeProfile(s);
      if (!p.contextId || ageOn(s.patient.birth_date, s.today) < 18) return [];
      if (s.procedureReviews?.syncope?.answers._syncopeKey === p.key) return [];
      return [
        {
          key: "syncope",
          signature: p.key,
          severity: p.urgent.length ? "red" : "orange",
          title: p.urgent.length
            ? "Syncope with concerning rhythm findings: urgent assessment"
            : "Syncope / unexplained fall: assessment needed",
          detail:
            "Review risk, ECG and standing BP; choose targeted tests and a dated follow-up plan.",
          facts: [
            {
              label: "Event",
              value: `Recorded clinical event · ${fmtDay(p.at!)}`,
            },
            ...p.urgent.map((x) => ({ label: "Rhythm concern", value: x })),
            ...(p.ecg
              ? [{ label: "ECG", value: p.ecg.summary, date: p.ecg.at }]
              : []),
            ...(p.standing
              ? [
                  {
                    label: "Standing BP report",
                    value: p.standing.result,
                    date: p.standing.at,
                  },
                ]
              : []),
          ],
          missing: [
            ...(!p.ecg ? ["12-lead ECG review"] : []),
            ...(!p.standing ? ["Supine / standing BP and symptoms"] : []),
            "Risk and event circumstances",
          ],
          action: { type: "wizard", wizard: "syncope" },
        },
      ];
    },
  },
];
