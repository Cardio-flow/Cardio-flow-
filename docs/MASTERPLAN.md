# Recovered final build brief

Recovered on 16 September 2026 from the Cardio flow conversation **Final Codex Plan**, task `6a9d534d-e9dc-83ed-8e01-8a46c1ea0e0c`. This is the preserved handoff message, not a replacement for the two referenced attachment files. Those attachment files were not found in the local project mirror or Downloads/Documents/Desktop search. The brief supersedes the earlier CAD-first implementation blueprint for product scope.

The currently authorized hosted stack is React/TypeScript/Vite + Express/PostgreSQL/Neon + Vercel, established with the user in this task. Retain that working stack rather than reverting hosting during feature recovery.

---

**Share these two files with Codex, then paste the prompt below.** I updated the masterplan to **version 1.2** with our final agreed design.

1. [Original attachment reference; file not locally recovered] — architecture, final layout, build stages and acceptance requirements.
2. [Original attachment reference; file not locally recovered] — clinical pathways, labs, complications, OPD and customizable registries.

Also attach your previous HF, CAD and EP registry HTML files if available.

**Paste this into Codex:**

```text
Build CardioFlow using the two attached specifications.

Read both files completely before implementation:
- CardioFlow_Codex_Masterplan.md — internal version 1.2
- CardioFlow_Clinical_Blueprint_v1.md — internal version 1.1

Masterplan Section 4 defines the final accepted navigation and patient-workspace design. The clinical blueprint supplies the detailed clinical and registry requirements. Preserve its verification limits and approval states.

Act as the implementation engineer. Create and run working software, test it, and document progress.

PRODUCT FOUNDATION

Build one shared patient record with a continuous care plan across OPD visits, admissions, procedures and follow-up.

Main navigation:
Today | Admissions | OPD | Registries | Patients

Patient workspace:
Overview | Care plan | Journey | Results & medications |
Procedures | Registries & reports

The default patient screen must show the current clinical situation, outstanding decisions, pending investigations, next steps and responsible clinicians.

Essential behaviours:
- Patients can enter through OPD, admission or registry-only documentation.
- Multiple disease pathways can coexist across encounters.
- Discharge preserves unresolved decisions and monitoring obligations.
- Labs track collection, results, clinical review, action and reassessment.
- Complications track assessment, management, response and recovery.
- Clinicians select meaningful encounter connections and registry enrollments.
- Shared facts are reused with dates and provenance.
- Detailed procedure records work without registry enrollment.
- Finalized reports and registry assessments retain their history.
- HF, CAD, EP, structural and no-code custom registries belong to the complete release.

TECHNOLOGY AND BOUNDARIES

Follow the specified React/TypeScript/Vite, Supabase and Cloudflare architecture. Verify supported dependency versions during implementation.

Use synthetic patients and attachments only. Do not connect to HIS, legacy live databases or paid services.

Implement source-linked, versioned clinical guidance. Never invent medical thresholds, doses, timing rules or clinical approval. Keep unverified rules inactive; support clinician-entered plans in the synthetic prototype.

START BUILDING

Inspect the workspace, repository and applicable instructions. Use an existing appropriate repository or create a private cardioflow repository if authenticated access permits. Preserve unrelated work.

Complete milestones 0 and 1 first.

Demonstrate one synthetic patient:
OPD assessment with HF/AF/CKD history →
ACS admission →
ECG/labs and PCI documentation →
complication assessment, action and response →
discharge with an unresolved review obligation →
linked OPD reassessment →
deliberate CAD registry enrollment →
downloadable patient report.

Implement the shared foundations for every clinical family from the beginning. Continue the remaining milestones toward the complete release; do not present the first journey as the finished platform.

VALIDATION AND HANDOFF

Verify persistence after reload/re-login, organization isolation, care-only use, procedure access without enrollment, pending decisions surviving discharge, and report accuracy.

Inspect the actual interface at desktop and mobile sizes. Report only tests that actually ran.

Save the specifications in the repository, maintain AGENTS.md and docs/PROGRESS.md, and record completed work, blockers and the exact next step.

If external access is unavailable, continue useful local implementation and clearly identify which acceptance gates remain unverified.

At the first checkpoint provide:
1. What works.
2. How I can open and test it.
3. Test results.
4. Remaining limitations.
5. The next implementation step.

Make routine engineering decisions independently. Begin implementation now.
```

:[Original attachment reference; file not locally recovered]

Ahmed, time to review CardioFlow’s first build against our agreed masterplan v1.2.

Please share the Codex build preview or repository and its test summary—using synthetic patients and attachments only, with no real patient data.

Review checklist:

- Complete journey: patient creation → OPD/ACS episode → ECG upload → laboratory milestones and decisions → medication/procedure documentation → discharge → OPD follow-up → optional registry enrollment → downloadable PDF.
- Complications and unresolved decisions carry forward across discharge, with an owner and review date.
- Data persists after reload and re-login.
- Care-only and registry-only patients work; detailed procedures remain accessible without enrollment.
- Organization permissions prevent unauthorized cross-organization access.
- Unverified clinical rules remain inactive.
- HF, CAD, EP and structural heart share the architecture, with optional connected registries and a clear custom-registry implementation plan.

I haven’t inspected the build or verified any tests yet.
