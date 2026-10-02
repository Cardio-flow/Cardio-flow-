// Copy-ready documents built from confirmed data only (blueprint P1.11): a clinical summary for
// the hospital record or a referral, the medication list with recent changes, and the patient
// plan in English and Arabic. Nothing is invented: every line comes from the record, and the
// patient advice is fixed guideline-based education chosen by the patient's medicines.
import { hfProfile } from "../engine/hf-profile.js";
import type { Q } from "../db/db.js";
import { BARRIER_LABEL, MEASURES, MEDICATION, classLabel, doseLabel, formatNumber } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { attributesText } from "../../shared/history.js";
import { mechanicalInrTarget } from "../engine/acute-rules.js";
import { loadState, type MedState, type PatientState } from "./state.js";
import { planView, recommendations, whatChanged } from "./views.js";

export type Doc = { id: string; title: string; text: string; dir?: "rtl" };

const on = (s: PatientState, ...tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held" || m.status === "not_taking");
const brand = (code: string) => MEDICATION[code]?.brands?.[0];
const dose = (m: MedState) => (m.doseValue != null ? doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit) : "dose not recorded");

// medication changes since the last visit or discharge (else the last 90 days)
function recentChanges(s: PatientState) {
  const since = whatChanged(s).since ?? new Date(Date.parse(s.today) - 90 * 86400000).toISOString();
  const out: { med: MedState; kind: string; at: string; dose: number | null; reason: string }[] = [];
  for (const m of s.meds)
    for (const e of m.events)
      if (e.effective_at > since && ["start", "restart", "increase", "decrease", "hold", "stop", "not_taking", "resume"].includes(e.kind))
        out.push({ med: m, kind: e.kind, at: e.effective_at, dose: e.dose_value, reason: e.reason });
  return { since, items: out.sort((a, b) => a.at.localeCompare(b.at)) };
}
const notTakingReason = (m: MedState) => {
  const e = [...m.events].reverse().find((x) => x.kind === "not_taking");
  return e?.reason ? `: ${e.reason.toLowerCase()}` : "";
};
const latestChange = (s: PatientState, m: MedState, since: string) => [...m.events].reverse().find((e) => e.effective_at > since && e.kind !== "continue");

// ---------------------------------------------------------------- English clinical documents
function clinicalSummary(s: PatientState, attention: any[]): string {
  const L: string[] = [];
  L.push(`Cardiology summary — ${s.patient.name}, ${s.patient.age} y ${s.patient.sex.toLowerCase()}, MRN ${s.patient.mrn}${s.patient.civil_id ? `, Civil ID ${s.patient.civil_id}` : ""}`);
  L.push(`Prepared ${fmtDay(s.today, { year: true })} from CardioFlow (confirmed data only)`);
  L.push("");
  L.push("Diagnoses:");
  for (const c of s.conditions) {
    const detail = attributesText(c.code, c.attributes);
    L.push(`- ${c.display}${detail ? ` (${detail})` : ""}${c.attributes?.onsetYear ? `, since ${c.attributes.onsetYear}` : ""}`);
  }
  if (!s.conditions.length) L.push("- none recorded");
  L.push(`Allergies: ${s.patient.allergies || "not recorded"}`);
  const ef = s.resolved("lvef").current;
  const studies = [...s.studies].sort((a, b) => b.performed_at.localeCompare(a.performed_at)).slice(0, 3);
  if (ef || studies.length) {
    L.push("");
    L.push("Investigations:");
    if (ef) L.push(`- LVEF ${formatNumber(ef.value_num!, 0)}% (${ef.quality} Echo, ${fmtDay(ef.effective_at, { year: true })})`);
    for (const st of studies) L.push(`- ${st.kind.toUpperCase()} ${fmtDay(st.performed_at, { year: true })}: ${st.conclusion || st.findings.join(", ") || "recorded"}`);
  }
  const hf = hfProfile(s);
  if (hf) {
    L.push("");
    L.push("Heart failure:");
    L.push(`- ${hf.typeLabel}${hf.typeSince ? ` since ${fmtDay(hf.typeSince, { year: true })}` : ""}${hf.aetiology ? `; aetiology ${hf.aetiology}` : ""}`);
    if (hf.lvefCount > 1) L.push(`- LVEF history: ${hf.lvef.map((x) => `${formatNumber(x.value, 0)}% (${fmtDay(x.at, { year: true })})`).join(" → ")}`);
    const st = [
      hf.nyha.now ? `NYHA ${hf.nyha.now.value} (${fmtDay(hf.nyha.now.at)})` : null,
      hf.kccq.now ? `KCCQ-12 ${formatNumber(hf.kccq.now.value, 0)}/100 (${fmtDay(hf.kccq.now.at)})` : null,
      hf.walk.now ? `6MWD ${formatNumber(hf.walk.now.value, 0)} m (${fmtDay(hf.walk.now.at)})` : null,
      hf.weight.dry ? `dry weight ${formatNumber(hf.weight.dry.value, 1)} kg` : null,
    ].filter(Boolean);
    if (st.length) L.push(`- ${st.join("; ")}`);
    L.push(`- HF admissions in the last 12 months: ${hf.admissions.last12m}`);
  }
  const labs = ["sbp", "hr", "weight", "creatinine", "egfr", "potassium", "sodium", "haemoglobin", "nt-probnp", "hba1c", "ldl-c", "uacr", "inr"]
    .map((code) => {
      const o = s.resolved(code).current;
      return o && MEASURES[code] ? `${MEASURES[code].short} ${formatNumber(o.value_num!, MEASURES[code].decimals)}${MEASURES[code].unit ? " " + MEASURES[code].unit : ""} (${fmtDay(o.effective_at)})` : null;
    })
    .filter(Boolean);
  if (labs.length) {
    L.push("");
    L.push("Latest results: " + labs.join("; "));
  }
  L.push("");
  L.push("Current medications:");
  for (const m of live(s)) L.push(`- ${m.name}${brand(m.code) ? ` (${brand(m.code)})` : ""} ${dose(m)} ${m.frequency ?? ""}${m.status === "held" ? " — ON HOLD" : m.status === "not_taking" ? ` — NOT TAKING (patient report${notTakingReason(m)})` : ""}`.trimEnd());
  if (!live(s).length) L.push("- none");
  if (s.barriers.length) {
    L.push("");
    L.push("Not given (reason recorded):");
    for (const b of s.barriers) L.push(`- ${classLabel(b.drug_class)}: ${BARRIER_LABEL[b.category].toLowerCase()}${b.detail ? ` (${b.detail})` : ""}, ${fmtDay(b.effective_at, { year: true })}`);
  }
  const ch = recentChanges(s);
  if (ch.items.length) {
    L.push("");
    L.push(`Medication changes since ${fmtDay(ch.since, { year: true })}:`);
    for (const c of ch.items) L.push(`- ${fmtDay(c.at)}: ${c.med.name} ${c.kind}${c.dose != null ? " " + doseLabel(MEDICATION[c.med.code], c.dose, c.med.doseUnit) : ""}${c.reason ? ` (${c.reason})` : ""}`);
  }
  const open = attention.filter((a) => a.severity !== "blue");
  if (open.length) {
    L.push("");
    L.push("Open issues:");
    for (const a of open) L.push(`- ${a.title}`);
  }
  const plan = planView(s).filter((p) => p.status === "planned");
  if (plan.length) {
    L.push("");
    L.push("Plan:");
    for (const p of plan) L.push(`- ${p.title}${p.dueDate ? ` — ${fmtDay(p.dueDate, { weekday: true, year: true })}` : ""}${p.view === "overdue" ? " (OVERDUE)" : ""}`);
  }
  return L.join("\n");
}

function medicationList(s: PatientState): string {
  const L: string[] = [];
  const ch = recentChanges(s);
  L.push(`Medication list — ${s.patient.name}, MRN ${s.patient.mrn} · ${fmtDay(s.today, { year: true })}`);
  L.push(`Changes marked since ${fmtDay(ch.since, { year: true })}`);
  L.push("");
  const groups = new Map<string, MedState[]>();
  for (const m of live(s)) groups.set(m.purpose, [...(groups.get(m.purpose) ?? []), m]);
  for (const [purpose, meds] of groups) {
    L.push(purpose + ":");
    for (const m of meds) {
      const e = latestChange(s, m, ch.since);
      const tag = m.status === "held" ? "ON HOLD" : m.status === "not_taking" ? `NOT TAKING${notTakingReason(m)}` : e?.kind === "start" || e?.kind === "restart" ? "NEW" : e?.kind === "increase" ? "INCREASED" : e?.kind === "decrease" ? "REDUCED" : "";
      L.push(`- ${m.name}${brand(m.code) ? ` (${brand(m.code)})` : ""} ${dose(m)} ${m.frequency ?? ""}${m.route && m.route !== "PO" ? " " + m.route : ""}${tag ? `  [${tag}]` : ""}`.trimEnd());
    }
  }
  if (!groups.size) L.push("No current medications.");
  const stopped = s.meds.filter((m) => m.status === "stopped" && m.events.some((e) => e.kind === "stop" && e.effective_at > ch.since));
  if (stopped.length) {
    L.push("");
    L.push("Stopped:");
    for (const m of stopped) {
      const e = [...m.events].reverse().find((x) => x.kind === "stop");
      L.push(`- ${m.name}${e?.reason ? ` (${e.reason})` : ""} — ${fmtDay(e!.effective_at)}`);
    }
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- patient plan (EN + AR)
// Only patient-facing plan items: tests, visits, investigations, referrals, education.
const PATIENT_CATEGORIES = ["monitoring", "follow_up", "investigation", "referral", "education", "procedure"];

const AR_FREQ: Record<string, string> = {
  OD: "مرة واحدة يومياً", BID: "مرتين يومياً", TID: "ثلاث مرات يومياً", Nightly: "مرة واحدة ليلاً", Weekly: "مرة واحدة أسبوعياً",
  "Every 2 weeks": "مرة كل أسبوعين", "With meals": "مع الوجبات", "Single infusion": "جرعة واحدة بالوريد",
  "Day 0, 3 months, then every 6 months": "حقنة الآن، ثم بعد 3 أشهر، ثم كل 6 أشهر",
};
const EN_FREQ: Record<string, string> = {
  OD: "once a day", BID: "twice a day", TID: "three times a day", Nightly: "once at night", Weekly: "once a week",
  "Every 2 weeks": "every 2 weeks", "With meals": "with meals", "Single infusion": "single infusion",
};
const AR_ROUTE: Record<string, string> = { SC: "حقنة تحت الجلد", IV: "بالوريد" };
const AR_PURPOSE: Record<string, string> = {
  "Heart failure": "لعلاج ضعف عضلة القلب", "CAD / secondary prevention": "لحماية شرايين القلب", Anticoagulation: "لمنع الجلطات (سيولة الدم)",
  Rhythm: "لتنظيم ضربات القلب", "Blood pressure": "لضغط الدم", Cardiometabolic: "لحماية القلب والكلى", Diabetes: "للسكري", "Pulmonary hypertension": "لضغط الشريان الرئوي",
  Angina: "لآلام الذبحة الصدرية", Lipids: "للكوليسترول", Infection: "مضاد حيوي للالتهاب", "Anti-inflammatory": "مضاد للالتهاب", Supportive: "علاج مساعد",
};
const EN_PURPOSE: Record<string, string> = {
  "Heart failure": "for the heart muscle", "CAD / secondary prevention": "to protect the heart arteries", Anticoagulation: "to prevent clots (blood thinner)",
  Rhythm: "for the heart rhythm", "Blood pressure": "for blood pressure", Cardiometabolic: "to protect the heart and kidneys", Diabetes: "for diabetes", "Pulmonary hypertension": "for lung blood pressure",
  Angina: "for chest pain (angina)", Lipids: "for cholesterol", Infection: "antibiotic for the infection", "Anti-inflammatory": "against inflammation", Supportive: "supportive treatment",
};
const AR_LAB: Record<string, string> = {
  potassium: "البوتاسيوم", creatinine: "وظائف الكلى", egfr: "وظائف الكلى", sodium: "الصوديوم", magnesium: "المغنيسيوم", hba1c: "السكر التراكمي",
  glucose: "السكر", "ldl-c": "الكوليسترول", inr: "سيولة الدم (INR)", ferritin: "مخزون الحديد", tsat: "مخزون الحديد", haemoglobin: "الهيموجلوبين",
  uacr: "الزلال في البول", ketones: "الكيتونات", "digoxin-level": "مستوى الديجوكسين", "nt-probnp": "هرمون القلب (NT-proBNP)", lpa: "البروتين الدهني (أ)",
};
const EN_LAB: Record<string, string> = { creatinine: "kidney function", egfr: "kidney function", "ldl-c": "cholesterol", inr: "INR (blood thinning)", ferritin: "iron", tsat: "iron", uacr: "urine protein", "nt-probnp": "heart hormone (NT-proBNP)" };
const AR_STUDY: Record<string, string> = {
  echo: "إيكو (موجات صوتية) على القلب", ecg: "تخطيط القلب الكهربائي", holter: "جهاز هولتر لتسجيل نبض القلب", stress: "اختبار الجهد",
  cmr: "رنين مغناطيسي على القلب", ccta: "أشعة مقطعية على شرايين القلب", cath: "قسطرة القلب",
};
const EN_STUDY: Record<string, string> = { echo: "Echo (heart ultrasound)", ecg: "ECG", holter: "Holter (24-hour heart monitor)", stress: "Exercise stress test", cmr: "Heart MRI", ccta: "CT of the heart arteries", cath: "Cardiac catheterisation" };
// known template titles; anything else keeps its English title
const AR_TITLE: Record<string, string> = {
  "Phone follow-up": "مكالمة متابعة هاتفية", "Advanced HF centre consultation": "تحويل إلى مركز متخصص في فشل القلب المتقدم", "EP referral for ICD/CRT": "تحويل إلى عيادة كهرباء القلب لتقييم جهاز منظم/مزيل الرجفان", "Heart Team discussion (mitral TEER)": "مناقشة الحالة مع فريق القلب (إصلاح الصمام الميترالي بالقسطرة)", "Cardiac rehabilitation referral": "تحويل إلى برنامج التأهيل القلبي",
  "HF self-care education": "تثقيف عن العناية الذاتية لضعف القلب", "Diabetic retinal screening": "فحص قاع العين للسكري",
  "Diabetic foot examination": "فحص القدمين للسكري", "Endocrinology referral": "تحويل إلى عيادة الغدد الصماء",
  "Dietitian / diabetes educator": "موعد مع أخصائي التغذية / مثقف السكري", "Nephrology referral": "تحويل إلى عيادة الكلى",
  "Sick-day rules: which medicines to pause when unwell": "قواعد أيام المرض: الأدوية التي تُوقف مؤقتاً عند المرض",
  "Hypoglycaemia recognition and treatment education": "التعرف على هبوط السكر وعلاجه",
  "Daily weights, flexible diuretic, salt and fluid advice": "الوزن اليومي ونصائح الملح والسوائل",
};

const arDate = (d: string) =>
  new Intl.DateTimeFormat("ar-KW", { weekday: "long", day: "numeric", month: "long", year: "numeric", numberingSystem: "latn", timeZone: "Asia/Kuwait" }).format(new Date(`${d}T09:00:00+03:00`));

function planItem(p: ReturnType<typeof planView>[number], lang: "en" | "ar") {
  const c = p.completesOn as any;
  if (c?.type === "lab" && c.codes?.length) {
    const names = [...new Set((c.codes as string[]).map((x) => (lang === "ar" ? AR_LAB[x] : EN_LAB[x] ?? MEASURES[x]?.display.toLowerCase()) ?? x))];
    return lang === "ar" ? `تحليل دم: ${names.join("، ")}` : `Blood test: ${names.join(", ")}`;
  }
  if (c?.type === "visit") return lang === "ar" ? "موعد مراجعة في العيادة" : "Clinic appointment";
  if (c?.type === "study" && c.kind) return lang === "ar" ? AR_STUDY[c.kind] ?? p.title : EN_STUDY[c.kind] ?? p.title;
  if (lang === "en") return p.title;
  return AR_TITLE[p.title] ?? `${p.category === "referral" ? "تحويل" : p.category === "education" ? "تثقيف صحي" : "موعد"}: ${p.title}`;
}

function advice(s: PatientState, lang: "en" | "ar"): string[] {
  const out: string[] = [];
  const ar = lang === "ar";
  if (s.tags.has("hf"))
    out.push(ar
      ? "قِس وزنك كل صباح بعد دخول الحمام وقبل الإفطار. إذا زاد وزنك أكثر من 2 كجم خلال 3 أيام، أو زاد ضيق النفس أو تورم القدمين، اتصل بالعيادة."
      : "Weigh yourself every morning after the toilet and before breakfast. If your weight goes up by more than 2 kg in 3 days, or you are more breathless or your ankles swell, call the clinic.");
  const sick = on(s, "sglt2", "metformin", "sulfonylurea");
  if (sick.length)
    out.push(ar
      ? `إذا أصبت بقيء أو إسهال أو حمى ولم تستطع الأكل والشرب: أوقف مؤقتاً ${sick.map((m) => m.name).join("، ")} واتصل بالعيادة، وارجع إليها عندما تأكل وتشرب بشكل طبيعي.${on(s, "insulin-basal").length ? " لا توقف الأنسولين القاعدي." : ""}`
      : `If you have vomiting, diarrhoea or fever and cannot eat and drink: pause ${sick.map((m) => m.name).join(", ")} and call the clinic; restart when eating and drinking normally.${on(s, "insulin-basal").length ? " Do not stop your basal insulin." : ""}`);
  if (on(s, "sulfonylurea", "insulin").length)
    out.push(ar
      ? "إذا شعرت برعشة أو تعرق أو دوخة، افحص السكر. إذا كان أقل من 70 ملغ/دسل (3.9 ملمول/لتر) اشرب نصف كوب عصير أو تناول 3 ملاعق صغيرة من السكر، ثم أعد الفحص بعد 15 دقيقة."
      : "If you feel shaky, sweaty or dizzy, check your sugar. If it is below 70 mg/dL (3.9 mmol/L), take half a cup of juice or 3 teaspoons of sugar and check again after 15 minutes.");
  const oac = on(s, "oac");
  if (oac.length) {
    const warf = oac.some((m) => m.code === "warfarin");
    const t = warf ? (s.tags.has("mechanical-valve") ? mechanicalInrTarget(s) : { target: 2.5, low: 2, high: 3 }) : null;
    out.push(ar
      ? `أنت تتناول دواءً لمنع الجلطات (${oac.map((m) => m.name).join("، ")}). لا تتوقف عنه إلا بأمر الطبيب. راجع الطوارئ إذا لاحظت نزيفاً لا يتوقف، أو دماً في البول، أو برازاً أسود. لا تتناول مسكنات مثل البروفين دون استشارة.${t ? ` هدف تحليل السيولة (INR): ${formatNumber(t.low, 1)}–${formatNumber(t.high, 1)}.` : ""}`
      : `You take a blood thinner (${oac.map((m) => m.name).join(", ")}). Do not stop it unless your doctor tells you. Go to the emergency department for bleeding that does not stop, blood in the urine or black stools. Avoid painkillers such as ibuprofen unless advised.${t ? ` Your INR target: ${formatNumber(t.low, 1)}–${formatNumber(t.high, 1)}.` : ""}`);
  }
  if (s.meds.some((m) => m.status === "held"))
    out.push(ar ? "الأدوية المكتوب بجانبها «متوقف مؤقتاً»: لا تتناولها حتى يخبرك الطبيب." : "Medicines marked ON HOLD: do not take them until your doctor tells you to restart.");
  out.push(ar
    ? "عند ألم شديد في الصدر، أو ضيق شديد في التنفس، أو إغماء: اتصل بالإسعاف على 112 فوراً."
    : "For severe chest pain, severe breathlessness or fainting: call an ambulance on 112 straight away.");
  return out;
}

function patientPlan(s: PatientState, lang: "en" | "ar"): string {
  const ar = lang === "ar";
  const L: string[] = [];
  const ch = recentChanges(s);
  L.push(ar ? `خطة العلاج — ${s.patient.name}` : `Your treatment plan — ${s.patient.name}`);
  L.push(ar ? `التاريخ: ${arDate(s.today)}` : `Date: ${fmtDay(s.today, { weekday: true, year: true })}`);
  L.push("");
  L.push(ar ? "أدويتك:" : "Your medicines:");
  for (const m of live(s)) {
    const e = latestChange(s, m, ch.since);
    const name = `${m.name}${brand(m.code) ? ` (${brand(m.code)})` : ""}`;
    const freq = m.frequency ? (ar ? AR_FREQ[m.frequency] : EN_FREQ[m.frequency]) ?? m.frequency : "";
    const route = m.route && m.route !== "PO" ? (ar ? AR_ROUTE[m.route] : m.route === "SC" ? "injection under the skin" : m.route) : "";
    const purpose = ar ? AR_PURPOSE[m.purpose] : EN_PURPOSE[m.purpose];
    const tag = m.status === "held"
      ? (ar ? "متوقف مؤقتاً" : "ON HOLD")
      : m.status === "not_taking" ? (ar ? "لا تتناوله حالياً — ناقش ذلك مع طبيبك" : "you are not taking this — talk to your doctor")
      : e?.kind === "start" || e?.kind === "restart" ? (ar ? "دواء جديد" : "NEW")
      : e?.kind === "increase" ? (ar ? "تمت زيادة الجرعة" : "dose increased")
      : e?.kind === "decrease" ? (ar ? "تم تخفيض الجرعة" : "dose reduced") : "";
    L.push(`- ${name} ${dose(m)}${freq ? (ar ? "، " : ", ") + freq : ""}${route ? (ar ? "، " : ", ") + route : ""}${purpose ? ` — ${purpose}` : ""}${tag ? ` [${tag}]` : ""}`);
  }
  if (!live(s).length) L.push(ar ? "- لا توجد أدوية حالياً" : "- No current medicines");
  const stopped = s.meds.filter((m) => m.status === "stopped" && m.events.some((e) => e.kind === "stop" && e.effective_at > ch.since));
  if (stopped.length) {
    L.push("");
    L.push(ar ? "أدوية تم إيقافها (لا تتناولها):" : "Medicines stopped (do not take):");
    for (const m of stopped) L.push(`- ${m.name}${brand(m.code) ? ` (${brand(m.code)})` : ""}`);
  }
  const plan = planView(s).filter((p) => p.status === "planned" && PATIENT_CATEGORIES.includes(p.category) && p.dueDate);
  if (plan.length) {
    L.push("");
    L.push(ar ? "مواعيدك القادمة:" : "Your next steps:");
    for (const p of plan) L.push(`- ${planItem(p, lang)} — ${ar ? arDate(p.dueDate!) : fmtDay(p.dueDate!, { weekday: true, year: true })}${p.dueDate! < s.today ? (ar ? " (متأخر)" : " (overdue)") : ""}`);
  }
  L.push("");
  L.push(ar ? "نصائح مهمة:" : "Important:");
  for (const a of advice(s, lang)) L.push(`- ${a}`);
  return L.join("\n");
}

export async function documents(tx: Q, patientId: string): Promise<Doc[]> {
  const s = await loadState(tx, patientId);
  const attention = await recommendations(tx, patientId);
  return [
    { id: "summary", title: "Clinical summary", text: clinicalSummary(s, attention) },
    { id: "meds", title: "Medication list", text: medicationList(s) },
    { id: "plan-en", title: "Patient plan · English", text: patientPlan(s, "en") },
    { id: "plan-ar", title: "خطة المريض · عربي", text: patientPlan(s, "ar"), dir: "rtl" },
  ];
}

