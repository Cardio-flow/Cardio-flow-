// General-medicine and procedure pathways for cardiology patients (Ahmed, 2 Oct 2026).
// Content only: the one wizard engine renders them; each chosen option writes dated plan items.
// CardioFlow never doses antibiotics or anaesthetic drugs: it names the guideline choice and the
// local policy sets the dose and duration.
//
// Sources:
//  - Pre-procedure: 2022 ESC Guidelines on cardiovascular assessment and management of patients
//    undergoing non-cardiac surgery (surgical risk <1% / 1–5% / >5%; functional capacity = climbing
//    two flights of stairs; hs-troponin before intermediate/high-risk surgery in CVD, risk factors or
//    age ≥65 and at 24 h and 48 h after (I B); BNP/NT-proBNP (IIa); TTE for poor functional capacity /
//    high NT-proBNP / murmur before high-risk surgery; continue beta-blockers, do not start routinely;
//    consider withholding ACEi/ARB on the day of surgery in non-HF hypertension; SGLT2i stopped ≥3 days
//    before intermediate/high-risk surgery; P2Y12 interruption clopidogrel 5, ticagrelor 3–5,
//    prasugrel 7 days; elective surgery delayed to 6 months after elective PCI and 12 months after
//    ACS; DOAC interruption by bleeding risk and renal function, no bridging) and the 2021 EHRA
//    practical guide on NOACs (factor Xa inhibitors 24 h low / 48 h high bleeding risk; dabigatran by
//    CrCl). VKA bridging only for high thrombotic risk (mechanical mitral valve, recent stroke).
//  - Chest infection: NICE NG138 (CAP, 2019) and NG139 (HAP, 2019) with BTS CAP; ATS/IDSA CAP 2019
//    (CURB-65 for site of care; 5-day course for CAP when improving; beta-lactam + macrolide for
//    moderate–severe CAP); macrolide / fluoroquinolone QT and CYP3A4 interactions with cardiac drugs.
import type { Option, WizardDef } from "./wizards.js";

const now = (title: string, completesOn: Record<string, unknown> = { type: "manual" }, category = "follow_up", days = 0) => ({ plan: [{ category, title, days, completesOn }] });
const RECHECK: Option[] = [
  { value: "1", label: "Tomorrow" },
  { value: "2", label: "In 2 days" },
  { value: "3", label: "In 3 days" },
  { value: "7", label: "In 1 week" },
];
const REVIEW: Option[] = [
  { value: "none", label: "No extra visit" },
  { value: "phone-3", label: "Phone call · 3 days" },
  { value: "clinic-7", label: "Clinic · 1 week" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
];

export const GENERAL_WIZARDS: Record<string, WizardDef> = {
  "pre-procedure": {
    id: "pre-procedure", title: "Pre-procedure assessment (non-cardiac surgery)", tone: "blue", group: "Procedures & general medicine",
    source: "ESC 2022 non-cardiac surgery · EHRA 2021 NOAC guide",
    note: "Emergency surgery is not delayed for cardiac testing. For elective surgery, treat active cardiac conditions first. Drug interruptions are dated from the procedure day; the anaesthetist and surgeon confirm.",
    facts: ["sbp", "hr", "haemoglobin", "creatinine", "egfr", "potassium", "nt-probnp", "inr"],
    steps: [
      {
        id: "procedure", title: "Procedure",
        questions: [
          {
            id: "urgency", label: "Urgency", type: "single", required: true,
            options: [
              { value: "emergency", label: "Emergency (proceed; no testing that delays surgery)" },
              { value: "time-sensitive", label: "Time-sensitive (days–weeks, e.g. cancer)" },
              { value: "elective", label: "Elective" },
            ],
          },
          {
            id: "risk", label: "Surgical risk (30-day CV death, MI, stroke)", type: "single", required: true,
            help: "Low: breast, dental, eye, thyroid, minor gynae/ortho/urology. Intermediate: intraperitoneal, carotid, peripheral angioplasty, head & neck, major ortho/neuro/urology, renal transplant. High: aortic and major vascular, open lower-limb revascularisation or amputation, pancreatic, liver, oesophageal, pneumonectomy, cystectomy.",
            options: [
              { value: "low", label: "Low (<1%)" },
              { value: "intermediate", label: "Intermediate (1–5%)" },
              { value: "high", label: "High (>5%)" },
            ],
          },
          {
            id: "bleeding", label: "Bleeding risk of the procedure", type: "single", required: true,
            options: [
              { value: "minimal", label: "Minimal (dental, cataract, superficial skin)" },
              { value: "low", label: "Low–moderate" },
              { value: "high", label: "High (major surgery, neuraxial anaesthesia, intracranial / spinal)" },
            ],
          },
        ],
      },
      {
        id: "cardiac", title: "Cardiac status",
        questions: [
          {
            id: "active", label: "Active cardiac conditions now", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "acs", label: "ACS / unstable angina", effects: now("Delay elective surgery: manage ACS first", { type: "manual" }) },
              { value: "hf", label: "Decompensated heart failure", effects: now("Delay elective surgery: treat decompensated HF first", { type: "manual" }) },
              { value: "arrhythmia", label: "Significant uncontrolled arrhythmia", effects: now("Delay elective surgery: control the arrhythmia first", { type: "manual" }) },
              { value: "valve", label: "Symptomatic severe valve disease", effects: now("Heart team review of the valve before elective surgery", { type: "manual" }, "referral") },
            ],
          },
          {
            id: "capacity", label: "Functional capacity", type: "single", required: true,
            options: [
              { value: "good", label: "Climbs two flights of stairs without stopping" },
              { value: "poor", label: "Cannot climb two flights / limited" },
              { value: "unknown", label: "Cannot be assessed" },
            ],
          },
          {
            id: "pci", label: "Recent coronary event or stent", type: "single", required: true,
            options: [
              { value: "none", label: "None in the last 12 months" },
              { value: "pci-1", label: "PCI within 1 month", effects: now("Postpone elective surgery: ≥6 months after elective PCI (time-sensitive surgery ≥1 month on DAPT)", { type: "manual" }) },
              { value: "pci-6", label: "Elective PCI 1–6 months ago", effects: now("Discuss timing: elective surgery ideally ≥6 months after elective PCI", { type: "manual" }) },
              { value: "acs-12", label: "ACS within 12 months", effects: now("Discuss timing: elective surgery ideally ≥12 months after ACS", { type: "manual" }) },
            ],
          },
        ],
      },
      {
        id: "tests", title: "Pre-operative tests",
        questions: [
          {
            id: "tests", label: "Tests to book", type: "multi", required: true,
            help: "hs-troponin is recommended before intermediate/high-risk surgery in patients with CVD, CV risk factors or age ≥65, and at 24 h and 48 h after (I B). BNP/NT-proBNP should be considered. Echo for poor functional capacity, high NT-proBNP or a murmur before high-risk surgery, or suspected new HF.",
            options: [
              { value: "none", label: "No further tests" },
              { value: "ecg", label: "12-lead ECG", effects: now("Pre-operative 12-lead ECG", { type: "study", kind: "ecg" }, "investigation") },
              { value: "troponin", label: "hs-troponin before, and at 24 h and 48 h after", effects: { plan: [
                { category: "monitoring", title: "hs-troponin before surgery (baseline)", days: 0, completesOn: { type: "lab", codes: ["hs-troponin"] } },
                { category: "monitoring", title: "hs-troponin 24 h and 48 h after surgery", days: 1, completesOn: { type: "manual" } },
              ] } },
              { value: "bnp", label: "NT-proBNP", effects: now("NT-proBNP before surgery", { type: "lab", codes: ["nt-probnp"] }, "monitoring") },
              { value: "labs", label: "Hb, renal function, K", effects: now("Pre-operative Hb, renal function and potassium", { type: "lab", codes: ["haemoglobin", "creatinine", "potassium"] }, "monitoring") },
              { value: "echo", label: "Echo", effects: now("Pre-operative Echo", { type: "study", kind: "echo" }, "investigation") },
              { value: "stress", label: "Stress imaging (high-risk surgery, poor capacity, likely CAD)", effects: now("Pre-operative stress imaging", { type: "study", kind: "stress" }, "investigation") },
            ],
          },
        ],
      },
      {
        id: "meds", title: "Medicines around the procedure",
        questions: [
          {
            id: "meds", label: "Plan for current medicines", type: "multi", required: true,
            options: [
              { value: "none", label: "No changes" },
              { value: "bb", label: "Continue the beta-blocker", requires: ["bb", "bb-other"] },
              { value: "statin", label: "Continue the statin", requires: ["statin"] },
              { value: "aspirin", label: "Continue aspirin (secondary prevention) if bleeding risk allows", requires: ["antiplatelet"] },
              { value: "raas", label: "Withhold ACEi/ARB on the day of surgery (no HF)", requires: ["raas"], effects: now("Withhold ACEi/ARB on the morning of surgery; restart when haemodynamically stable", { type: "manual" }, "medication") },
              { value: "sglt2", label: "Stop SGLT2 inhibitor ≥3 days before", requires: ["sglt2"], effects: now("Stop SGLT2 inhibitor at least 3 days before surgery; restart when eating and drinking", { type: "manual" }, "medication") },
              { value: "p2y12", label: "Interrupt P2Y12 inhibitor (clopidogrel 5 d, ticagrelor 3–5 d, prasugrel 7 d)", requires: ["p2y12"], effects: now("Interrupt P2Y12 inhibitor before surgery (clopidogrel 5 days, ticagrelor 3–5 days, prasugrel 7 days); restart plan agreed with cardiology", { type: "manual" }, "medication") },
              { value: "doac", label: "Interrupt DOAC by bleeding risk and renal function (no bridging)", requires: ["doac"], effects: now("Interrupt DOAC (Xa inhibitors: last dose 24 h before low-risk, 48 h before high-risk; dabigatran longer with reduced CrCl); no bridging; restart 24–72 h after per haemostasis", { type: "manual" }, "medication") },
              { value: "vka", label: "Stop warfarin 5 days before; INR the day before", requires: ["vka"], effects: { plan: [
                { category: "medication", title: "Stop warfarin 5 days before surgery (bridging only if high thrombotic risk, e.g. mechanical mitral valve)", days: 0, completesOn: { type: "manual" } },
                { category: "monitoring", title: "INR the day before surgery", days: 0, completesOn: { type: "lab", codes: ["inr"] } },
              ] } },
              { value: "metformin", label: "Hold metformin on the day of the procedure", requires: ["metformin"], effects: now("Hold metformin on the day of surgery / contrast; restart when eating and renal function stable", { type: "manual" }, "medication") },
              { value: "glp1", label: "Weekly GLP-1 RA: follow the anaesthesia fasting guidance", requires: ["glp1"], effects: now("Weekly GLP-1 RA before anaesthesia: follow the local anaesthesia guidance (aspiration risk)", { type: "manual" }, "medication") },
              { value: "insulin", label: "Insulin: peri-operative plan with the diabetes team", requires: ["insulin"], effects: now("Peri-operative insulin plan (diabetes / anaesthesia team)", { type: "manual" }, "referral") },
            ],
          },
        ],
      },
      {
        id: "plan", title: "Plan",
        questions: [
          {
            id: "conclusion", label: "Cardiology conclusion", type: "single", required: true,
            options: [
              { value: "proceed", label: "Proceed: no further cardiac testing needed", effects: now("Pre-operative cardiology letter: proceed", { type: "manual" }) },
              { value: "after-tests", label: "Proceed after the tests above", effects: now("Pre-operative cardiology letter after test results", { type: "manual" }) },
              { value: "delay", label: "Delay elective surgery until the cardiac issue is treated", effects: now("Re-assess fitness for surgery after cardiac treatment", { type: "visit" }) },
              { value: "heart-team", label: "Heart team / anaesthesia discussion", effects: now("Heart team / anaesthesia discussion before surgery", { type: "manual" }, "referral") },
            ],
          },
          { id: "review", label: "Cardiology review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },

  "chest-infection": {
    id: "chest-infection", title: "Chest infection (community or hospital-acquired)", tone: "orange", group: "Procedures & general medicine",
    source: "NICE NG138 / NG139 · BTS CAP · ATS/IDSA CAP 2019",
    note: "Severity decides the site of care. Pneumonia raises the risk of MI, AF and HF decompensation: look for them. Antibiotic doses and duration follow the local antimicrobial policy; CardioFlow records the choice and the plan. Check interactions with cardiac drugs.",
    facts: ["temp", "rr", "spo2", "sbp", "hr", "crp", "wbc", "urea", "creatinine"], trend: "temp",
    recheck: { title: "CRP, renal function and potassium", codes: ["crp", "creatinine", "potassium"] },
    steps: [
      {
        id: "setting", title: "Setting and severity",
        questions: [
          {
            id: "setting", label: "Where was it acquired?", type: "single", required: true,
            options: [
              { value: "cap", label: "Community-acquired (or within 48 h of admission)" },
              { value: "hap", label: "Hospital-acquired (≥48 h after admission)" },
              { value: "aspiration", label: "Aspiration suspected" },
            ],
          },
          {
            id: "curb", label: "CURB-65 features (community-acquired)", type: "multi", showIf: { question: "setting", includes: "cap" },
            help: "Confusion; urea >7 mmol/L; respiratory rate ≥30; SBP <90 or DBP ≤60; age ≥65. 0–1 low (home), 2 moderate (consider hospital), 3–5 high (hospital, consider ICU).",
            options: [
              { value: "c", label: "Confusion" }, { value: "u", label: "Urea >7 mmol/L" }, { value: "r", label: "RR ≥30/min" },
              { value: "b", label: "SBP <90 or DBP ≤60" }, { value: "65", label: "Age ≥65" },
            ],
          },
          {
            id: "severity", label: "Severity and site of care", type: "single", required: true,
            options: [
              { value: "low", label: "Low (CURB-65 0–1): treat at home" },
              { value: "moderate", label: "Moderate (CURB-65 2): consider hospital" },
              { value: "high", label: "High (CURB-65 3–5) or sepsis: hospital, consider ICU", effects: now("Senior review; consider ICU / outreach. Open the Sepsis pathway if signs of sepsis", { type: "visit" }) },
            ],
          },
        ],
      },
      {
        id: "tests", title: "Investigations",
        questions: [
          {
            id: "tests", label: "Tests", type: "multi", required: true,
            options: [
              { value: "cxr", label: "Chest X-ray", effects: now("Chest X-ray", { type: "manual" }, "investigation") },
              { value: "bloods", label: "FBC, CRP, urea and electrolytes", effects: now("FBC, CRP, renal function", { type: "lab", codes: ["wbc", "crp", "creatinine", "potassium"] }, "monitoring") },
              { value: "cultures", label: "Blood cultures (moderate–high severity) and sputum culture", effects: now("Blood cultures and sputum culture before antibiotics", { type: "manual" }, "investigation") },
              { value: "viral", label: "Influenza / COVID-19 / RSV PCR", effects: now("Respiratory virus PCR", { type: "manual" }, "investigation") },
              { value: "antigen", label: "Pneumococcal and Legionella urinary antigens (moderate–high)", effects: now("Urinary pneumococcal and Legionella antigens", { type: "manual" }, "investigation") },
              { value: "abg", label: "Blood gas if SpO₂ <92% or high severity", effects: now("Arterial blood gas", { type: "manual" }, "investigation") },
              { value: "cardiac", label: "ECG and troponin (chest pain, AF, HF, ischaemia)", effects: { plan: [
                { category: "investigation", title: "12-lead ECG", days: 0, completesOn: { type: "study", kind: "ecg" } },
                { category: "monitoring", title: "Troponin", days: 0, completesOn: { type: "lab", codes: ["hs-troponin"] } },
              ] } },
              { value: "bnp", label: "NT-proBNP (pneumonia vs HF uncertain)", effects: now("NT-proBNP", { type: "lab", codes: ["nt-probnp"] }, "monitoring") },
            ],
          },
        ],
      },
      {
        id: "antibiotics", title: "Antibiotic choice",
        questions: [
          {
            id: "cap-abx", label: "Community-acquired: guideline choice (dose and duration per local policy)", type: "single", showIf: { question: "setting", includes: "cap" },
            options: [
              { value: "amox", label: "Low severity: amoxicillin (doxycycline or clarithromycin if penicillin allergy)", effects: now("Antibiotic for CAP (low severity): amoxicillin — dose per local policy; 5 days if improving", { type: "manual" }, "medication") },
              { value: "amox-mac", label: "Moderate: amoxicillin + clarithromycin (or doxycycline)", effects: now("Antibiotic for CAP (moderate): amoxicillin + macrolide — per local policy; 5 days if improving", { type: "manual" }, "medication") },
              { value: "coamox-mac", label: "High: co-amoxiclav (or ceftriaxone) + clarithromycin", effects: now("Antibiotic for CAP (high severity): beta-lactam + macrolide IV — per local policy; review at 48 h", { type: "manual" }, "medication") },
              { value: "local", label: "Local policy / microbiology advice", effects: now("Antibiotic per local policy / microbiology advice", { type: "manual" }, "medication") },
            ],
          },
          {
            id: "hap-abx", label: "Hospital-acquired: guideline choice (dose and duration per local policy)", type: "single", showIf: { question: "setting", includes: "hap" },
            options: [
              { value: "nonsevere", label: "Non-severe, low resistance risk: co-amoxiclav (or doxycycline / co-trimoxazole if allergy)", effects: now("Antibiotic for HAP (non-severe): co-amoxiclav — per local policy; 5 days if improving", { type: "manual" }, "medication") },
              { value: "severe", label: "Severe or resistance risk: antipseudomonal (piperacillin/tazobactam or meropenem)", effects: now("Antibiotic for HAP (severe / resistance risk): antipseudomonal beta-lactam — per local policy and microbiology", { type: "manual" }, "medication") },
              { value: "mrsa", label: "Add MRSA cover (vancomycin or linezolid) if MRSA risk", effects: now("Add MRSA cover (vancomycin with levels, or linezolid) — per microbiology", { type: "manual" }, "medication") },
              { value: "local", label: "Local policy / microbiology advice", effects: now("Antibiotic per local policy / microbiology advice", { type: "manual" }, "medication") },
            ],
          },
          {
            id: "asp-abx", label: "Aspiration: guideline choice", type: "single", showIf: { question: "setting", includes: "aspiration" },
            options: [
              { value: "asp", label: "Treat as CAP/HAP by setting; add anaerobic cover only for abscess or empyema", effects: now("Aspiration pneumonia: antibiotic per setting and local policy; swallow assessment", { type: "manual" }, "medication") },
            ],
          },
        ],
      },
      {
        id: "cardiac", title: "Cardiac medicines and interactions",
        questions: [
          {
            id: "cardiac", label: "Actions", type: "multi", required: true,
            options: [
              { value: "none", label: "No changes" },
              { value: "qt", label: "Macrolide / quinolone with a QT-prolonging drug: ECG for QTc", requires: ["qt"], effects: now("QTc on ECG before and during macrolide / fluoroquinolone (QT-prolonging drug co-prescribed)", { type: "study", kind: "ecg" }, "investigation") },
              { value: "statin", label: "Clarithromycin: pause simvastatin / review atorvastatin dose", requires: ["statin"], effects: now("Clarithromycin course: pause simvastatin, review atorvastatin dose (CYP3A4)", { type: "manual" }, "medication") },
              { value: "doac", label: "Clarithromycin with a DOAC or ticagrelor: prefer an alternative (bleeding risk)", requires: ["doac", "p2y12"], effects: now("Avoid clarithromycin with DOAC / ticagrelor where possible (CYP3A4 / P-gp): choose doxycycline or per microbiology", { type: "manual" }, "medication") },
              { value: "warfarin", label: "Warfarin: INR in 3–5 days on antibiotics", requires: ["vka"], effects: now("INR check on antibiotics", { type: "lab", codes: ["inr"] }, "monitoring", 3) },
              { value: "sickday", label: "Dehydrated or hypotensive: sick-day holds (SGLT2i, metformin, diuretic, RAAS/MRA)", effects: { hold: ["sglt2", "metformin", "loop", "thiazide", "raas", "mra"] } },
              { value: "hf", label: "Fluid-overloaded: review diuretic; avoid large fluid boluses", requires: ["loop"], effects: now("Daily weight and fluid balance; review diuretic dose", { type: "manual" }, "monitoring") },
            ],
          },
        ],
      },
      {
        id: "monitoring", title: "Monitoring and follow-up",
        questions: [
          { id: "recheck", label: "Repeat CRP, renal function and K", type: "single", options: RECHECK, required: true },
          {
            id: "after", label: "After the infection", type: "multi",
            options: [
              { value: "review", label: "Review at 48–72 h if not improving", effects: now("Review at 48–72 h: response to antibiotics", { type: "visit" }, "follow_up", 3) },
              { value: "cxr6", label: "Repeat chest X-ray at 6 weeks (persistent symptoms or malignancy risk)", effects: now("Repeat chest X-ray at 6 weeks", { type: "manual" }, "investigation", 42) },
              { value: "restart", label: "Restart held cardiac medicines when eating, drinking and stable", effects: now("Restart held cardiac medicines when eating, drinking and haemodynamically stable", { type: "manual" }, "medication", 2) },
              { value: "vaccines", label: "Influenza, pneumococcal and COVID-19 vaccination when recovered", effects: now("Influenza, pneumococcal and COVID-19 vaccination", { type: "manual" }, "education", 28) },
            ],
          },
          { id: "review", label: "Cardiology review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};
