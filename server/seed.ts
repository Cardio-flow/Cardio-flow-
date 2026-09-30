// Synthetic patients only. Dates are relative to "today" so the demo always looks current.
import type { DB, Q } from "./db/db.js";
import { addDays } from "../shared/clinical.js";
import { today, type Actor } from "./kernel/base.js";
import * as K from "./kernel/clinical.js";
import { reassess } from "./engine/engine.js";

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
export const SEED_VERSION = 4;
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
    await tx.query(`UPDATE cf.site SET settings = coalesce(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1`, [siteId, JSON.stringify({ seedVersion: SEED_VERSION })]);
  });
  if (reassessAfter) for (const id of new Set(touched)) await db.transaction((tx: Q) => reassess(tx, id, "sandbox"));
  return touched.length > 0;
}
