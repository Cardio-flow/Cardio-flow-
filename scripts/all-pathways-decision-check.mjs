// Complete catalogue API previews and representative decision drawers. Synthetic localhost only.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WIZARDS } from '../shared/wizards.ts';
const base=process.env.CARDIO_BASE_URL || 'http://127.0.0.1:4310';
if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw Error('Local synthetic sandbox required');
const out=process.argv[2] || '/tmp/cardio-all-pathways';fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{});
const page=await b.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(15000);
await page.emulateMedia({reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));let csrf='';
const api=(path,body)=>page.evaluate(async({path,body,csrf})=>{
 const r=await fetch('/api'+path,body?{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)}:{});
 const j=await r.json();if(!r.ok)throw Error(path+': '+JSON.stringify(j));return j;
},{path,body,csrf});
const report={previews:[],drawers:[],errors};
try {
 await page.goto(base);await page.getByText('Dr. Ahmed',{exact:true}).click();await page.getByRole('heading',{name:'Worklist',exact:true}).waitFor();csrf=(await api('/session')).csrf;
 const patient=await api('/patients',{name:'Synthetic entire catalogue',mrn:'ALL-'+Date.now(),sex:'Female',birthDate:'1954-01-01',conditions:['hfref','t2dm','htn','af'],sample:true});
 for(const id of Object.keys(WIZARDS)) {
  const p=await api(`/patients/${patient.id}/decisions/${id}/preview`,{answers:{}});
  assert.equal(p.wizard,id);assert.ok(p.source,id+': source');
  assert.ok(!p.plan.some(x=>/NaN/.test(x.label)),id+': invalid date label');
  assert.ok(!p.ready || !(p.needed.length+p.needData.length+p.blockers.length),id+': premature confirmation');
  report.previews.push({id,ready:p.ready,needed:p.needed.map(x=>x.id),data:p.needData.map(x=>x.code)});
 }
 await api(`/patients/${patient.id}/observations`,{effectiveAt:new Date().toISOString(),items:[{code:'potassium',value:4.2},{code:'creatinine',value:110},{code:'weight',value:70},{code:'hba1c',value:7.5},{code:'haemoglobin',value:11},{code:'sbp',value:150},{code:'hr',value:90}]});
 for(const [code,doseValue] of [['furosemide',40],['metformin',500],['atorvastatin',40]])await api(`/patients/${patient.id}/medications`,{code,doseValue,frequency:'OD',route:'PO',indication:'Synthetic audit'});
 for(const id of Object.keys(WIZARDS)) {
  const p=await api(`/patients/${patient.id}/decisions/${id}/preview`,{answers:{}});
  assert.ok(!p.plan.some(x=>/NaN/.test(x.label)),id);
  report.previews.push({id,recorded:true,ready:p.ready,needed:p.needed.map(x=>x.id)});
 }
 await page.goto(base+`/patients/${patient.id}`);
 const representatives=['congestion','bradycardia','severe-hypertension','diabetes','anaemia-result','pericarditis','antithrombotic','tavi-plan','htn-resistance','hcm-scd','pah-followup','aorta-plan','pregnancy-plan'];
 for(const id of representatives) {
  await page.getByRole('button',{name:'Pathways',exact:true}).click();
  await page.getByRole('textbox',{name:'Search pathways'}).fill(WIZARDS[id].title);
  await page.getByRole('dialog',{name:'Clinical pathways'}).getByRole('button',{name:new RegExp('^'+WIZARDS[id].title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
  const dialog=page.getByRole('dialog');
  if(id==='pregnancy-plan') {
    await expect(dialog.getByRole('button',{name:'Save pregnancy context',exact:true})).toBeVisible();
    report.drawers.push({id,group:WIZARDS[id].group,contextRequired:true});
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();continue;
  }
  await expect(dialog.locator('.wiz-decision')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Change details',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,id+': overflow');
  for(const selector of ['.dec-why','.dec-instead'])if(await dialog.locator(selector).count())assert.equal(await dialog.locator(selector).getAttribute('open'),null);
  if(['diabetes','htn-resistance','tavi-plan','pericarditis'].includes(id))await page.screenshot({path:`${out}/${id}-phone.png`});
  report.drawers.push({id,group:WIZARDS[id].group});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Pathways',exact:true}).click();await page.getByRole('textbox',{name:'Search pathways'}).fill('Diabetes');await page.getByRole('dialog',{name:'Clinical pathways'}).getByRole('button',{name:/^Diabetes management/}).click();
 await expect(page.locator('.wiz-decision')).toBeVisible();await page.screenshot({path:`${out}/diabetes-desktop.png`});
 assert.deepEqual(errors,[]);fs.writeFileSync(`${out}/results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({previewRequests:report.previews.length,drawers:report.drawers.length,errors}));
} finally { await b.close(); }
