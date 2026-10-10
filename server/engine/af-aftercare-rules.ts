import { addCalendarMonths } from "../../shared/af.js";
import { addDays, localDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import type { Finding, RuleDef } from "./rules.js";
const LA_SOURCE =
  "2025 SCAI/HRS LAAO guideline, recommendations 5–8 (https://doi.org/10.1016/j.jscai.2025.103783): OAC or DAPT; postimplant TEE/CT; DRT favors OAC. 2023 SCAI/HRS consensus, recommendation 11 (https://doi.org/10.1016/j.jcin.2023.01.011): studied regimen/current device IFU and bleeding risk guide antithrombotics. SAPT, leak management, OAC duration and repeat-imaging timing are knowledge gaps.";
const closureOf = (s: PatientState) =>
  [...s.procedures]
    .reverse()
    .find(
      (p) =>
        p.kind === "laao" && p.attributes.result === "Implanted / completed",
    );
const imageOf = (s: PatientState, at: string) =>
  [...s.studies]
    .reverse()
    .find(
      (st) =>
        st.kind === "laa_imaging" &&
        st.attributes.purpose === "After closure" &&
        st.performed_at >= at,
    );
const finding = (
  key: string,
  signature: string,
  title: string,
  detail: string,
  wizard: string,
  severity: Finding["severity"] = "orange",
): Finding => ({
  key,
  signature,
  title,
  detail,
  severity,
  facts: [],
  missing: [],
  action: { type: "wizard", wizard },
});
export const AF_AFTERCARE_RULES: RuleDef[] = [
  {
    id: "rhythm.laao-aftercare",
    kind: "clinical",
    title: "LAA closure needs a device-specific care plan",
    inputs: ["procedures", "studies", "meds", "pathways", "plan"],
    defaultParams: {},
    evidence: LA_SOURCE,
    evaluate(s) {
      const cl = closureOf(s);
      if (!cl) return [];
      const im = imageOf(s, cl.performed_at),
        review = s.afReviews?.["after-laao"];
      const answered = review?.answers._procedureId === cl.id;
      const protocolMissing =
        answered &&
        (!review!.answers.protocol ||
          review!.answers.protocol === "unconfirmed");
      const drugs = s.meds.filter((m) => m.status === "active");
      const regimen = answered
        ? review!.answers.regimen
        : (
            {
              OAC: "oac",
              DAPT: "dapt",
              SAPT: "sapt",
              "No antithrombotic": "none",
            } as Record<string, string>
          )[cl.attributes.regimen];
      const oac = drugs.some((m) => m.tags.includes("oac")),
        ap = drugs.filter((m) => m.tags.includes("antiplatelet"));
      const mismatch =
        regimen === "oac"
          ? !oac
          : regimen === "dapt"
            ? !ap.some((m) => m.code === "aspirin") ||
              !ap.some((m) => m.tags.includes("p2y12"))
            : regimen === "sapt"
              ? ap.length !== 1 || oac
              : regimen === "none"
                ? oac || ap.length > 0
                : !regimen;
      const reviewDate = answered
        ? review!.answers.regimenAt
        : cl.attributes.reviewDate;
      const needsReview =
        reviewDate &&
        reviewDate <= s.today &&
        (!answered || localDay(review!.at) < reviewDate);
      const newImage =
        im && (!answered || review!.answers._imagingId !== im.id);
      const noScanPlan =
        !im &&
        !s.plan.some(
          (p) =>
            p.status === "planned" &&
            p.completes_on.kind === "laa_imaging" &&
            p.completes_on.purpose === "After closure" &&
            p.created_at >= cl.performed_at,
        );
      if (
        answered &&
        !protocolMissing &&
        !mismatch &&
        !needsReview &&
        !newImage &&
        !noScanPlan
      )
        return [];
      return [
        finding(
          "laao-care",
          `${cl.id}:${im?.id ?? "no-image"}:${regimen ?? "unknown"}:${drugs.map((m) => m.id).join(",")}:${reviewDate ?? ""}:${review?.at ?? ""}:${needsReview ? "due" : "not-due"}:${noScanPlan ? "no-plan" : "covered"}:${protocolMissing ? "protocol-missing" : String(review?.answers.protocol ?? "")}`,
          "LAA closure: review imaging and the antithrombotic plan",
          `${cl.attributes.device}, ${localDay(cl.performed_at)}. ${protocolMissing ? "The governing regional device protocol has not been confirmed. " : ""}${mismatch ? "The intended regimen is missing or differs from active medicines. " : ""}${newImage ? "New surveillance imaging needs a clinical decision. " : ""}${noScanPlan ? "No surveillance imaging or dated imaging plan recorded. " : ""}${needsReview ? "The regimen review is due. " : ""}Confirm the device protocol, bleeding risk and other anticoagulant indications; no automatic medication stop.`,
          "after-laao",
        ),
      ];
    },
  },
  {
    id: "rhythm.laao-thrombus",
    kind: "clinical",
    title: "LAAO device-related thrombus",
    inputs: ["procedures", "studies", "meds", "pathways"],
    defaultParams: {},
    evidence: LA_SOURCE,
    evaluate(s) {
      const cl = closureOf(s);
      if (!cl || cl.attributes.method !== "Transcatheter occlusion") return [];
      const im = imageOf(s, cl.performed_at);
      if (
        im?.attributes.deviceThrombus !== "Present" &&
        im?.attributes.laaThrombus !== "Present"
      )
        return [];
      return [
        finding(
          "drt",
          im.id,
          "Device / LA-LAA thrombus after LAA closure",
          "Prompt implant-team review. OAC is suggested rather than no OAC; assess bleeding, label dose, adherence and repeat TEE/CT. The duration and repeat-imaging date are individualized, not an automatic stop schedule.",
          "after-laao",
        ),
      ];
    },
  },
  {
    id: "rhythm.laao-uncertain",
    kind: "clinical",
    title: "LAAO leak or indeterminate surveillance",
    inputs: ["procedures", "studies", "pathways"],
    defaultParams: {},
    evidence: LA_SOURCE,
    evaluate(s) {
      const cl = closureOf(s);
      if (!cl) return [];
      const im = imageOf(s, cl.performed_at);
      if (
        !im ||
        !(
          im.attributes.leak === "Present" ||
          im.attributes.leak === "Indeterminate" ||
          im.attributes.deviceThrombus === "Indeterminate"
        )
      )
        return [];
      const r = s.afReviews?.["after-laao"];
      if (r?.answers._procedureId === cl.id && r.answers._imagingId === im.id)
        return [];
      return [
        finding(
          "leak",
          im.id,
          "LAA closure: leak / uncertain findings need specialist review",
          "Do not interpret this scan as clearance to stop treatment. The 2025 guideline has no universal OAC recommendation for peridevice leak; arrange individualized imaging and regimen review.",
          "after-laao",
        ),
      ];
    },
  },
  {
    id: "rhythm.ablation-followup",
    kind: "clinical",
    title: "AF ablation needs a dated recovery and follow-up plan",
    inputs: ["procedures", "pathways", "studies", "plan"],
    defaultParams: {},
    evidence:
      "2024 EHRA/HRS/APHRS/LAHRS ablation consensus, sections 9.3–9.6 (https://doi.org/10.1093/europace/euae043): OAC at least 2 months, 8-week blanking period, ECG/clinical review within 2–3 months then annual ECG review, additional monitoring for symptoms.",
    evaluate(s) {
      const ab = [...s.procedures]
        .reverse()
        .find(
          (p) =>
            p.kind === "ablation" &&
            (p.attributes.targets ?? []).some((t: string) => /^AF/.test(t)),
        );
      if (!ab) return [];
      const review = s.afReviews?.["after-af-ablation"],
        day = localDay(ab.performed_at);
      const ecg = latestStudy(s, "ecg"),
        due = addCalendarMonths(day, 3);
      const reviewed = review?.answers._procedureId === ab.id;
      const hasPlan = s.plan.some(
        (p) =>
          p.status === "planned" &&
          p.completes_on.kind === "ecg" &&
          p.created_at >= ab.performed_at,
      );
      const missingEcg =
        s.today >= due &&
        (!ecg || ecg.performed_at < ab.performed_at) &&
        !hasPlan;
      if (reviewed && !missingEcg) return [];
      return [
        finding(
          "ab-care",
          `${ab.id}:${missingEcg}:${review?.at ?? ""}`,
          "AF ablation: recovery, anticoagulation and ECG follow-up",
          `Ablation ${day}; 8-week blanking period ends ${addDays(day, 56)}. ${missingEcg ? "No post-ablation ECG or pending ECG plan at the 3-month follow-up limit. " : ""}Record the care plan; continue stroke prevention by risk, not procedural success.`,
          "after-af-ablation",
          "yellow",
        ),
      ];
    },
  },
];
