import { randomUUID } from "node:crypto";
import { type DB, audit } from "./db.js";
import { today, addDays } from "./domain.js";

// Explicitly fictional walkthrough. No guideline logic or medication doses.
export async function seedCare(db: DB) {
  await db.transaction(async (tx) => {
    if (
      (await tx.query("SELECT id FROM core.patient WHERE mrn='SYN-CONTINUITY'"))
        .rows.length
    )
      return;
    const p = randomUUID(),
      opd = randomUUID(),
      admission = randomUUID(),
      review = randomUUID();
    const start = addDays(today(), -10),
      acute = addDays(today(), -7),
      discharge = addDays(today(), -3);
    await tx.query(
      "INSERT INTO core.patient(id,name,mrn,sex,birth_date,created_by) VALUES($1,'Hassan Sample','SYN-CONTINUITY','Male','1959-03-12','demo:continuity')",
      [p],
    );
    for (const [id, kind, day, reason, link, state, closed, summary] of [
      [
        opd,
        "OPD",
        start,
        "HF, AF and CKD assessment",
        null,
        "closed",
        start,
        "Shared problems recorded. Continuing review assigned to the cardiology team.",
      ],
      [
        admission,
        "Admission",
        acute,
        "ACS assessment and PCI documentation",
        opd,
        "closed",
        discharge,
        "Procedure documented. Renal monitoring and residual disease decisions remain assigned for OPD reassessment.",
      ],
      [
        review,
        "OPD",
        today(),
        "Post-discharge review and continuing plan",
        admission,
        "open",
        null,
        "",
      ],
    ])
      await tx.query(
        "INSERT INTO care.encounter(id,patient_id,kind,started_on,reason,owner,linked_encounter_id,state,closed_on,summary,created_by) VALUES($1,$2,$3,$4,$5,'Synthetic cardiology team',$6,$7,$8,$9,'demo:continuity')",
        [id, p, kind, day, reason, link, state, closed, summary],
      );
    const entries = [
      {
        kind: "problem",
        family: "HF",
        title: "Heart failure — continuing assessment",
        status: "active",
        day: start,
        enc: opd,
        due: null,
        assessment:
          "Fictional longitudinal HF history. Phenotype and dated imaging require clinician documentation.",
        action: "",
        response: "",
        details: {
          evidence:
            "Synthetic history only; no treatment eligibility inferred.",
        },
      },
      {
        kind: "problem",
        family: "EP",
        title: "Atrial fibrillation history",
        status: "active",
        day: start,
        enc: opd,
        due: null,
        assessment:
          "Include arrhythmia history in the shared treatment review.",
        action: "",
        response: "",
        details: {},
      },
      {
        kind: "problem",
        family: "Renal",
        title: "Chronic kidney disease history",
        status: "active",
        day: start,
        enc: opd,
        due: null,
        assessment:
          "Maintain dated renal results and the rationale for medication decisions.",
        action: "",
        response: "",
        details: {},
      },
      {
        kind: "procedure",
        family: "CAD",
        title: "LAD PCI — synthetic procedure record",
        status: "reviewed",
        day: acute,
        enc: admission,
        due: null,
        assessment: "Fictional LAD intervention during the ACS encounter.",
        action: "Procedure documented by the synthetic cath-lab team.",
        response:
          "Procedure outcome reviewed; residual coronary disease decision remains open.",
        details: {
          indication: "Clinician-recorded ACS",
          technique: "Radial approach",
          findings:
            "LAD treated. Residual RCA disease requires a documented strategy.",
          devices:
            "One synthetic drug-eluting stent; exact measurements not entered.",
          outcome:
            "Immediate outcome documented as satisfactory in this fictional case.",
        },
      },
      {
        kind: "complication",
        family: "Renal",
        title: "Renal deterioration — reassessment",
        status: "reassessing",
        day: addDays(acute, 1),
        enc: admission,
        due: today(),
        assessment:
          "Change in renal function documented during the fictional admission. Cause not inferred.",
        action:
          "Treating team requested reassessment and reconciliation of affected plans.",
        response: "Follow-up review remains outstanding after discharge.",
        details: {
          evidence: "Dated results require review",
          affected_plans:
            "Medication review and residual coronary disease strategy",
          recovery: "Document response before resolving the complication.",
        },
      },
      {
        kind: "investigation",
        family: "Renal",
        title: "Renal function and potassium review",
        status: "ordered",
        day: discharge,
        enc: admission,
        due: addDays(today(), -1),
        assessment:
          "Monitoring requested by the clinician in the discharge plan.",
        action: "Obtain and review the planned result.",
        response: "",
        details: { value: "", unit: "", interpretation: "" },
      },
      {
        kind: "decision",
        family: "CAD",
        title: "Residual coronary disease strategy",
        status: "pending",
        day: discharge,
        enc: admission,
        due: addDays(today(), 2),
        assessment:
          "Review anatomy, symptoms, renal assessment and patient preference.",
        action: "Clinician to document the chosen strategy and rationale.",
        response: "",
        details: {
          evidence: "Relevant procedural findings and interval assessment",
          barrier: "Awaiting clinical reassessment",
        },
      },
      {
        kind: "decision",
        family: "HF",
        title: "Reconcile continuing medication plan",
        status: "pending",
        day: discharge,
        enc: admission,
        due: today(),
        assessment:
          "Review indications, changes, deferrals and monitoring across HF, AF and renal disease.",
        action: "Document one clinician-selected plan at OPD review.",
        response: "",
        details: {
          evidence:
            "Current medications, dated investigations and patient-reported response",
          barrier: "",
        },
      },
    ];
    for (const e of entries) {
      const row = (
        await tx.query<any>(
          "INSERT INTO care.entry(id,patient_id,encounter_id,kind,family,title,status,occurred_on,owner,due_date,assessment,action,response,details,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic cardiology team',$9,$10,$11,$12,$13,'demo:continuity') RETURNING *",
          [
            randomUUID(),
            p,
            e.enc,
            e.kind,
            e.family,
            e.title,
            e.status,
            e.day,
            e.due,
            e.assessment,
            e.action,
            e.response,
            JSON.stringify(e.details),
          ],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO care.revision(id,entry_id,version,payload,actor) VALUES($1,$2,1,$3,'demo:continuity')",
        [randomUUID(), row.id, JSON.stringify(row)],
      );
    }
    await audit(
      tx,
      "demo:continuity",
      "Synthetic continuous-care walkthrough initialized",
      "patient",
      p,
      p,
      { synthetic: true, registryEnrollment: false },
    );
  });
}
