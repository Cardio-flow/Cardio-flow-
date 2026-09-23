import { randomUUID, createHash } from "node:crypto";
import type { DB } from "./db.js";
import { coronaryEvidence } from "../src/coronary-model.js";

type Candidate = {
  id: string;
  pack: "ACS" | "CCS" | "PCI_ANTIPLATELET" | "SECONDARY_PREVENTION";
  question: string;
  inputs: string[];
  exclusions: string[];
  output: string;
  source: string;
  boundary: string[];
};
export const coronaryCandidates: Candidate[] = [
  {
    id: "cad.acs-diagnosis",
    pack: "ACS",
    question: "Which ACS working diagnosis is supported?",
    inputs: ["symptoms", "ECG", "serial assay-specific troponin", "timing"],
    exclusions: ["insufficient evidence", "alternative diagnosis"],
    output: "Clinician diagnostic review",
    source: "esc-acs",
    boundary: ["STEMI", "NSTEMI", "unstable angina", "uncertain"],
  },
  {
    id: "cad.serial-troponin",
    pack: "ACS",
    question: "How should serial troponins be interpreted for this assay?",
    inputs: ["assay", "value", "unit", "assay URL", "collection times"],
    exclusions: ["unknown assay URL", "mixed assay units"],
    output: "Assay-specific review",
    source: "esc-acs",
    boundary: [
      "serial rise",
      "stable elevation",
      "unknown URL",
      "single sample",
    ],
  },
  {
    id: "cad.acs-risk",
    pack: "ACS",
    question: "Is a validated risk tool applicable and complete?",
    inputs: [
      "age",
      "HR",
      "BP",
      "creatinine",
      "HF",
      "ECG",
      "troponin",
      "arrest",
    ],
    exclusions: ["missing score inputs", "tool population mismatch"],
    output: "Transparent score with missing data",
    source: "esc-acs",
    boundary: [
      "complete GRACE",
      "missing input",
      "discordant clinical instability",
    ],
  },
  {
    id: "cad.invasive-timing",
    pack: "ACS",
    question: "What invasive assessment timing merits clinician review?",
    inputs: [
      "ACS category",
      "instability",
      "ischemia",
      "ECG",
      "troponin",
      "comorbidity",
    ],
    exclusions: ["unconfirmed category", "contraindication not reviewed"],
    output: "Timing review",
    source: "esc-acs",
    boundary: ["STEMI", "high-risk NSTE-ACS", "uncertain", "renal concern"],
  },
  {
    id: "cad.reperfusion",
    pack: "ACS",
    question: "Which reperfusion options require urgent assessment?",
    inputs: [
      "symptom onset",
      "first contact",
      "ECG",
      "diagnosis",
      "availability",
    ],
    exclusions: ["diagnosis unconfirmed", "missing timing"],
    output: "Urgent clinician pathway review",
    source: "esc-acs",
    boundary: ["early STEMI", "late presentation", "uncertain onset"],
  },
  {
    id: "cad.acs-complication",
    pack: "ACS",
    question: "Does a new ACS complication require urgent review?",
    inputs: [
      "symptoms",
      "ECG",
      "hemodynamics",
      "Echo",
      "Hb",
      "renal function",
      "PCI history",
    ],
    exclusions: ["finding entered in error"],
    output: "Clinician escalation review",
    source: "esc-acs",
    boundary: [
      "shock",
      "major bleed",
      "mechanical concern",
      "alternative cause",
    ],
  },
  {
    id: "cad.acs-discharge",
    pack: "ACS",
    question: "Which relevant discharge elements remain incomplete?",
    inputs: [
      "active ACS",
      "PCI",
      "LVEF",
      "medications",
      "renal",
      "rehab",
      "follow-up",
    ],
    exclusions: ["still actively unstable", "not applicable item"],
    output: "Discharge review gaps",
    source: "esc-acs",
    boundary: ["uncomplicated PCI", "HF", "bleeding", "staged PCI"],
  },
  {
    id: "cad.ccs-likelihood",
    pack: "CCS",
    question:
      "What current risk-factor weighted clinical likelihood is supported?",
    inputs: ["age", "sex", "symptoms", "risk factors", "prior testing"],
    exclusions: ["known obstructive CAD", "ACS presentation"],
    output: "Likelihood review with provenance",
    source: "esc-ccs",
    boundary: [
      "low likelihood",
      "higher likelihood",
      "missing risk factors",
      "previous CAD",
    ],
  },
  {
    id: "cad.ccs-test-selection",
    pack: "CCS",
    question: "Which diagnostic options fit this patient and prior testing?",
    inputs: [
      "likelihood",
      "symptoms",
      "CCTA",
      "functional imaging",
      "angiography",
      "test quality",
    ],
    exclusions: ["recent adequate test answers question"],
    output: "Testing options and missing data",
    source: "esc-ccs",
    boundary: [
      "recent CCTA",
      "no prior test",
      "poor-quality test",
      "no testing",
    ],
  },
  {
    id: "cad.ccs-antianginal",
    pack: "CCS",
    question: "What antianginal optimization merits review?",
    inputs: [
      "symptoms",
      "HR",
      "BP",
      "LVEF",
      "rhythm",
      "current medication",
      "tolerance",
    ],
    exclusions: ["no symptoms", "therapy already optimized"],
    output: "Medication review, no automatic prescription",
    source: "esc-ccs",
    boundary: ["low BP", "bradycardia", "HFrEF", "refractory symptoms"],
  },
  {
    id: "cad.ccs-revascularization",
    pack: "CCS",
    question: "When should anatomy and clinical factors reach a Heart Team?",
    inputs: [
      "anatomy",
      "ischemia",
      "LVEF",
      "diabetes",
      "surgical risk",
      "valve status",
      "preference",
    ],
    exclusions: ["insufficient anatomy", "no decision required"],
    output: "Options and missing factors",
    source: "esc-ccs",
    boundary: ["left main", "multivessel", "severe AS", "uncertain anatomy"],
  },
  {
    id: "cad.anoca-inoca",
    pack: "CCS",
    question: "Could persistent symptoms reflect ANOCA or INOCA?",
    inputs: [
      "angina",
      "ischemia testing",
      "nonobstructive anatomy",
      "functional testing",
    ],
    exclusions: ["obstructive culprit lesion", "alternative cause established"],
    output: "Mechanism assessment",
    source: "esc-ccs",
    boundary: [
      "ANOCA",
      "INOCA",
      "vasospasm",
      "microvascular",
      "unknown mechanism",
    ],
  },
  {
    id: "cad.dapt-review",
    pack: "PCI_ANTIPLATELET",
    question: "Does the antiplatelet plan fit ischemic and bleeding context?",
    inputs: [
      "ACS/CCS",
      "PCI date",
      "stent",
      "bleeding",
      "CKD",
      "age",
      "medications",
      "surgery",
    ],
    exclusions: [
      "active major bleed needs direct review",
      "unconfirmed medication record",
    ],
    output: "Dated clinician review",
    source: "esc-acs",
    boundary: ["ACS PCI", "CCS PCI", "bleeding", "surgery"],
  },
  {
    id: "cad.pci-anticoagulant",
    pack: "PCI_ANTIPLATELET",
    question:
      "Is combined antiplatelet and oral anticoagulant therapy coherent?",
    inputs: [
      "OAC indication",
      "aspirin",
      "P2Y12",
      "start/end",
      "bleeding",
      "PCI",
    ],
    exclusions: ["OAC indication unverified"],
    output: "Combined-therapy review",
    source: "esc-acs",
    boundary: ["AF plus PCI", "no OAC", "major bleed", "unknown dates"],
  },
  {
    id: "cad.bleeding-risk",
    pack: "PCI_ANTIPLATELET",
    question: "Which validated bleeding-risk assessment is applicable?",
    inputs: ["Hb", "renal", "age", "prior bleeding", "OAC", "procedure"],
    exclusions: ["missing criterion", "tool population mismatch"],
    output: "Transparent risk assessment",
    source: "esc-acs",
    boundary: ["ARC-HBR complete", "PRECISE-DAPT incomplete", "recent bleed"],
  },
  {
    id: "cad.p2y12-switch",
    pack: "PCI_ANTIPLATELET",
    question: "Does a P2Y12 switch require a documented strategy?",
    inputs: [
      "current agent",
      "reason",
      "ACS",
      "PCI",
      "bleeding",
      "interactions",
    ],
    exclusions: ["no switch planned"],
    output: "Clinician switching review",
    source: "esc-acs",
    boundary: ["intolerance", "bleeding", "surgery", "unknown prior dose"],
  },
  {
    id: "cad.staged-revascularization",
    pack: "PCI_ANTIPLATELET",
    question: "Does residual disease need staged revascularization review?",
    inputs: [
      "culprit PCI",
      "residual lesions",
      "HF",
      "diabetes",
      "valve",
      "patient preference",
    ],
    exclusions: [
      "no residual disease",
      "unstable context needs separate review",
    ],
    output: "Heart Team or staged plan review",
    source: "esc-acs",
    boundary: ["multivessel STEMI", "left main", "severe AS", "no residual"],
  },
  {
    id: "cad.stent-complication",
    pack: "PCI_ANTIPLATELET",
    question: "Do recurrent symptoms after PCI require urgent assessment?",
    inputs: [
      "PCI timing",
      "symptoms",
      "ECG",
      "troponin",
      "hemodynamics",
      "adherence",
    ],
    exclusions: ["no compatible symptoms", "data entered in error"],
    output: "Urgent clinician review, no autonomous diagnosis",
    source: "esc-acs",
    boundary: ["early concern", "late restenosis", "alternative diagnosis"],
  },
  {
    id: "cad.lipid-review",
    pack: "SECONDARY_PREVENTION",
    question: "Does lipid therapy need a reviewed intensification plan?",
    inputs: [
      "LDL",
      "unit",
      "baseline",
      "CAD/ACS",
      "medication",
      "tolerance",
      "adherence",
    ],
    exclusions: ["unknown unit", "unverified result"],
    output: "Clinician lipid review",
    source: "esc-eas-lipids",
    boundary: [
      "post-ACS",
      "unknown adherence",
      "statin intolerance",
      "unit mismatch",
    ],
  },
  {
    id: "cad.lpa",
    pack: "SECONDARY_PREVENTION",
    question: "How should Lp(a) be documented and used?",
    inputs: ["Lp(a) result", "unit", "risk context"],
    exclusions: ["unit missing", "unsupported conversion"],
    output: "Risk-context review",
    source: "esc-eas-lipids",
    boundary: ["mg/dL", "nmol/L", "no result", "avoid numeric conversion"],
  },
  {
    id: "cad.rehabilitation",
    pack: "SECONDARY_PREVENTION",
    question: "What rehabilitation referral and follow-up are needed?",
    inputs: [
      "ACS/PCI/CABG",
      "eligibility",
      "barriers",
      "referral",
      "planned start",
    ],
    exclusions: [
      "declined with documented reason",
      "not eligible with rationale",
    ],
    output: "Dated rehabilitation task",
    source: "esc-rehabilitation",
    boundary: ["post-PCI", "CABG", "barrier", "participating"],
  },
  {
    id: "cad.prevention-followup",
    pack: "SECONDARY_PREVENTION",
    question: "Which prevention gaps are actionable now?",
    inputs: [
      "lipids",
      "BP",
      "smoking",
      "diabetes",
      "CKD",
      "rehab",
      "medications",
    ],
    exclusions: ["already reviewed", "not applicable"],
    output: "Integrated dated prevention plan",
    source: "esc-ccs",
    boundary: ["multiple gaps", "stable patient", "post-ACS", "unknown dates"],
  },
];

export async function initializeCoronary(db: DB) {
  const verified = "2026-09-23";
  for (const source of coronaryEvidence) {
    await db.query(
      `INSERT INTO decision_support.evidence_source(key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,topic,source_kind,authoritative_url,last_verified_at,next_review_date,notes)
      VALUES($1,$2,$3,'ESC',$4,$5,$6,'approved','{}','system:stage5','coronary','guideline',$5,$6,'2027-09-23','Primary source metadata; no copyrighted guideline tables embedded') ON CONFLICT DO NOTHING`,
      [
        source.key,
        source.version,
        source.title,
        Number(source.version),
        source.url,
        verified,
      ],
    );
  }
  for (const candidate of coronaryCandidates) {
    const exists = (
      await db.query(
        "SELECT key FROM decision_support.rule_definition WHERE key=$1 AND version=1",
        [candidate.id],
      )
    ).rows[0];
    if (exists) continue;
    const source = coronaryEvidence.find((s) => s.key === candidate.source)!;
    const definition = {
      key: candidate.id,
      version: 1,
      status: "draft",
      topic: "coronary",
      priority: 3,
      trigger: {
        kind: "fact",
        conceptCode: "governance.stage5_licensed_tested_reviewed",
        operator: "equals",
        value: candidate.id,
      },
      output: {
        title: candidate.question,
        recommendation:
          "Candidate clinical logic is blocked pending independent review and publication.",
      },
      evidence: [{ key: source.key, version: source.version }],
      reviewContract: {
        question: candidate.question,
        inputs: candidate.inputs,
        exclusions: candidate.exclusions,
        proposedLogic:
          "To be independently authored from the cited source; no treatment threshold or duration is executable.",
        proposedOutput: candidate.output,
        plannedBoundaryTests: candidate.boundary,
        classLevel: "Not assigned until source review",
        publicationBlockers: [
          "Exact logic and exclusions",
          "Evidence permission if needed",
          "Passing clinical boundary tests",
          "Independent maker-checker approval",
        ],
      },
    };
    const serialized = JSON.stringify(definition);
    await db.query(
      `INSERT INTO decision_support.rule_definition(key,version,topic,status,priority,definition,checksum,created_by,site_id,title,clinical_domain,subdomain,rule_type,patient_population,required_data,exclusion_criteria,author,changelog,review_due_date,test_status,fixture)
      VALUES($1,1,'coronary','draft',3,$2,$3,'system:stage5',$4,$5,'coronary',$6,'diagnosis_support','{}',$7,$8,'system:stage5','Non-executable Stage 5 candidate','2027-09-23','not_run',false)`,
      [
        candidate.id,
        serialized,
        createHash("sha256").update(serialized).digest("hex"),
        "demo-kuwait",
        candidate.question,
        candidate.pack,
        JSON.stringify(candidate.inputs),
        JSON.stringify(candidate.exclusions),
      ],
    );
    await db.query(
      "INSERT INTO decision_support.rule_evidence(rule_key,rule_version,evidence_key,evidence_version,relationship,added_by) VALUES($1,1,$2,$3,'primary','system:stage5')",
      [candidate.id, source.key, source.version],
    );
    await db.query(
      "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,'demo-kuwait','DRAFT','Initial Stage 5 candidate','system:stage5')",
      [randomUUID(), candidate.id],
    );
    await db.query(
      "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,'demo-kuwait','CLINICAL_REVIEW','Awaiting independent clinical review and boundary tests','system:stage5')",
      [randomUUID(), candidate.id],
    );
  }
}
