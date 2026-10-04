// Synthetic patients only. Dates are relative to "today" so the demo always looks current.
import type { DB, Q } from "./db/db.js";
import { addDays } from "../shared/clinical.js";
import { today, type Actor } from "./kernel/base.js";
import * as K from "./kernel/clinical.js";
import { reassess } from "./engine/engine.js";
import { completeWizard } from "./engine/wizard.js";

const at = (day: string, time = "09:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
// "earlier today" that is never in the future and never yesterday
const earlierToday = (day: string, hoursAgo: number) => {
  const startOfDay = Date.parse(`${day}T00:01:00+03:00`);
  return new Date(Math.max(startOfDay, Date.now() - hoursAgo * 3600_000)).toISOString();
};

export async function seedSynthetic(db: DB, siteId: string) {
  const T = today();
  const d = (n: number) => addDays(T, n);
  const sys: Actor = { id: "system:synthetic-seed", name: "Synthetic seed", role: "admin", siteId };
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(431002)");
    if ((await tx.query(`SELECT 1 FROM cf.patient WHERE site_id=$1 LIMIT 1`, [siteId])).rows[0]) return;
    // ---- 1. The HF slice patient: admission → discharge → labs → rising K → clinic today ----
    const k = await K.createPatient(tx, sys, {
      name: "Khaled Al-Mansour", mrn: "100482317", sex: "Male", birthDate: addDays(T, -(65 * 365 + 120)), allergies: "No known drug allergies",
      conditions: ["hfref", "prior-pci", "ckd-3b", "t2dm", "htn"],
    });
    ids.push(k);
    const old = d(-400);
    const start = (code: string, dose: number | null, freq: string, day: string, reason = "", route = "PO", indication = "hf") =>
      K.startMedication(tx, sys, k, { code, doseValue: dose, frequency: freq, route, indication, reason, effectiveAt: at(day, "10:00") });
    const ramipril = await start("ramipril", 5, "OD", old, "", "PO", "hf");
    await start("bisoprolol", 2.5, "OD", old);
    await start("spironolactone", 25, "OD", old);
    const furosemide = await start("furosemide", 40, "OD", old);
    await start("aspirin", 100, "OD", old, "", "PO", "cad");
    await start("atorvastatin", 80, "Nightly", old, "", "PO", "cad");
    await K.recordObservations(tx, sys, k, { effectiveAt: at(d(-120)), items: [{ code: "creatinine", value: 141 }, { code: "potassium", value: 4.5 }, { code: "sodium", value: 138 }], silentEvent: true });
    await K.recordEcho(tx, sys, k, { date: at(d(-380)), quality: "formal", lvef: 35, findings: ["Mild secondary MR"] });

    const adm = await K.startAdmission(tx, sys, k, { startedAt: at(d(-14), "14:20"), location: "Ward 3B · Bed 7", reasons: ["Acute decompensated HF"] });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: at(d(-14), "15:00"), contextId: adm.id,
      items: [{ code: "creatinine", value: 158 }, { code: "potassium", value: 4.3 }, { code: "sodium", value: 134 }, { code: "nt-probnp", value: 4850 }, { code: "haemoglobin", value: 12.9 }],
    });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: at(d(-14), "14:40"), contextId: adm.id,
      items: [{ code: "weight", value: 84 }, { code: "sbp", value: 128 }, { code: "dbp", value: 76 }, { code: "hr", value: 94 }, { code: "nyha", text: "IV" }, { code: "congestion", text: "Moderate" }],
    });
    await K.medicationEvent(tx, sys, k, furosemide.medicationId, { kind: "increase", doseValue: 80, reason: "IV diuresis for congestion", effectiveAt: at(d(-14), "16:00"), contextId: adm.id });
    await K.recordEcho(tx, sys, k, { date: at(d(-13), "11:00"), quality: "formal", lvef: 30, findings: ["Dilated LV", "Moderate secondary MR"], contextId: adm.id });
    await K.medicationEvent(tx, sys, k, ramipril.medicationId, { kind: "stop", reason: "Switch to ARNI (36-hour washout)", effectiveAt: at(d(-13), "08:00"), contextId: adm.id });
    await start("dapagliflozin", 10, "OD", d(-12));
    await K.startMedication(tx, sys, k, { code: "sacubitril-valsartan", doseValue: 24, frequency: "BID", route: "PO", indication: "hf", reason: "Replaces ramipril", effectiveAt: at(d(-11), "10:00"), contextId: adm.id });
    await K.medicationEvent(tx, sys, k, furosemide.medicationId, { kind: "decrease", doseValue: 40, reason: "Euvolaemic", effectiveAt: at(d(-10), "09:00"), contextId: adm.id });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: at(d(-10), "07:30"), contextId: adm.id,
      items: [{ code: "creatinine", value: 150 }, { code: "potassium", value: 4.4 }, { code: "sodium", value: 137 }],
    });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: at(d(-10), "08:00"), contextId: adm.id,
      items: [{ code: "weight", value: 81 }, { code: "sbp", value: 114 }, { code: "dbp", value: 70 }, { code: "hr", value: 72 }, { code: "nyha", text: "II" }, { code: "congestion", text: "None" }],
    });
    await K.discharge(tx, sys, k, adm.id, {
      endedAt: at(d(-10), "13:00"),
      status: "Euvolaemic, NYHA II",
      plan: [
        { category: "monitoring", title: "Renal function and potassium check", dueDate: d(-4), completesOn: { type: "lab", codes: ["potassium", "creatinine"] } },
        { category: "monitoring", title: "Repeat potassium and creatinine", dueDate: d(0), completesOn: { type: "lab", codes: ["potassium", "creatinine"] } },
        { category: "referral", title: "Cardiac rehabilitation referral", dueDate: d(-4), completesOn: { type: "manual" } },
        { category: "follow_up", title: "HF clinic review", dueDate: d(0), completesOn: { type: "visit" } },
        { category: "medication", title: "Bisoprolol titration review", dueDate: d(11), completesOn: { type: "manual" } },
        { category: "investigation", title: "Repeat Echo", dueDate: d(90), completesOn: { type: "study", kind: "echo" } },
        { category: "follow_up", title: "ICD/CRT reassessment after repeat Echo", dueDate: d(95), completesOn: { type: "manual" } },
      ],
    });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: at(d(-4), "08:10"),
      items: [{ code: "creatinine", value: 162 }, { code: "potassium", value: 4.9 }, { code: "sodium", value: 137 }, { code: "nt-probnp", value: 2100 }],
    });
    await K.recordObservations(tx, sys, k, { effectiveAt: at(d(-4), "08:20"), items: [{ code: "weight", value: 78 }], silentEvent: true });
    await K.recordObservations(tx, sys, k, {
      effectiveAt: earlierToday(d(0), 0.25),
      items: [{ code: "creatinine", value: 186 }, { code: "potassium", value: 5.8 }, { code: "sodium", value: 136 }, { code: "urea", value: 11.2 }],
    });

    // ---- 2. Inpatient NSTEMI on CCU ----
    const f = await K.createPatient(tx, sys, { name: "Fatma Al-Ajmi", mrn: "100391054", sex: "Female", birthDate: addDays(T, -(72 * 365 + 40)), conditions: ["acs-nstemi", "af", "htn"] });
    ids.push(f);
    const fa = await K.startAdmission(tx, sys, f, { startedAt: at(d(-2), "03:10"), location: "CCU · Bed 4", reasons: ["NSTEMI"] });
    for (const [code, dose, freq, ind] of [["aspirin", 100, "OD", "cad"], ["ticagrelor", 90, "BID", "cad"], ["apixaban", 5, "BID", "af"], ["atorvastatin", 80, "Nightly", "cad"]] as const)
      await K.startMedication(tx, sys, f, { code, doseValue: dose, frequency: freq, route: "PO", indication: ind, effectiveAt: at(d(-2), "05:00"), contextId: fa.id });
    await K.recordObservations(tx, sys, f, { effectiveAt: at(d(-2), "03:40"), contextId: fa.id, items: [{ code: "hs-troponin", value: 412 }, { code: "creatinine", value: 88 }, { code: "potassium", value: 4.1 }, { code: "haemoglobin", value: 11.8 }] });
    await K.addPlanAction(tx, sys, f, { category: "procedure", title: "Coronary angiography", dueDate: d(1), completesOn: { type: "manual" }, contextId: fa.id });

    // ---- 3. HF clinic, titration due today ----
    const h = await K.createPatient(tx, sys, { name: "Hamad Al-Shammari", mrn: "100457208", sex: "Male", birthDate: addDays(T, -(58 * 365 + 200)), conditions: ["hfref", "htn"] });
    ids.push(h);
    for (const [code, dose, freq] of [["sacubitril-valsartan", 49, "BID"], ["bisoprolol", 2.5, "OD"], ["eplerenone", 25, "OD"], ["empagliflozin", 10, "OD"]] as const)
      await K.startMedication(tx, sys, h, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(d(-60)) });
    await K.recordEcho(tx, sys, h, { date: at(d(-70)), quality: "formal", lvef: 28, findings: ["Dilated LV"] });
    await K.recordObservations(tx, sys, h, { effectiveAt: at(d(-5)), items: [{ code: "creatinine", value: 96 }, { code: "potassium", value: 4.6 }, { code: "sodium", value: 139 }] });
    await K.recordObservations(tx, sys, h, { effectiveAt: at(d(-5)), items: [{ code: "sbp", value: 118 }, { code: "hr", value: 78 }, { code: "weight", value: 88 }], silentEvent: true });
    await K.addPlanAction(tx, sys, h, { category: "medication", title: "Beta-blocker titration review", dueDate: d(0), completesOn: { type: "visit" }, createdAt: at(d(-30)) });

    // ---- 4. Severe AS, valve clinic ----
    const mh = await K.createPatient(tx, sys, { name: "Mariam Hussain", mrn: "100266781", sex: "Female", birthDate: addDays(T, -(81 * 365 + 10)), conditions: ["as", "htn", "ckd-3a"] });
    ids.push(mh);
    await K.recordEcho(tx, sys, mh, { date: at(d(-6)), quality: "formal", lvef: 60, findings: ["Severe calcific AS", "AV Vmax 4.4 m/s", "Mean gradient 48 mmHg"] });
    await K.startMedication(tx, sys, mh, { code: "amlodipine", doseValue: 5, frequency: "OD", route: "PO", indication: "htn", effectiveAt: at(d(-300)) });
    await K.addPlanAction(tx, sys, mh, { category: "referral", title: "Heart Team discussion", dueDate: d(7), completesOn: { type: "manual" } });

    // ---- 5. Ward patient: MRA started without a K check booked ----
    const ae = await K.createPatient(tx, sys, { name: "Abdullah Al-Enezi", mrn: "100318842", sex: "Male", birthDate: addDays(T, -(67 * 365 + 90)), conditions: ["af", "hfmref", "htn"] });
    ids.push(ae);
    const aea = await K.startAdmission(tx, sys, ae, { startedAt: at(d(-4), "11:00"), location: "Ward 3B · Bed 12", reasons: ["AF with rapid ventricular rate"] });
    await K.startMedication(tx, sys, ae, { code: "warfarin", doseValue: 5, frequency: "OD", route: "PO", indication: "af", effectiveAt: at(d(-200)) });
    await K.startMedication(tx, sys, ae, { code: "bisoprolol", doseValue: 5, frequency: "OD", route: "PO", indication: "af", effectiveAt: at(d(-200)) });
    await K.recordObservations(tx, sys, ae, { effectiveAt: at(d(-4), "12:00"), contextId: aea.id, items: [{ code: "creatinine", value: 104 }, { code: "potassium", value: 4.2 }, { code: "inr", value: 1.6 }] });
    await K.startMedication(tx, sys, ae, { code: "spironolactone", doseValue: 25, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(d(-2), "10:00"), contextId: aea.id });

    // ---- 6. Post-PCI, rehab overdue ----
    const nk = await K.createPatient(tx, sys, { name: "Noura Al-Kandari", mrn: "100502663", sex: "Female", birthDate: addDays(T, -(54 * 365 + 150)), conditions: ["acs-stemi", "prior-pci", "dyslipidaemia"] });
    ids.push(nk);
    const nka = await K.startAdmission(tx, sys, nk, { startedAt: at(d(-33), "02:00"), location: "CCU · Bed 2", reasons: ["Anterior STEMI · primary PCI to LAD"] });
    for (const [code, dose, freq] of [["aspirin", 100, "OD"], ["ticagrelor", 90, "BID"], ["atorvastatin", 80, "Nightly"], ["bisoprolol", 2.5, "OD"]] as const)
      await K.startMedication(tx, sys, nk, { code, doseValue: dose, frequency: freq, route: "PO", indication: "cad", effectiveAt: at(d(-33), "06:00"), contextId: nka.id });
    await K.recordObservations(tx, sys, nk, { effectiveAt: at(d(-32)), contextId: nka.id, items: [{ code: "ldl-c", value: 3.4 }, { code: "creatinine", value: 70 }, { code: "potassium", value: 4.0 }] });
    await K.discharge(tx, sys, nk, nka.id, {
      endedAt: at(d(-30), "12:00"), status: "Stable, pain-free",
      plan: [
        { category: "referral", title: "Cardiac rehabilitation referral", dueDate: d(-3), completesOn: { type: "manual" } },
        { category: "monitoring", title: "Lipid profile", dueDate: d(12), completesOn: { type: "lab", codes: ["ldl-c"] } },
        { category: "follow_up", title: "Post-ACS clinic review", dueDate: d(12), completesOn: { type: "visit" } },
      ],
    });

    // ---- 7. EF improved: formal 30 → 42, plus a later limited bedside study ----
    const yi = await K.createPatient(tx, sys, { name: "Yousef Ibrahim", mrn: "100277190", sex: "Male", birthDate: addDays(T, -(62 * 365 + 300)), conditions: ["hfref", "t2dm"] });
    ids.push(yi);
    for (const [code, dose, freq] of [["sacubitril-valsartan", 97, "BID"], ["bisoprolol", 10, "OD"], ["spironolactone", 25, "OD"], ["dapagliflozin", 10, "OD"]] as const)
      await K.startMedication(tx, sys, yi, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(d(-200)) });
    await K.recordEcho(tx, sys, yi, { date: at(d(-190)), quality: "formal", lvef: 30, findings: ["Dilated LV"] });
    await K.addPlanAction(tx, sys, yi, { category: "follow_up", title: "ICD/CRT reassessment after repeat Echo", dueDate: d(9), completesOn: { type: "manual" }, createdAt: at(d(-190)) });
    await K.recordObservations(tx, sys, yi, { effectiveAt: at(d(-20)), items: [{ code: "creatinine", value: 101 }, { code: "potassium", value: 4.7 }] });
    await K.recordEcho(tx, sys, yi, { date: at(d(-5)), quality: "formal", lvef: 42, findings: ["LV size normalised"] });
    await K.recordEcho(tx, sys, yi, { date: at(d(-1), "16:00"), quality: "bedside", lvef: 35, findings: ["Limited windows"] });
  });
  await enrichSynthetic(db, siteId);
  for (const id of ids) await db.transaction((tx: Q) => reassess(tx, id, "sandbox"));
  return ids;
}

// Seed v2: the data the guideline rules need (height, lipids, HbA1c, UACR, iron) and a
// cardiometabolic patient. Idempotent and keyed by MRN, so it also upgrades a sandbox
// that was seeded by an earlier build. Returns true when it changed anything.
export const SEED_VERSION = 14;
export async function enrichSynthetic(db: DB, siteId: string, reassessAfter = true) {
  const T = today();
  const d = (n: number) => addDays(T, n);
  const sys: Actor = { id: "system:synthetic-seed", name: "Synthetic seed", role: "admin", siteId };
  const touched: string[] = [];
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(431002)");
    const site = (await tx.query<{ mode: string; settings: any }>(`SELECT mode, settings FROM cf.site WHERE id=$1`, [siteId])).rows[0];
    const settings = typeof site?.settings === "string" ? JSON.parse(site.settings) : site?.settings ?? {};
    const seeded = Number(settings.seedVersion ?? 1);
    if (!site || site.mode !== "sandbox" || seeded >= SEED_VERSION) return;
    const byMrn = async (mrn: string) => (await tx.query<{ id: string }>(`SELECT id FROM cf.patient WHERE site_id=$1 AND mrn=$2`, [siteId, mrn])).rows[0]?.id ?? null;
    const obs = async (id: string | null, day: string, items: { code: string; value: number }[], silentEvent = true) => {
      if (!id) return;
      await K.recordObservations(tx, sys, id, { effectiveAt: at(day, "08:30"), items, silentEvent });
      touched.push(id);
    };
    if (seeded < 2) {
    // Khaled: HFrEF + post-PCI + T2DM + CKD — LDL above goal on high-intensity statin, albuminuria, iron deficiency
    const k = await byMrn("100482317");
    await obs(k, d(-400), [{ code: "height", value: 172 }]);
    await obs(k, d(-60), [{ code: "hba1c", value: 7.6 }, { code: "uacr", value: 34 }, { code: "ldl-c", value: 2.1 }, { code: "total-cholesterol", value: 4.0 }, { code: "hdl-c", value: 0.9 }, { code: "triglycerides", value: 2.2 }]);
    await obs(k, d(-12), [{ code: "ferritin", value: 85 }, { code: "tsat", value: 16 }]);
    // Fatma: NSTEMI + AF on apixaban — LDL above goal, weight for DOAC dose check
    const f = await byMrn("100391054");
    await obs(f, d(-2), [{ code: "height", value: 156 }, { code: "weight", value: 58 }, { code: "sbp", value: 132 }, { code: "hr", value: 76 }]);
    await obs(f, d(-2), [{ code: "ldl-c", value: 3.1 }, { code: "hba1c", value: 5.6 }]);
    // Hamad: HFrEF below target doses, stable — uptitration opportunities
    const h = await byMrn("100457208");
    await obs(h, d(-60), [{ code: "height", value: 178 }]);
    // Mariam: severe AS, CKD 3a, BP above target
    const mh = await byMrn("100266781");
    await obs(mh, d(-6), [{ code: "creatinine", value: 95 }, { code: "potassium", value: 4.4 }, { code: "sbp", value: 148 }, { code: "dbp", value: 78 }, { code: "hr", value: 70 }, { code: "height", value: 158 }, { code: "weight", value: 66 }]);
    // Noura: post-STEMI, obesity without diabetes
    const nk = await byMrn("100502663");
    await obs(nk, d(-32), [{ code: "height", value: 160 }, { code: "weight", value: 84 }, { code: "sbp", value: 124 }, { code: "hr", value: 68 }, { code: "hba1c", value: 5.7 }]);
    // Yousef: T2DM + HFrEF on full therapy
    const yi = await byMrn("100277190");
    await obs(yi, d(-20), [{ code: "height", value: 176 }, { code: "weight", value: 86 }, { code: "sbp", value: 116 }, { code: "hr", value: 64 }]);
    // New: Salem — previous MI, T2DM, obesity, hypertension: the cardiometabolic picture
    if (!(await byMrn("100611478"))) {
      const sa = await K.createPatient(tx, sys, {
        name: "Salem Al-Rashidi", mrn: "100611478", sex: "Male", birthDate: addDays(T, -(59 * 365 + 45)), allergies: "No known drug allergies",
        conditions: ["prior-mi", "t2dm", "obesity", "htn"],
      });
      for (const [code, dose, freq, ind] of [["ramipril", 5, "OD", "htn"], ["rosuvastatin", 10, "OD", "cad"], ["aspirin", 100, "OD", "cad"], ["metformin", 1000, "BID", "dm"], ["bisoprolol", 5, "OD", "cad"]] as const)
        await K.startMedication(tx, sys, sa, { code, doseValue: dose, frequency: freq, route: "PO", indication: ind, effectiveAt: at(d(-500)) });
      await obs(sa, d(-9), [{ code: "height", value: 175 }, { code: "weight", value: 104 }, { code: "sbp", value: 146 }, { code: "dbp", value: 88 }, { code: "hr", value: 66 }]);
      await obs(sa, d(-9), [{ code: "ldl-c", value: 2.6 }, { code: "total-cholesterol", value: 4.6 }, { code: "triglycerides", value: 2.4 }, { code: "hba1c", value: 8.1 }, { code: "creatinine", value: 90 }, { code: "potassium", value: 4.4 }, { code: "uacr", value: 12 }], false);
      await K.addPlanAction(tx, sys, sa, { category: "follow_up", title: "Cardiometabolic clinic review", dueDate: d(2), completesOn: { type: "visit" } });
    }
    }
    // Seed v3: structured history (risk factors, past cardiac history with detail, identifiers)
    if (seeded < 3) {
      const cond = async (id: string, code: string) =>
        (await tx.query<{ logical_id: string }>(
          `SELECT logical_id FROM (SELECT DISTINCT ON (logical_id) logical_id, code, status FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC) c WHERE code=$2 AND status='active' LIMIT 1`,
          [id, code],
        )).rows[0]?.logical_id ?? null;
      const hx = async (mrn: string, input: { answers?: K.HistoryAnswer[]; add?: any[]; update?: [string, any][]; identity?: K.Identity }) => {
        const id = await byMrn(mrn);
        if (!id) return;
        const update = [];
        for (const [code, change] of input.update ?? []) {
          const logicalId = await cond(id, code);
          if (logicalId) update.push({ logicalId, ...change });
        }
        await K.recordHistory(tx, sys, id, { effectiveAt: at(d(-30), "10:00"), answers: input.answers ?? [], add: input.add ?? [], update });
        if (input.identity) await K.updateIdentity(tx, sys, id, input.identity);
        touched.push(id);
      };
      const no = (...items: string[]) => items.map((item) => ({ item, answer: "no" }));
      // Khaled: ex-smoker, NSTEMI 2018 treated with LAD PCI
      await hx("100482317", {
        answers: [{ item: "smoking", answer: "ex", packYears: 30, quitYear: 2018 }, { item: "fhx-cad", answer: "no" }, { item: "alcohol", answer: "never" }, ...no("valve", "rhythm", "device")],
        add: [{ code: "dyslipidaemia" }, { code: "prior-mi", onsetYear: 2018, attributes: { type: "NSTEMI" } }],
        update: [["prior-pci", { onsetYear: 2018, attributes: { vessels: ["LAD"] } }]],
        identity: { civilId: "260010100011", nationality: "Kuwaiti", mobile: "+965 5000 0011" },
      });
      // Fatma: never smoked, paroxysmal AF
      await hx("100391054", {
        answers: [{ item: "smoking", answer: "never" }, { item: "fhx-cad", answer: "unknown" }, ...no("diabetes", "valve")],
        update: [["af", { onsetYear: 2023, attributes: { pattern: "Paroxysmal" } }]],
        identity: { civilId: "254020100022", nationality: "Kuwaiti" },
      });
      // Hamad: current smoker
      await hx("100457208", {
        answers: [{ item: "smoking", answer: "current", packYears: 25 }, { item: "alcohol", answer: "never" }, { item: "dyslipidaemia", answer: "not-assessed" }, ...no("diabetes", "device")],
      });
      // Mariam: severe AS
      await hx("100266781", {
        answers: [{ item: "smoking", answer: "never" }, ...no("diabetes", "coronary")],
        update: [["as", { attributes: { severity: "Severe" } }]],
      });
      // Abdullah: mechanical mitral valve (rheumatic) — why he stays on warfarin, not a DOAC
      await hx("100318842", {
        answers: [{ item: "smoking", answer: "ex", packYears: 10, quitYear: 2009 }, ...no("diabetes")],
        add: [{ code: "prosthetic-valve", onsetYear: 2014, attributes: { position: "Mitral", type: "Mechanical" } }],
        update: [["af", { attributes: { pattern: "Permanent" } }]],
      });
      // Noura: anterior STEMI treated with LAD PCI, current smoker, family history
      await hx("100502663", {
        answers: [{ item: "smoking", answer: "current", packYears: 15 }, { item: "fhx-cad", answer: "yes" }, ...no("diabetes")],
        update: [["acs-stemi", { attributes: { territory: "Anterior" } }], ["prior-pci", { attributes: { vessels: ["LAD"] } }]],
      });
      // Yousef: primary-prevention ICD
      await hx("100277190", { answers: [{ item: "smoking", answer: "never" }], add: [{ code: "cied", onsetYear: 2024, attributes: { type: "ICD" } }] });
      // Salem: ex-smoker, STEMI 2021
      await hx("100611478", {
        answers: [{ item: "smoking", answer: "ex", packYears: 20, quitYear: 2021 }, { item: "fhx-cad", answer: "yes" }],
        update: [["prior-mi", { onsetYear: 2021, attributes: { type: "STEMI" } }]],
      });
      // New: Huda — mechanical aortic valve, started on apixaban elsewhere (the new safety rule)
      if (!(await byMrn("100733905"))) {
        const hu = await K.createPatient(tx, sys, {
          name: "Huda Al-Otaibi", mrn: "100733905", sex: "Female", birthDate: addDays(T, -(49 * 365 + 210)), allergies: "No known drug allergies",
          conditions: ["af", "htn"], civilId: "277030100033", nationality: "Kuwaiti",
        });
        await K.recordHistory(tx, sys, hu, {
          effectiveAt: at(d(-3), "10:00"),
          answers: [{ item: "smoking", answer: "never" }, { item: "diabetes", answer: "no" }],
          add: [{ code: "prosthetic-valve", onsetYear: 2016, attributes: { position: "Aortic", type: "Mechanical" } }],
        });
        await K.startMedication(tx, sys, hu, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", reason: "Started at another hospital", effectiveAt: at(d(-20)) });
        await K.startMedication(tx, sys, hu, { code: "bisoprolol", doseValue: 2.5, frequency: "OD", route: "PO", indication: "af", effectiveAt: at(d(-400)) });
        await obs(hu, d(-3), [{ code: "height", value: 162 }, { code: "weight", value: 71 }, { code: "sbp", value: 128 }, { code: "hr", value: 74 }]);
        await obs(hu, d(-3), [{ code: "creatinine", value: 70 }, { code: "haemoglobin", value: 12.6 }], false);
        await K.addPlanAction(tx, sys, hu, { category: "follow_up", title: "Anticoagulation review", dueDate: d(1), completesOn: { type: "visit" } });
      }
    }
    // Seed v4: investigations (ECG, cath) so the device, rhythm and problem-list rules have data
    if (seeded < 4) {
      const study = async (mrn: string, kind: string, day: string, findings: Record<string, unknown>, conclusion = "") => {
        const id = await byMrn(mrn);
        if (!id) return;
        await K.recordStudy(tx, sys, id, { kind, date: at(day, "10:30"), findings, conclusion });
        touched.push(id);
      };
      await study("100482317", "ecg", d(-12), { rhythm: "Sinus rhythm", rate: 68, pr: 196, qrs: 152, qrsMorphology: "LBBB", qtc: 468, st: ["Pathological Q waves"] });
      await study("100457208", "ecg", d(-60), { rhythm: "Sinus rhythm", rate: 84, pr: 170, qrs: 118, qrsMorphology: "Non-specific IVCD", qtc: 452 });
      await study("100318842", "ecg", d(-4), { rhythm: "Atrial fibrillation", rate: 112, qrs: 96, qrsMorphology: "Normal", qtc: 430 });
      await study("100391054", "ecg", d(-6), { rhythm: "Sinus rhythm", rate: 76, pr: 164, qrs: 92, qrsMorphology: "Normal", qtc: 446, st: ["ST depression"] });
      await study("100502663", "cath", d(-31), { access: "Radial", lm: "None", lad: "Occluded", lcx: "<50%", rca: "<50%", grafts: "No grafts", outcome: "PCI performed" }, "Primary PCI to proximal LAD");
      await study("100266781", "ecg", d(-6), { rhythm: "Sinus rhythm", rate: 70, pr: 232, qrs: 104, qrsMorphology: "Normal", avBlock: "First-degree", lvh: "Yes" });
    }
    // Seed v5: an early HF readmission (discharged still congested, no review in between)
    if (seeded < 5 && !(await byMrn("100845127"))) {
      const fm = await K.createPatient(tx, sys, {
        name: "Faisal Al-Mutairi", mrn: "100845127", sex: "Male", birthDate: addDays(T, -(71 * 365 + 20)), allergies: "No known drug allergies",
        conditions: ["hfref", "htn", "t2dm"], civilId: "255010100044", nationality: "Kuwaiti",
      });
      await K.recordEcho(tx, sys, fm, { date: at(d(-24)), quality: "formal", lvef: 30, findings: ["Dilated LV", "Moderate secondary MR"] });
      for (const [code, dose, freq] of [["bisoprolol", 2.5, "OD"], ["furosemide", 40, "BID"], ["dapagliflozin", 10, "OD"]] as const)
        await K.startMedication(tx, sys, fm, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(d(-300)) });
      const a1 = await K.startAdmission(tx, sys, fm, { startedAt: at(d(-25), "14:00"), location: "Ward 3A · Bed 4", reasons: ["Acute decompensated HF"], route: "Emergency department", symptoms: ["Dyspnoea", "Orthopnoea / PND", "Leg swelling"] });
      await K.recordObservations(tx, sys, fm, { effectiveAt: at(d(-25), "15:00"), contextId: a1.id, items: [{ code: "creatinine", value: 128 }, { code: "potassium", value: 4.6 }, { code: "sodium", value: 133 }, { code: "nt-probnp", value: 6200 }, { code: "weight", value: 88 }] });
      await K.discharge(tx, sys, fm, a1.id, { endedAt: at(d(-18), "12:00"), status: "Still congested", destination: "Home", events: ["IV diuretics", "Acute kidney injury"], dischargeWeight: 85.5, plan: [] });
      await K.startAdmission(tx, sys, fm, { startedAt: at(d(-2), "22:00"), location: "CCU · Bed 2", reasons: ["Acute decompensated HF"], route: "Emergency department", symptoms: ["Dyspnoea", "Leg swelling"] });
      await obs(fm, d(-1), [{ code: "creatinine", value: 141 }, { code: "potassium", value: 4.9 }, { code: "sodium", value: 131 }, { code: "weight", value: 90 }], false);
      touched.push(fm);
    }
    // Seed v6: data that opens the complication wizards
    if (seeded < 6) {
      // Hamad: weight up 2.6 kg in 3 days with oedema → congestion wizard
      const h6 = await byMrn("100457208");
      if (h6) {
        await K.recordObservations(tx, sys, h6, { effectiveAt: at(d(-3), "08:30"), items: [{ code: "weight", value: 79.4 }], silentEvent: true });
        await K.recordObservations(tx, sys, h6, { effectiveAt: at(d(0), "08:00"), items: [{ code: "weight", value: 82.0 }, { code: "congestion", text: "Moderate" }, { code: "sbp", value: 118 }, { code: "hr", value: 78 }], silentEvent: true });
        touched.push(h6);
      }
      // Yousef: slow heart rate on a beta-blocker → bradycardia wizard
      const y6 = await byMrn("100277190");
      if (y6) {
        await K.recordObservations(tx, sys, y6, { effectiveAt: at(d(-1), "10:00"), items: [{ code: "hr", value: 46 }, { code: "sbp", value: 104 }], silentEvent: true });
        touched.push(y6);
      }
    }
    // Seed v7: an acute/safety pathway to demonstrate (Fatma: haemoglobin fall on apixaban + DAPT)
    if (seeded < 7) {
      const f7 = await byMrn("100391054");
      if (f7) {
        await K.recordObservations(tx, sys, f7, { effectiveAt: at(d(-8), "07:30"), items: [{ code: "haemoglobin", value: 12.8 }], silentEvent: true });
        await K.recordObservations(tx, sys, f7, { effectiveAt: at(d(0), "06:30"), items: [{ code: "haemoglobin", value: 10.4 }, { code: "platelets", value: 210 }] });
        touched.push(f7);
      }
    }
    // Seed v8: type 2 diabetes with HFpEF and CKD on drugs to change (diabetes module)
    if (seeded < 8 && !(await byMrn("100913376"))) {
      const kr = await K.createPatient(tx, sys, {
        name: "Khalid Al-Rashidi", mrn: "100913376", sex: "Male", birthDate: addDays(T, -(69 * 365 + 75)), allergies: "No known drug allergies",
        conditions: ["hfpef", "htn", "ckd-3b"], civilId: "257030100081", nationality: "Kuwaiti",
      });
      await K.recordHistory(tx, sys, kr, { effectiveAt: at(d(-200)), add: [{ code: "t2dm", onsetYear: 2009, attributes: { complications: ["Retinopathy", "Kidney disease (albuminuria / low eGFR)"], severeHypo: "No", monitoring: "Finger-prick" } }] });
      await K.recordEcho(tx, sys, kr, { date: at(d(-60)), quality: "formal", lvef: 58, findings: ["LV hypertrophy", "Grade II diastolic dysfunction"] });
      for (const [code, dose, freq, ind] of [["metformin", 1000, "BID", "dm"], ["glibenclamide", 5, "BID", "dm"], ["pioglitazone", 30, "OD", "dm"], ["saxagliptin", 5, "OD", "dm"], ["losartan", 100, "OD", "htn"], ["furosemide", 40, "OD", "hf"]] as const)
        await K.startMedication(tx, sys, kr, { code, doseValue: dose, frequency: freq, route: "PO", indication: ind, effectiveAt: at(d(-400)) });
      await obs(kr, d(-120), [{ code: "hba1c", value: 7.9 }, { code: "creatinine", value: 132 }]);
      await obs(kr, d(-3), [{ code: "hba1c", value: 8.4 }, { code: "creatinine", value: 150 }, { code: "potassium", value: 4.6 }, { code: "uacr", value: 28 }, { code: "weight", value: 96 }, { code: "height", value: 172 }, { code: "sbp", value: 138 }, { code: "dbp", value: 80 }, { code: "hr", value: 74 }]);
      touched.push(kr);
    }
    // Seed v9: a medication exception (patient reports not taking spironolactone)
    if (seeded < 9) {
      const y9 = await byMrn("100277190");
      const spiro = y9 && ((await tx.query(`SELECT id FROM cf.medication WHERE patient_id=$1 AND drug='spironolactone'`, [y9])).rows[0] as any);
      if (y9 && spiro) {
        await K.medicationEvent(tx, sys, y9, spiro.id, { kind: "not_taking", reason: "Side effect", effectiveAt: at(d(-6)) });
        touched.push(y9);
      }
    }
    // Seed v10: HF profile — aetiology, an older LVEF, KCCQ-12, 6-minute walk and dry weight
    if (seeded < 10) {
      const aetiology = async (id: string | null, value: string[]) => {
        const c = id && ((await tx.query(`SELECT logical_id FROM cf.condition WHERE patient_id=$1 AND code IN ('hfref','hfpef','hfmref','hfimpef') AND status='active' ORDER BY recorded_at LIMIT 1`, [id])).rows[0] as any);
        if (c) await K.updateCondition(tx, sys, id!, c.logical_id, { attributes: { aetiology: value } });
      };
      const h10 = await byMrn("100457208");
      if (h10) {
        await aetiology(h10, ["Dilated (non-ischaemic)"]);
        await K.recordEcho(tx, sys, h10, { date: at(d(-420)), quality: "formal", lvef: 22, findings: ["Dilated LV", "Moderate secondary MR"] });
        await obs(h10, d(-70), [{ code: "kccq", value: 54 }, { code: "6mwd", value: 310 }]);
        await obs(h10, d(-5), [{ code: "kccq", value: 63 }, { code: "6mwd", value: 360 }, { code: "dry-weight", value: 80 }]);
      }
      await aetiology(await byMrn("100845127"), ["Ischaemic"]);
      const y10 = await byMrn("100277190");
      await aetiology(y10, ["Ischaemic"]);
      await obs(y10, d(-20), [{ code: "kccq", value: 71 }]);
    }
    // Seed v11: HF device decisions — Saad (ischaemic HFrEF on all four pillars for 6 months, LVEF 27%,
    // LBBB 158 ms, NYHA II, severe secondary MR) and Huda (LVEF recovered 30% → 56%, beta-blocker stopped)
    if (seeded < 11) {
      if (!(await byMrn("100733962"))) {
        const sd = await K.createPatient(tx, sys, { name: "Saad Al-Otaibi", mrn: "100733962", sex: "Male", birthDate: addDays(T, -(64 * 365 + 120)), allergies: "No known drug allergies", conditions: ["prior-mi", "htn"] });
        await K.recordHistory(tx, sys, sd, { effectiveAt: at(d(-200)), add: [{ code: "hfref", onsetYear: 2025, attributes: { aetiology: ["Ischaemic"] } }, { code: "mr-secondary", attributes: { severity: "Severe" } }] });
        for (const [code, dose, freq] of [["sacubitril-valsartan", 97, "BID"], ["bisoprolol", 5, "OD"], ["spironolactone", 25, "OD"], ["dapagliflozin", 10, "OD"], ["furosemide", 40, "OD"], ["aspirin", 100, "OD"], ["atorvastatin", 80, "OD"]] as const)
          await K.startMedication(tx, sys, sd, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(d(-180)) });
        await K.recordEcho(tx, sys, sd, { date: at(d(-210)), quality: "formal", lvef: 25, findings: ["Dilated LV", "Severe secondary MR"] });
        await K.recordEcho(tx, sys, sd, { date: at(d(-8)), quality: "formal", lvef: 27, findings: ["Dilated LV", "Severe secondary MR"] });
        await K.recordStudy(tx, sys, sd, { kind: "ecg", date: at(d(-8)), findings: { rhythm: "Sinus rhythm", rate: 68, qrs: 158, qrsMorphology: "LBBB" } });
        await obs(sd, d(-8), [{ code: "sbp", value: 108 }, { code: "hr", value: 66 }, { code: "weight", value: 79 }, { code: "creatinine", value: 104 }, { code: "potassium", value: 4.6 }, { code: "nt-probnp", value: 1850 }, { code: "ldl-c", value: 1.3 }, { code: "ferritin", value: 160 }, { code: "tsat", value: 24 }, { code: "uacr", value: 2 }]);
        await K.recordObservations(tx, sys, sd, { effectiveAt: at(d(-8), "09:00"), items: [{ code: "nyha", text: "II" }, { code: "congestion", text: "None" }, { code: "kccq", value: 66 }], silentEvent: true });
        touched.push(sd);
      }
      if (!(await byMrn("100728415"))) {
        const hu = await K.createPatient(tx, sys, { name: "Huda Al-Sabah", mrn: "100728415", sex: "Female", birthDate: addDays(T, -(47 * 365 + 60)), allergies: "No known drug allergies", conditions: [] });
        await K.recordHistory(tx, sys, hu, { effectiveAt: at(d(-400)), add: [{ code: "hfref", onsetYear: 2025, attributes: { aetiology: ["Tachycardia-induced"] } }] });
        for (const [code, dose, freq] of [["sacubitril-valsartan", 49, "BID"], ["bisoprolol", 5, "OD"], ["eplerenone", 25, "OD"], ["empagliflozin", 10, "OD"]] as const)
          await K.startMedication(tx, sys, hu, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(d(-380)) });
        await K.recordEcho(tx, sys, hu, { date: at(d(-390)), quality: "formal", lvef: 30, findings: ["Dilated LV"] });
        await K.recordEcho(tx, sys, hu, { date: at(d(-30)), quality: "formal", lvef: 56, findings: ["Normal LV size"] });
        const bb = (await tx.query(`SELECT id FROM cf.medication WHERE patient_id=$1 AND drug='bisoprolol'`, [hu])).rows[0] as any;
        await K.medicationEvent(tx, sys, hu, bb.id, { kind: "stop", reason: "LVEF normalised", effectiveAt: at(d(-14)) });
        await obs(hu, d(-14), [{ code: "sbp", value: 118 }, { code: "hr", value: 82 }, { code: "creatinine", value: 70 }, { code: "potassium", value: 4.3 }]);
        touched.push(hu);
      }
    }
    // Seed v12: complication episodes — Saad started an antibiotic for a chest infection (the pathway
    // is offered); Faisal (inpatient) developed a chest infection yesterday: an open episode, fever settling
    if (seeded < 12) {
      const sd = await byMrn("100733962");
      if (sd) {
        await K.startMedication(tx, sys, sd, { code: "amoxicillin", doseValue: 500, frequency: "TID", route: "PO", indication: "Chest infection (community-acquired)", effectiveAt: at(d(-1), "18:00") });
        await obs(sd, d(-1), [{ code: "crp", value: 96 }, { code: "temp", value: 37.9 }, { code: "rr", value: 18 }, { code: "spo2", value: 95 }]);
      }
      const fa = await byMrn("100845127");
      if (fa) {
        await K.startMedication(tx, sys, fa, { code: "amoxicillin-clavulanate", doseValue: 625, frequency: "TID", route: "PO", indication: "Chest infection (community-acquired)", effectiveAt: at(d(-1), "10:00") });
        await obs(fa, d(-1), [{ code: "crp", value: 142 }, { code: "temp", value: 38.6 }]);
        const adm = (await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND status='open'`, [fa])).rows[0] as any;
        await completeWizard(tx, sys, fa, "chest-infection", { contextId: adm?.id ?? null, answers: {
          setting: "cap", curb: ["65"], severity: "moderate", tests: ["cxr", "bloods", "cultures"], "cap-abx": "amox-mac",
          cardiac: ["none"], recheck: "3", after: ["review", "vaccines"], review: "clinic-7",
        } });
        // the episode began on the day the infection was treated
        await tx.query(`UPDATE cf.episode SET started_at=$2 WHERE patient_id=$1 AND wizard='chest-infection'`, [fa, at(d(-1), "11:00")]);
        await obs(fa, d(0), [{ code: "crp", value: 61 }, { code: "temp", value: 37.2 }]);
      }
    }
    // Seed v13: coronary procedures — Noura (primary PCI to LAD a month ago), Fatma (PCI to LCx yesterday
    // during her NSTEMI admission, on aspirin + ticagrelor + apixaban), Salem (elective PCI to RCA five
    // months ago on aspirin + clopidogrel), Saad (primary PCI to LAD about 7 months ago)
    if (seeded < 13) {
      const pci = async (mrn: string, day: string, details: Record<string, unknown>) => {
        const id = await byMrn(mrn);
        if (!id) return null;
        const has = (await tx.query(`SELECT 1 FROM cf.procedure WHERE patient_id=$1`, [id])).rows[0];
        if (!has) await K.recordProcedure(tx, sys, id, { kind: "pci", date: at(day, "11:00"), details });
        touched.push(id);
        return id;
      };
      await pci("100502663", d(-33), { setting: "stemi", vessels: ["LAD"], device: "Drug-eluting stent", stents: 1, access: "Radial" });
      await pci("100391054", d(-1), { setting: "nste-acs", vessels: ["LCx"], device: "Drug-eluting stent", stents: 1, access: "Radial" });
      const sa = await pci("100611478", d(-160), { setting: "elective", vessels: ["RCA"], device: "Drug-eluting stent", stents: 2, access: "Radial" });
      if (sa && !(await tx.query(`SELECT 1 FROM cf.medication WHERE patient_id=$1 AND drug='clopidogrel'`, [sa])).rows[0])
        await K.startMedication(tx, sys, sa, { code: "clopidogrel", doseValue: 75, frequency: "OD", route: "PO", indication: "cad", effectiveAt: at(d(-160), "14:00") });
      await pci("100733962", d(-200), { setting: "stemi", vessels: ["LAD"], device: "Drug-eluting stent", stents: 1, access: "Radial" });
    }
    // Seed v14: Salem (elective PCI to RCA five months ago) comes to clinic today with chest pain: the
    // recurrent chest pain pathway is offered
    if (seeded < 14) {
      const sa = await byMrn("100611478");
      if (sa && !(await tx.query(`SELECT 1 FROM cf.care_context WHERE patient_id=$1 AND status='open'`, [sa])).rows[0]) {
        await K.startVisit(tx, sys, sa, { reasons: ["Chest pain"], symptoms: ["Chest pain"], service: "Cardiology clinic", startedAt: new Date(Date.now() - 60_000).toISOString() } as any);
        touched.push(sa);
      }
    }
    await tx.query(`UPDATE cf.site SET settings = coalesce(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1`, [siteId, JSON.stringify({ seedVersion: SEED_VERSION })]);
  });
  if (reassessAfter) for (const id of new Set(touched)) await db.transaction((tx: Q) => reassess(tx, id, "sandbox"));
  return touched.length > 0;
}
