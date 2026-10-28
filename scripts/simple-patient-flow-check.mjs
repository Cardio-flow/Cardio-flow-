import {chromium,expect} from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {openPatientView} from "./patient-navigation.mjs";
import {continueAfterEntry} from "./continue-after-entry.mjs";
const base=process.env.CARDIO_BASE_URL || "http://127.0.0.1:4310";
if(!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw Error("Synthetic localhost only");
const out=process.argv[2] || "/tmp/simple-patient-flow";
fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(20000);
const errors=[];page.on("pageerror",e=>errors.push(e.message));
let csrf="";
async function api(path,body){return page.evaluate(async({path,body,csrf})=>{
 const r=await fetch("/api"+path,body?{method:"POST",headers:{"content-type":"application/json","x-csrf-token":csrf},body:JSON.stringify(body)}:{});
 const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;
},{path,body,csrf});}
try {
 await page.goto(base);
 await page.getByText("Dr. Ahmed",{exact:true}).click();
 await page.getByRole("heading",{name:"Worklist",exact:true}).waitFor();
 csrf=(await api("/session")).csrf;
 const pt=await api("/patients",{name:"Synthetic connected patient",mrn:"SIMPLE-"+Date.now(),sex:"Male",birthDate:"1960-01-01",conditions:["htn"],sample:true});
 await api(`/patients/${pt.id}/medications`,{code:"atorvastatin",doseValue:20,frequency:"OD",route:"PO",indication:"lipids",alreadyTaking:true});
 await page.goto(`${base}/patients/${pt.id}`);
 const primary=page.getByRole("navigation",{name:"Patient sections",exact:true});
 await expect(primary.getByRole("link")).toHaveCount(4);
 await openPatientView(page,"History");
 await page.getByRole("heading",{name:"History",exact:true}).waitFor();
 await expect(primary.getByRole("link",{name:"Clinical record",exact:true})).toHaveAttribute("aria-current","page");
 await openPatientView(page,"Medications");
 await expect(page).toHaveURL(/\/medications$/);
 await openPatientView(page,"Investigations");
 await expect(page).toHaveURL(/\/investigations$/);
 await openPatientView(page,"Journey");
 await page.getByRole("heading",{name:"Journey",exact:true}).waitFor();
 await expect(primary.getByRole("link",{name:"Visits & journey",exact:true})).toHaveAttribute("aria-current","page");
 await openPatientView(page,"Admissions & visits");
 await page.getByRole("button",{name:"New admission",exact:true}).click();
 let dialog=page.getByRole("dialog");
 await expect(dialog.getByRole("button",{name:"Admit",exact:true})).toBeDisabled();
 await expect(dialog.getByLabel("Admission narrative",{exact:true})).toBeHidden();
 await expect(dialog.getByRole("radio",{name:"Confirmed",exact:true}).first()).toBeHidden();
 await dialog.getByRole("button",{name:"Chest pain (ACS to exclude)",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"Admit",exact:true})).toBeEnabled();
 await page.screenshot({path:`${out}/01-short-admission.png`,fullPage:true});
 await dialog.getByRole("button",{name:"Admit",exact:true}).click();
 await continueAfterEntry(page);
 let journey=await api(`/patients/${pt.id}/journey`);
 const admission=journey.contexts.find(c=>c.kind==="admission"&&c.status==="open");
 assert.ok(admission);assert.deepEqual(admission.summary.confirmations,[]);
 await page.getByRole("button",{name:"Discharge",exact:true}).first().click();
 dialog=page.getByRole("dialog");
 await dialog.getByRole("radio",{name:"Improved",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"Confirm discharge",exact:true})).toBeEnabled();
 await dialog.getByRole("button",{name:"Confirm discharge",exact:true}).click();
 await dialog.waitFor({state:"hidden"});
 const saved=await api(`/patients/${pt.id}/contexts/${admission.id}/note`);
 assert.match(saved.text,/At discharge: Improved/);assert.match(saved.text,/Atorvastatin 20/);
 const meds=(await api(`/patients/${pt.id}/summary`)).medications;
 // Change the longitudinal record after discharge; the saved discharge stays the same.
 const current=meds.groups.flatMap(g=>g.meds).find(m=>m.code==="atorvastatin");
 assert.ok(current);
 await api(`/patients/${pt.id}/medications/${current.id}/events`,{kind:"increase",doseValue:40,reason:"Synthetic later change"});
 assert.equal((await api(`/patients/${pt.id}/contexts/${admission.id}/note`)).text,saved.text);
 await page.goto(`${base}/patients/${pt.id}`);
 await page.getByRole("button",{name:"Start clinic visit",exact:true}).click();
 dialog=page.getByRole("dialog");
 await expect(dialog.locator(".previous-plan")).toContainText("Since discharge");
 await expect(dialog.locator(".previous-plan")).toContainText(/clinic review/i);
 await expect(dialog.getByRole("button",{name:"Heart failure",exact:true})).toHaveAttribute("aria-pressed","false");
 if(await dialog.getByRole("button",{name:"Post-discharge",exact:true}).getAttribute("aria-pressed")!=="true") await dialog.getByRole("button",{name:"Post-discharge",exact:true}).click();
 await dialog.getByRole("button",{name:"Start visit",exact:true}).click();
 await expect(dialog.locator(".previous-plan")).toBeVisible();
 await dialog.getByRole("button",{name:"Save and continue",exact:true}).click();
 await dialog.getByRole("button",{name:"Continue to note",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"Finish visit",exact:true})).toBeEnabled();
 await dialog.getByRole("button",{name:"Finish visit",exact:true}).click();
 await dialog.waitFor({state:"hidden"});
 for(const width of [320,390,1440]){
  await page.setViewportSize({width,height:900});
  await primary.getByRole("link",{name:"Overview",exact:true}).click();
  await expect(primary.getByRole("link")).toHaveCount(4);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`horizontal overflow at ${width}`);
  if(width<=390) {
   const action=page.locator(".pt-actions .btn.primary");
   assert.ok((await action.boundingBox()).width>180,"primary action must not be squeezed by icons");
   const tools=page.locator(".phone-tools");await tools.locator("summary").click();
   await expect(tools.getByRole("link",{name:"Registries",exact:true})).toBeVisible();
   await tools.locator("summary").click();
  }
  await page.screenshot({path:`${out}/02-overview-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);
 console.log("PASS: four sections, record/journey navigation, minimal admission, frozen discharge, connected follow-up, visit completion and 320/390/1440 layouts");
} catch(e){await page.screenshot({path:`${out}/FAILED.png`}).catch(()=>{});throw e;}
finally{await browser.close();}
