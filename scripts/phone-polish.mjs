// Synthetic browser regression for compact dates, medication summaries and reserved notifications.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.CARDIO_BASE_URL || 'http://127.0.0.1:4310';
const out = process.argv[2] || '/tmp/phone-polish';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function api(path, body) {
  return page.evaluate(async ({ path, body }) => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'x-csrf-token': session.csrf } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw Error(path + ': ' + response.status);
    return response.json();
  }, { path, body });
}
async function noticeClearOf(selector) {
  const notice = await page.locator('.toast').boundingBox();
  const target = await page.locator(selector).boundingBox();
  assert.ok(notice && target);
  assert.equal(Math.round(notice.width), 390);
  assert.ok(target.y >= notice.y + notice.height - 1, 'Notification overlaps ' + selector);
  assert.equal(await page.locator('.toast-text').evaluate(e => e.scrollHeight > e.clientHeight), false);
}
try {
  await page.goto(base);
  await page.getByText('Dr. Ahmed', { exact: true }).click();
  await page.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
  const patient = await api('/patients', { name: 'Synthetic compact entry', mrn: 'COMPACT-' + Date.now(), sex: 'Male', birthDate: '1960-01-01', sample: true });
  const today = (await api('/health')).today;
  const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  await page.goto(base + '/patients/' + patient.id);
  await page.getByRole('button', { name: 'Add labs', exact: true }).click();
  let labs = page.getByRole('dialog', { name: 'Add results', exact: true });
  assert.equal(await labs.locator('.date-text').count(), 0);
  assert.ok((await labs.locator('.lab-date').boundingBox()).height <= 72);
  await page.getByLabel('Creatinine', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Change date', exact: true }).click();
  await page.getByLabel('Result date', { exact: true }).fill('12/');
  assert.equal(await page.getByRole('button', { name: 'Save 1 result', exact: true }).isEnabled(), false);
  assert.equal(await page.getByLabel('Creatinine', { exact: true }).inputValue(), '100');
  await page.getByLabel('Result date', { exact: true }).fill(yesterday.split('-').reverse().join('/'));
  await page.screenshot({ path: out + '/01-custom-date.png', animations: 'disabled' });
  const saveRequest = page.waitForRequest(r => r.url().endsWith('/observations') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Save 1 result', exact: true }).click();
  const payload = (await saveRequest).postDataJSON();
  assert.equal(payload.effectiveAt, new Date(yesterday + 'T08:00:00+03:00').toISOString());
  await labs.waitFor({ state: 'hidden' });
  await noticeClearOf('.topbar');
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.getByRole('button', { name: 'Add labs', exact: true }).click();
  labs = page.getByRole('dialog', { name: 'Add results', exact: true });
  await page.getByLabel('Potassium', { exact: true }).fill('4.5');
  await page.getByRole('button', { name: 'Change date', exact: true }).click();
  await page.getByLabel('Result date', { exact: true }).fill('12/');
  await page.getByRole('button', { name: 'Use today', exact: true }).click();
  assert.equal(await labs.locator('.date-text').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Save 1 result', exact: true }).isEnabled(), true);
  await page.screenshot({ path: out + '/02-compact-date.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Save 1 result', exact: true }).click();
  await labs.waitFor({ state: 'hidden' });
  await page.getByRole('link', { name: 'Medications', exact: true }).click();
  await page.getByRole('button', { name: 'Add several', exact: true }).click();
  let batch = page.getByRole('dialog', { name: 'Add medicines', exact: true });
  await noticeClearOf('.drawer');
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  for (const name of ['Aspirin', 'Atorvastatin']) {
    await batch.getByLabel('Search medicines').fill(name);
    await batch.getByRole('button', { name: new RegExp('^' + name + '(?: |$)') }).first().click();
  }
  assert.equal(await batch.locator('.mb-fields:visible').count(), 0);
  const aspirin = batch.locator('.mb-row').filter({ has: page.getByRole('button', { name: 'Remove Aspirin', exact: true }) });
  await aspirin.getByRole('button', { name: 'Edit Aspirin', exact: true }).click();
  await aspirin.getByRole('combobox', { name: /^Dose/ }).selectOption('100');
  await aspirin.getByRole('button', { name: 'Done editing Aspirin', exact: true }).click();
  assert.ok((await aspirin.locator('.mb-summary').textContent()).includes('100 mg'));
  await page.setViewportSize({ width: 1440, height: 1024 });
  assert.equal(await batch.locator('.mb-fields:visible').count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await batch.locator('.mb-fields:visible').count(), 0);
  const second = await batch.getByRole('button', { name: 'Edit Atorvastatin', exact: true }).boundingBox();
  assert.ok(second.y + second.height < 752, 'Second medicine summary is below the footer');
  await page.screenshot({ path: out + '/03-compact-medicines.png', animations: 'disabled' });
  await batch.getByRole('button', { name: 'Start all 2', exact: true }).click();
  await batch.waitFor({ state: 'hidden' });
  const record = await api('/patients/' + patient.id + '/record');
  assert.equal(record.meds.find(m => m.code === 'aspirin').doseValue, 100);
  assert.ok(record.meds.some(m => m.code === 'atorvastatin'));
  await noticeClearOf('.topbar');
  await page.screenshot({ path: out + '/04-notification.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  const safety = await api('/patients', { name: 'Synthetic compact safety', mrn: 'COMPACT-SAFETY-' + Date.now(), sex: 'Male', birthDate: '1960-01-01', conditions: ['hfref'], sample: true });
  await api('/patients/' + safety.id + '/medications', { code: 'eplerenone', doseValue: 25, frequency: 'OD', route: 'PO', indication: 'hf' });
  await api('/patients/' + safety.id + '/observations', { effectiveAt: new Date().toISOString(), items: [{ code: 'potassium', value: 6.2 }, { code: 'creatinine', value: 100 }] });
  await page.goto(base + '/patients/' + safety.id + '/medications');
  await page.getByRole('button', { name: 'Add several', exact: true }).click();
  batch = page.getByRole('dialog', { name: 'Add medicines', exact: true });
  await batch.getByLabel('Search medicines').fill('Spironolactone');
  await batch.getByRole('button', { name: /^Spironolactone(?: |$)/ }).first().click();
  await batch.getByText('Reason to start despite the contraindication (required)', { exact: true }).waitFor();
  await batch.locator('.sl-override').scrollIntoViewIfNeeded();
  assert.equal(await batch.locator('.mb-fields').isVisible(), false);
  assert.ok(await batch.locator('.mb-hits .sev-red').count() > 0);
  assert.equal(await batch.getByRole('button', { name: 'Start', exact: true }).isEnabled(), false);
  await page.screenshot({ path: out + '/05-safety-visible.png', animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: compact/default/custom/invalid date; retained values; expandable medication edits and saved dose; desktop controls; visible second phone medicine; reserved full-text notifications; visible contraindication and required override');
} catch (e) {
  await page.screenshot({ path: out + '/FAIL.png', animations: 'disabled' }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
