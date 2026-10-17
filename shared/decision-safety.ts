import type { WizardContext } from "./wizards.js";
// Existing ESC potassium action threshold. A parallel renal plan must not contradict it.
export function potassiumFirst(wizard: string, ctx: WizardContext) {
  const k = ctx.values?.potassium?.value;
  return wizard === "renal-function" && k != null && k > 5.5
    ? `Potassium ${k} mmol/L: review hyperkalaemia before confirming a routine renal plan. Reassess after the potassium result and treatment review.` : null;
}
