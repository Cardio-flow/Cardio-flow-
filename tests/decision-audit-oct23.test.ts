import { test } from "node:test";
import assert from "node:assert/strict";
import { WIZARDS, buildOutcome, type WizardContext } from "../shared/wizards.js";
import { prefill, updateDecisionAnswers } from "../shared/wizard-prefill.js";
import { decisionView } from "../shared/decision-first.js";
import { decisionQuestions, decisionDataNeeded } from "../shared/decision-requirements.js";
import { decisionBlocker } from "../shared/decision-validation.js";
import { START, statinUp } from "../shared/start-doses.js";
import { isRoutine, isRoutinePlan } from "../shared/routine.js";

const context = (k=5.8): WizardContext => ({today:"2026-10-23",facts:[],detected:{},dx:["hfref","hf"],profile:{age:72,sex:"Female",cvd:true,riskFactors:true},values:{potassium:{value:k,at:"2026-10-23",prev:4.8},creatinine:{value:120,at:"2026-10-23",prev:100},egfr:{value:40,at:"2026-10-23",prev:50}},meds:[{id:"mra",name:"Spironolactone",code:"spironolactone",status:"active",doseValue:25,doseUnit:"mg",frequency:"OD",tags:["mra"]}]});

test("every pathway renders a decision from sparse and recorded contexts without inventing a normal safety screen",()=>{
  for(const id of Object.keys(WIZARDS)) for(const c of [context(),{...context(),values:{},meds:[],dx:[],profile:undefined}]) {
    const {answers} = prefill(id,c);
    assert.doesNotThrow(()=>buildOutcome(id,answers,c),id);
    const view=decisionView(id,answers,c);
    assert.deepEqual(view.needed.map(q=>q.id),decisionQuestions(id,answers,c).map(q=>q.id),id);
    for(const q of view.assumed) if(["safety","redflags","hmod","bleeding","wound"].includes(q.id)) assert.ok(["pending","unknown","needed","uncertain"].includes(String(answers[q.id])),`${id}: ${q.id}`);
  }
});
test("K exactly 6.0 needs ECG and symptoms in every entry point; severe K prioritises emergency care",()=>{
  const c=context(6), a=prefill("hyperkalaemia",c).answers;
  assert.deepEqual(decisionQuestions("hyperkalaemia",a,c).map(q=>q.id),["symptoms","ecg"]);
  const severe={...context(6.6),values:{potassium:{value:6.6,at:"2026-10-23",prev:null}}};
  const p=prefill("hyperkalaemia",severe).answers;
  assert.deepEqual(decisionDataNeeded("hyperkalaemia",severe,p),[]);
  assert.ok((p.actions as string[]).includes("urgent"));
  assert.match(decisionBlocker("hyperkalaemia",{...p,actions:["continue"]},severe)!,/urgent/);
  assert.match(decisionBlocker("hyperkalaemia",p,severe,{"Same-day urgent assessment":"2026-10-24"})!,/today/);
});
test("suspect sample removes previously generated medication changes; changed ECG recomputes urgent action",()=>{
  const c=context(), a=prefill("hyperkalaemia",c).answers;
  const repeat=updateDecisionAnswers("hyperkalaemia",c,a,{result:"repeat"});
  assert.ok(!buildOutcome("hyperkalaemia",repeat,c).some(o=>["medication","start"].includes(o.kind)));
  assert.equal(repeat.recheck,"0");
  const urgent=updateDecisionAnswers("hyperkalaemia",c,a,{ecg:"present"});
  assert.ok((urgent.actions as string[]).includes("urgent"));
});
test("patiromer monitoring includes magnesium; new high K cannot be deferred a week",()=>{
  const c=context(5.3), a=prefill("hyperkalaemia",c).answers;
  assert.ok(buildOutcome("hyperkalaemia",a,c).some(o=>o.kind === "plan" && (o.completesOn.codes as string[]|undefined)?.includes("magnesium")));
  const high=context(), h=prefill("hyperkalaemia",high).answers;
  assert.match(decisionBlocker("hyperkalaemia",h,high,{"Renal function and potassium check":"2026-10-30"})!,/2026-10-26/);
});
test("renal-dependent starts cannot use missing values; statin escalation respects active regimen and renal limits",()=>{
  const empty={...context(),values:{}};
  for(const code of ["mra","finerenone","metformin","sglt2"]) assert.equal(typeof START[code](empty),"string",code);
  const c=context(); c.meds=[{...c.meds[0],code:"rosuvastatin",name:"Rosuvastatin",tags:["statin"],doseValue:20}];
  assert.equal(statinUp(c)[0].kind,"note");
  c.meds[0].doseValue=null;
  assert.match(statinUp(c)[0].label,/Confirm/);
  c.meds[0].status="held";
  assert.deepEqual(statinUp(c),[]);
});
test("routine grouping keeps active treatment, renal discrepancies and abnormal results visible",()=>{
  for(const rule_id of ["dm.annual-checks","lipids.lpa-once"]) assert.ok(isRoutine({rule_id,severity:"blue"}));
  for(const rule_id of ["med.monitoring","cardiorenal.stage-review","valve.echo-lesion-unlisted","lab.vitamin-d"]) assert.ok(!isRoutine({rule_id,severity:"orange"}));
  assert.ok(!isRoutine({rule_id:"dm.annual-checks",severity:"red"}));
});

test("booked preventive work remains routine, including vaccines; urgent tasks never fold",()=>{
  for(const title of ["Diabetic retinal screening","Diabetic foot examination","Influenza vaccination"]) assert.ok(isRoutinePlan({title}));
  assert.ok(isRoutinePlan({completesOn:{type:"lab",codes:["lpa"]}}));
  assert.ok(!isRoutinePlan({completesOn:{type:"lab",codes:["lpa","potassium"]}}));
  assert.ok(!isRoutinePlan({title:"Influenza vaccination",clinicalContext:{urgent:true}}));
});
