import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {createLocalDb,type DB} from "../server/db/db.js";
import {boot,SITE_ID} from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import {loadState} from "../server/kernel/state.js";
import {draftNote} from "../server/kernel/notes.js";
import {sinceLastVisit} from "../server/engine/reasoning.js";
import {nowIso,today,type Actor} from "../server/kernel/base.js";
import {addDays} from "../shared/clinical.js";
import {admissionConfirmations} from "../shared/patient-sections.js";

let db:DB;
const actor:Actor={id:"flow@cardioflow.local",name:"Synthetic flow",role:"clinician",siteId:SITE_ID};
const at=(days:number)=>`${addDays(today(),days)}T06:00:00Z`;
const tx=<T>(fn:(q:any)=>Promise<T>)=>db.transaction(fn);
const patient=()=>tx(q=>K.createPatient(q,actor,{name:"Synthetic simple flow",mrn:crypto.randomUUID(),birthDate:"1960-01-01",sex:"Male",conditions:["htn"],synthetic:true}));
before(async()=>{db=await createLocalDb();await boot(db,{seed:false});});
after(async()=>db.close());

test("a short admission retains history without asserting that it was reconfirmed",async()=>{
  const id=await patient();
  const before=await loadState(db,id);
  const conf=admissionConfirmations(before.conditions,[],{});
  assert.deepEqual(conf,[]);
  const a=await tx(q=>K.startAdmission(q,actor,id,{startedAt:at(-2),reasons:["Chest pain"],confirmations:conf as any}));
  const s=await loadState(db,id);
  assert.equal(s.conditions[0].id,before.conditions[0].id);
  assert.equal((s.contexts.find(c=>c.id===a.id)!.summary.confirmations as any[]).length,0);
  assert.deepEqual(admissionConfirmations([{id:"known"}],[],{known:"unknown",foreign:"unchanged"}),[{kind:"condition",id:"known",answer:"unknown"}]);
});

test("discharge freezes the final medicines, results, plan and generated summary",async()=>{
  const id=await patient();
  const a=await tx(q=>K.startAdmission(q,actor,id,{startedAt:at(-3),reasons:["Chest pain"]}));
  const med=await tx(q=>K.startMedication(q,actor,id,{code:"atorvastatin",doseValue:40,frequency:"OD",route:"PO",indication:"lipids",effectiveAt:at(-2),contextId:a.id}));
  await tx(q=>K.recordObservations(q,actor,id,{effectiveAt:at(-1),contextId:a.id,items:[{code:"potassium",value:4.2}]}));
  await tx(q=>K.discharge(q,actor,id,a.id,{endedAt:nowIso(),status:"Stable, pain-free",plan:[{title:"Review potassium",category:"monitoring",dueDate:addDays(today(),7),completesOn:{type:"lab",codes:["potassium"]}}]}));
  let s=await loadState(db,id);
  const frozen=s.contexts.find(c=>c.id===a.id)!.summary as any;
  assert.equal(frozen.dischargeSnapshot.medicines[0].doseValue,40);
  assert.equal(frozen.dischargeSnapshot.results.find((r:any)=>r.code==="potassium").value_num,4.2);
  assert.equal(frozen.dischargeSnapshot.plan[0].title,"Review potassium");
  assert.match(frozen.note,/At discharge: Stable, pain-free/);
  assert.match(frozen.note,/Atorvastatin 40/);
  await tx(q=>K.medicationEvent(q,actor,id,med.medicationId,{kind:"increase",doseValue:80,reason:"Synthetic later decision",effectiveAt:nowIso()}));
  await tx(q=>K.recordObservations(q,actor,id,{effectiveAt:nowIso(),items:[{code:"potassium",value:5.1}]}));
  assert.equal((await draftNote(db,id,a.id,{preferSaved:true})).text,frozen.note);
  s=await loadState(db,id);
  assert.equal(s.meds[0].doseValue,80,"longitudinal record continues independently");
  assert.equal((s.contexts.find(c=>c.id===a.id)!.summary.dischargeSnapshot as any).medicines[0].doseValue,40);
});

test("an explicitly edited discharge note is preserved",async()=>{
  const id=await patient();
  const a=await tx(q=>K.startAdmission(q,actor,id,{startedAt:at(-1),reasons:["Chest pain"]}));
  await tx(q=>K.discharge(q,actor,id,a.id,{endedAt:nowIso(),status:"Improved",plan:[],note:"Clinician-reviewed discharge wording"}));
  assert.equal((await draftNote(db,id,a.id,{preferSaved:true})).text,"Clinician-reviewed discharge wording");
});

test("the prior plan includes reused context links and separates received results from review",async()=>{
  const id=await patient();
  const a=await tx(q=>K.startAdmission(q,actor,id,{startedAt:at(-4),reasons:["Chest pain"]}));
  const p=await tx(q=>K.addPlanAction(q,actor,id,{title:"Potassium check",category:"monitoring",dueDate:today(),completesOn:{type:"lab",codes:["potassium"]}}));
  await tx(q=>K.discharge(q,actor,id,a.id,{endedAt:at(-2),status:"Improved",plan:[]}));
  // A shared booking retains its original source and adds this admission to its context refs.
  await db.query("UPDATE cf.plan_action SET context_refs=$2,status='completed',progress='performed',completed_at=now() WHERE id=$1",[p.id,[a.id]]);
  let s=await loadState(db,id);
  let previous=sinceLastVisit(s)!;
  assert.equal(previous.items[0].state,"review");
  assert.match(previous.items[0].note,/awaiting clinical review/);
  await tx(q=>K.updatePlanAction(q,actor,id,p.id,{action:"reviewed",version:s.plan[0].version}));
  s=await loadState(db,id);previous=sinceLastVisit(s)!;
  assert.equal(previous.items[0].state,"done");
});

test("finishing a visit without manually composing a note generates and retains one",async()=>{
  const id=await patient();
  const v=await tx(q=>K.startVisit(q,actor,id,{startedAt:nowIso(),reasons:["Routine cardiology"],service:"Cardiology clinic"}));
  await tx(q=>K.closeVisit(q,actor,id,v.id,{}));
  const note=await draftNote(db,id,v.id,{preferSaved:true});
  assert.match(note.text,/Clinic note/);
  assert.match(note.text,/Hypertension/);
  const saved=(await loadState(db,id)).contexts.find(c=>c.id===v.id)!.summary.note;
  assert.equal(note.text,saved);
});

test("reusing a clinic booking at discharge links it into the next visit's previous plan",async()=>{
  const id=await patient();
  const booking=await tx(q=>K.addPlanAction(q,actor,id,{title:"Clinic review",category:"follow_up",dueDate:addDays(today(),5),completesOn:{type:"visit"}}));
  const a=await tx(q=>K.startAdmission(q,actor,id,{startedAt:at(-1),reasons:["Chest pain"]}));
  await tx(q=>K.discharge(q,actor,id,a.id,{endedAt:nowIso(),status:"Improved",plan:[{title:"HF clinic review",category:"follow_up",dueDate:addDays(today(),7),completesOn:{type:"visit"}}]}));
  const s=await loadState(db,id);
  assert.equal(s.plan.length,1,"the existing appointment is retained, not duplicated");
  assert.ok(s.plan[0].context_refs.includes(a.id));
  assert.equal(sinceLastVisit(s)!.items[0].id,booking.id);
  // A later imported historical admission must not displace the genuine follow-up context.
  const imported={...s.contexts[0],id:"historical",ended_at:nowIso(),summary:{historical:true}};
  assert.equal(sinceLastVisit({...s,contexts:[...s.contexts,imported]})!.items[0].id,booking.id);
});
