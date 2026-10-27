# Consultation priorities and integrated review

This change addresses the weak transition from individual rule outputs to a coherent consultation. The record remains the source of truth and the physician confirms every treatment change.

The summary API now projects urgent findings, explicit missing information, management problems, due work, results awaiting review and the next non-preventive checkpoint. Consult renders those states with direct access to the existing record and decision tools. Several HF dose alerts count as one management problem. Preventive screening stays secondary. Missing regimens prompt medication reconciliation.

HF/renal and AF/coronary relationships reference the actual recommendations. They do not infer a new diagnosis, invent a treatment sequence or mark another pathway complete. Each decision retains its own safety gates, evidence key, medication preview and confirmation. A preview explicitly states whether it is proposed, needs information, is blocked by a safety check, or requires a linked decision.

Clinical explanatory links now use the same selected-result resolver as treatment decisions. A later contradictory report no longer silently replaces a clinician-selected result in the linked rationale. A regression checks selected older anaemia against a later higher haemoglobin.

The follow-through summary separates evidence received from clinician review. Reviewed and cancelled tasks do not return as outstanding; prevention does not displace the next clinical checkpoint.

## Verification

Regression scenarios: mixed HF/CKD with potassium concern; AF/coronary antithrombotic coordination; result received but unreviewed; reviewed and cancelled work; preventive work with a red finding; unknown medication regimen; an empty chart; multiple HF titration alerts; selected versus latest haemoglobin.

The full repository suite passed **753 tests, zero failures**. The focused follow-through/Consult suite passed 33 tests; the final consultation projection suite passed seven scenarios. The production build passed. Browser checks passed at 320/390/1440 pixels for Consult and for AF ablation/LAAO, cardiorenal medication reconciliation and hypertension/RDN workflows. An initial AF check expected a renamed Today heading; retaining the original heading resolved that harness failure and the walkthrough passed on retry. No new medical thresholds, doses, migrations or modules.

## Limits and next clinical acceptance

This improves coordination and display using the existing clinical engines; it is not a claim of a fully validated autonomous cardiology assessment. A separate prospective clinic evaluation must measure time to a useful decision, repeated questions, dismissed alerts, missed actions and clinician disagreement across the three existing HF/cardiorenal, AF/coronary and hypertension workflows. Those real-use outcomes cannot be inferred from software tests alone.
