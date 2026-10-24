# Decision-first audit — 24 October 2026

Compared the latest main (`701c8fb`) with the requested fast clinical decision flow. The initial implementation opened pathways on a decision, but silently assumed normal safety screens, omitted conditional requirements at server confirmation, used the Lokelma maintenance dose for an elevated result, and folded some substantive treatment/renal findings into routine checks.

## Changes and evidence

1. Overview → inline decision: specific current-to-proposed dose and frequency; one primary action for each pathway. Routine work stays at the bottom.
2. Full decision: recommendation first; rationale, alternatives and pending checklists collapsed. Essential clinical unknowns remain inline. No silent normal safety defaults.
3. Change result reliability: generated treatment changes are removed and a same-day repeat is proposed. ECG changes recompute urgent disposition.
4. Confirmation: overview, drawer and server use shared conditional requirements. Missing ECG/symptoms at K 6.0 cannot be bypassed by calling completion directly. Emergency escalation can proceed with renal investigations still outstanding.
5. Preventive work: retinal/foot screening, vaccination tasks and once-only Lp(a) are collapsed, including booked tasks; their controls remain accessible. Medication monitoring, stage discrepancies and clinically important abnormal results remain visible.

Synthetic-only browser evidence: `/workspace/cardioflow-decision-audit-artifacts/`, phone 390×844 and desktop 1440×1000; browser/API results in `results.json`. A sparse/recorded-context sweep exercises every registered pathway for rendering, conditional questions and assumptions. This is not proof of comprehensive clinical validity for every possible presentation.

## Primary sources inspected

- UK Kidney Association community recommendations 1.2.1–1.2.3 and hospital-assessment recommendations: https://guidelines.ukkidney.org/hyperkalaemia/6-summary-of-clinical-practice-guideline-for-hyperkalaemia/6-1-section-i-community/
- EMA Lokelma product information, section 4.2: correction 10 g three times daily, typically 24–48 hours; maintenance 5 g daily after normokalaemia. https://www.ema.europa.eu/en/documents/product-information/lokelma-epar-product-information_en.pdf
- EMA Veltassa product information, sections 4.2/4.4: adult start 8.4 g daily, titration at least one week apart, magnesium monitoring for at least one month. https://www.ema.europa.eu/en/documents/product-information/veltassa-epar-product-information_en.pdf
- Existing cited ESC HF practical guidance and Crestor SmPC renal-safety table retained. No acute insulin/calcium protocol or unsupported bespoke dosing was introduced.

## Limits

Lokelma's conditional correction course still needs an explicit prescription review; it is not silently converted into a long-term maintenance prescription. The software proposes changes for clinician confirmation. More specialist pathways appropriately require anatomy, procedural or diagnostic evidence before a definitive intervention choice; reducing clicks cannot replace those facts.

## Verification

- Production build passed.
- Full automated suite: 656 passed, 0 failed.
- Synthetic browser/API decision audit passed; overview lab/medication snapshots passed; pregnancy lifecycle and urgent follow-through walkthroughs passed.
