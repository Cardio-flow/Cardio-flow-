import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WIZARDS,buildOutcome,visibleQuestions,optionsFor,type Answers,type WizardContext} from '../shared/wizards.js';
import {GUIDANCE,suggest} from '../shared/wizard-guidance.js';
import {prefill,updateDecisionAnswers} from '../shared/wizard-prefill.js';
import {decisionQuestions} from '../shared/decision-requirements.js';
import {decisionBlocker} from '../shared/decision-validation.js';
import {prioritiseDecision,routineDecisionItem} from '../shared/decision-display.js';
import {validDate} from '../shared/dates.js';
import {MEDICATION} from '../shared/catalog.js';

const context = (): WizardContext => ({today:'2026-10-24',facts:[],detected:{},meds:[],dx:[],values:{},profile:{age:72,sex:'Female',cvd:true,riskFactors:true}});
const measured = (): WizardContext => ({...context(),dx:['hf','hfref','t2dm','htn'],values:Object.fromEntries(Object.entries({potassium:4.2,creatinine:110,egfr:45,weight:70,hr:80,sbp:150,lvef:35,haemoglobin:11,hba1c:7.5}).map(([k,value])=>[k,{value,at:'2026-10-24',prev:null}]))});
function fixture(id:string,c:WizardContext) {
  let a=prefill(id,c).answers;
  // Deliberate synthetic answers for exercising UI/data contracts, never clinical
  // defaults: each visible option is then perturbed separately below.
  for(let pass=0;pass<6;pass++) for(const q of WIZARDS[id].steps.flatMap(s=>visibleQuestions(s,a))) {
    if(a[q.id] != null)continue;
    if(q.type==='date')a[q.id]=c.today;
    else if(q.options) {const os=optionsFor(q,c);const v=os.find(o=>['none','stable','unknown','pending'].includes(o.value))?.value ?? os[0]?.value;if(v)a[q.id]=q.type==='multi'?[v]:v;}
  }
  return a;
}
function verify(id:string,a:Answers,c:WizardContext) {
  const out=buildOutcome(id,a,c);
  const keys=new Set<string>();
  for(const o of out) {
    assert.ok(!/NaN|undefined NaN/.test(o.label),id+': '+o.label);
    if(o.kind==='plan') {
      assert.ok(o.dueDate==='' || validDate(o.dueDate),id+': invalid date');
      const key=o.title+':'+o.dueDate;assert.ok(!keys.has(key),id+': duplicate '+key);keys.add(key);
    }
    if(o.kind==='start') {assert.ok(MEDICATION[o.code],id+': unknown medicine');assert.ok(Number.isFinite(o.doseValue)&&o.doseValue>0,id+': invalid dose');assert.ok(o.frequency,id+': frequency');}
  }
  assert.doesNotThrow(()=>decisionQuestions(id,a,c));
  assert.doesNotThrow(()=>decisionBlocker(id,a,c));
  const ordered=prioritiseDecision(out);const routine=ordered.findIndex(routineDecisionItem);
  if(routine>=0)assert.ok(ordered.slice(routine).every(routineDecisionItem),id);
}
for(const [id,def] of Object.entries(WIZARDS)) test(`${id}: sparse data, recorded data and every selectable branch have a valid decision presentation`,()=>{
  assert.ok(GUIDANCE[id],id+': no guidance registered');assert.ok(def.source,id+': missing guideline provenance');
  for(const c of [context(),measured()]) {
    verify(id,prefill(id,c).answers,c);
    const a=fixture(id,c);verify(id,a,c);
    for(const q of def.steps.flatMap(s=>s.questions)) for(const o of optionsFor(q,c))
      verify(id,updateDecisionAnswers(id,c,a,{[q.id]:q.type==='multi'?[o.value]:o.value}),c);
  }
});
test('unknown clinical facts are never silently interpreted as a normal finding',()=>{
  const c=measured();c.values!.sbp.value=80;
  const values=(id:string,q:string)=>suggest(id,q,{},c).map(x=>x.value);
  assert.ok(!values('shock','stage').includes('B'));
  assert.ok(!values('inr','actions').includes('increase'));
  assert.ok(!values('hypotension','actions').includes('continue'));
  assert.ok(!values('severe-hypertension','actions').includes('oral'));
  assert.ok(!values('hcm-lvoto','actions').includes('bb'));
  assert.ok(!values('congestion','actions').includes('start-loop'));
  assert.deepEqual(suggest('pah-followup','actions',{stage:'new'},c),[]);
});
test('clinical edits refresh downstream decisions after more than one edit',()=>{
  const c=measured();c.meds=[{id:'l',code:'furosemide',name:'Furosemide',doseValue:40,doseUnit:'mg',frequency:'OD',tags:['loop']}];
  let a=prefill('hypotension',c,{symptoms:['none'],volume:'dry'}).answers;
  assert.ok((a.actions as string[]).includes('continue'));
  a=updateDecisionAnswers('hypotension',c,a,{symptoms:['dizzy']});
  assert.ok((a.actions as string[]).includes('reduce-loop'));
  a=updateDecisionAnswers('hypotension',c,a,{volume:'congested'});
  assert.ok(!(a.actions as string[]).includes('reduce-loop'));
  assert.equal(a.loopDose,undefined);
});
test('ablation / LAAO referrals ask for the decision; scheduling still requires clearance',()=>{
  const c=measured();
  for(const id of ['af-ablation-plan','laao-selection']) {
    const referral=prefill(id,c,{safety:'stable',indication:'aad',reason:'contra',when:c.today,decision:'refer'}).answers;
    const missing=decisionQuestions(id,referral,c).map(q=>q.id);
    assert.ok(!missing.some(k=>['anticoag','thrombus','periOac','life','shortTherapy','imaging'].includes(k)));
    const schedule={...referral,decision:'proceed'};
    assert.ok(decisionQuestions(id,schedule,c).some(q=>id==='af-ablation-plan'?q.id==='anticoag':q.id==='life'));
    assert.ok(!buildOutcome(id,schedule,c).some(o=>o.kind==='plan'&&o.category==='procedure'));
  }
});
test('confirmed resistant hypertension offers an exact dose and monitoring; incomplete / unsafe cases cannot start it',()=>{
  const c=measured();c.hypertension={triple:true,outside:{valid:true,high:true},apparentResistance:true} as any;
  const facts={basis:'resistant',technique:'yes',adherence:'yes',doses:'yes',when:c.today,reviewDate:'2026-10-31'};
  let a=prefill('htn-resistance',c,facts).answers;
  assert.equal(a.treatment,'mra');
  const out=buildOutcome('htn-resistance',a,c);
  assert.ok(out.some(o=>o.kind==='start'&&o.code==='spironolactone'&&o.doseValue===25&&o.frequency==='OD'));
  assert.ok(out.some(o=>o.kind==='plan'&&o.dueDate==='2026-10-31'));
  assert.ok(out.some(o=>o.kind==='plan'&&o.dueDate==='2026-11-21'));
  for(const patch of [{egfr:29},{potassium:4.6}]) {
    const unsafe=structuredClone(c);for(const [k,v] of Object.entries(patch))unsafe.values![k].value=v;
    assert.equal(prefill('htn-resistance',unsafe,facts).answers.treatment,'review');
    assert.ok(decisionBlocker('htn-resistance',{...a,treatment:'mra'},unsafe));
    assert.ok(!buildOutcome('htn-resistance',{...a,treatment:'mra'},unsafe).some(o=>o.kind==='start'));
  }
  a=updateDecisionAnswers('htn-resistance',c,a,{adherence:'unknown'});
  assert.equal(a.treatment,'review');
});
