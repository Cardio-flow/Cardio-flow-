// Synthetic browser integration. Speech events are simulated; no patient audio is recorded.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.CARDIO_BASE_URL || 'http://127.0.0.1:4310';
const out = process.argv[2] || '/tmp/dictation-check';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
await context.addInitScript(() => {
  window.SpeechRecognition = class {
    start() { window.testRecognition = this; window.testRecognitionStarted = true; }
    stop() { window.testRecognitionStarted = false; this.onend?.(); }
    abort() { window.testRecognitionStarted = false; this.onend?.(); }
  };
});
const page = await context.newPage(); page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
async function api(path, body) {
  return page.evaluate(async ({ path, body }) => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json', 'x-csrf-token': session.csrf } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw Error(await response.text()); return response.json();
  }, { path, body });
}
async function patient(tag) { return api('/patients', { name: 'Synthetic dictation ' + tag, mrn: 'DICT-' + tag + '-' + Date.now(), sex: 'Male', birthDate: '1960-01-01', sample: true }); }
async function review(dialog, text, select = true) {
  await dialog.getByRole('button', { name: 'Dictate or paste', exact: true }).click();
  await dialog.getByLabel('Transcript to review', { exact: true }).fill(text);
  await dialog.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await dialog.getByText('Choose entries after checking the transcript', { exact: true }).waitFor();
  const checks = dialog.locator('.dictation-review input[type=checkbox]');
  for (let i = 0; i < (await checks.count()) - 1; i++) {
    assert.equal(await checks.nth(i).isChecked(), false, 'Structured entries must start unchecked');
    if (select) await checks.nth(i).check();
  }
}
try {
  await page.goto(base); await page.getByText('Dr. Ahmed', { exact: true }).click();
  await page.getByRole('heading', { name: 'Worklist', exact: true }).waitFor();
  const clinic = await patient('clinic');
  await page.goto(base + '/patients/' + clinic.id);
  await page.getByRole('button', { name: 'Start clinic visit', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Start clinic visit', exact: true });
  const text = 'Reason: Routine cardiology. Symptoms: Dyspnoea. Blood pressure 110 over 70 mmHg. Heart rate 88 bpm. Weight 80.5 kg. Stop bisoprolol fifteen mg.';
  await review(dialog, text);
  assert.equal((await api('/patients/' + clinic.id + '/journey')).contexts.length, 0);
  assert.equal((await api('/patients/' + clinic.id + '/record')).todayValues.hr, undefined);
  await page.screenshot({ path: out + '/01-review-desktop.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).click();
  assert.equal(await dialog.getByLabel('Visit narrative').inputValue(), text);
  await dialog.getByRole('button', { name: 'Start visit', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Clinic visit', exact: true });
  assert.equal(await dialog.getByLabel(/^Systolic BP/).inputValue(), '110');
  assert.equal(await dialog.getByLabel(/^Heart rate/).inputValue(), '88');
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue to note', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Clinic note"]').disabled);
  assert.ok((await dialog.getByLabel('Clinic note').inputValue()).includes(text));
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  const correctedNarrative = 'Corrected reviewed narrative. No chest pain.';
  await dialog.getByLabel('Visit narrative', { exact: true }).fill(correctedNarrative);
  await dialog.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await dialog.getByRole('button', { name: 'Continue to note', exact: true }).click();
  assert.ok((await dialog.getByLabel('Clinic note').inputValue()).includes(correctedNarrative));
  assert.equal((await dialog.getByLabel('Clinic note').inputValue()).includes(text), false);
  await review(dialog, 'Reviewed today. No chest pain.');
  assert.equal(await dialog.locator('.dictation-review input[type=checkbox]').count(), 1);
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).click();
  assert.ok((await dialog.getByLabel('Clinic note').inputValue()).includes('No chest pain'));
  await dialog.getByRole('button', { name: 'Finish visit', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const clinicJourney = await api('/patients/' + clinic.id + '/journey');
  assert.ok(clinicJourney.contexts[0].summary.note.includes('No chest pain'));
  assert.equal((await api('/patients/' + clinic.id + '/record')).meds.length, 0, 'Spoken medicine instructions must not start/stop medicines');

  const admission = await patient('admission');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + '/patients/' + admission.id + '/visits');
  await page.getByRole('button', { name: 'New admission', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Start admission', exact: true });
  await dialog.getByRole('button', { name: 'Dictate or paste', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start dictation', exact: true }).click();
  await page.evaluate(() => {
    const result = [{ transcript: 'Reason: Other. Symptoms: Dyspnoea. Heart rate 92 bpm. Presentation reviewed.' }]; result.isFinal = true;
    window.testRecognition.onresult({ resultIndex: 0, results: [result] });
  });
  await dialog.getByRole('button', { name: 'Other', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Admit', exact: true }).isEnabled(), false, 'Finish recording before saving');
  await dialog.getByRole('button', { name: 'Stop dictation', exact: true }).click();
  await dialog.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await dialog.getByText('Choose entries after checking the transcript', { exact: true }).waitFor();
  // Editing invalidates a prepared review instead of applying stale extracted values.
  await dialog.getByLabel('Transcript to review').fill('Reason: Other. Symptoms: Dyspnoea. Heart rate 94 bpm. Presentation reviewed.');
  assert.equal(await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).count(), 0);
  await dialog.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await dialog.getByText('Choose entries after checking the transcript', { exact: true }).waitFor();
  for (const check of await dialog.locator('.dictation-review input[type=checkbox]').all()) await check.check();
  await page.screenshot({ path: out + '/02-review-phone.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).click();
  assert.equal(await dialog.getByLabel('Heart rate (bpm)', { exact: true }).inputValue(), '94');
  await dialog.getByRole('button', { name: 'Admit', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const journey = await api('/patients/' + admission.id + '/journey');
  assert.ok(journey.contexts[0].summary.narrative.includes('Presentation reviewed'));
  assert.ok(journey.events.some(e => e.detail?.includes('Presentation reviewed')));
  await page.getByRole('button', { name: 'Discharge', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Discharge', exact: true });
  await review(dialog, 'No chest pain. Follow up with the clinic; confirm the appointment date.');
  assert.equal(await dialog.locator('.dictation-review input[type=checkbox]').count(), 1);
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).click();
  await dialog.getByRole('radio', { name: 'Euvolaemic', exact: true }).click();
  await page.screenshot({ path: out + '/03-discharge-phone.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Confirm discharge', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.ok((await api('/patients/' + admission.id + '/journey')).contexts[0].summary.handover.includes('No chest pain'));

  const denied = await patient('denied');
  await page.goto(base + '/patients/' + denied.id);
  await page.getByRole('button', { name: 'Start clinic visit', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Start clinic visit', exact: true });
  await dialog.getByRole('button', { name: 'Dictate or paste', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start dictation', exact: true }).click();
  await page.evaluate(() => { window.testRecognition.onerror({ error: 'not-allowed' }); window.testRecognition.onend(); });
  await dialog.getByText('Microphone permission was denied. Type or paste your transcript instead.', { exact: true }).waitFor();
  await dialog.getByLabel('Transcript to review').fill('Reason: Routine cardiology.');
  await dialog.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Start dictation', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const result = [{ transcript: 'Late speech must not enter the hidden form' }]; result.isFinal = true;
    window.testRecognition.onresult({ resultIndex: 0, results: [result] });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  assert.equal(await page.evaluate(() => window.testRecognitionStarted), false);
  assert.equal((await dialog.getByLabel('Transcript to review').inputValue()).includes('Late speech'), false);
  const fallback = await patient('unsupported');
  await page.goto(base + '/patients/' + fallback.id);
  await page.evaluate(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
  await page.getByRole('button', { name: 'Start clinic visit', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Start clinic visit', exact: true });
  await dialog.getByRole('button', { name: 'Dictate or paste', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Start dictation', exact: true }).isEnabled(), false);
  await dialog.getByLabel('Transcript to review').fill('Reason: Routine cardiology.');
  await dialog.getByRole('button', { name: 'Review transcript', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use reviewed entries', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: unchecked/source-linked review; no preview writes; visit vitals/note correction/retention; no medicine execution; simulated microphone transcript; editing invalidates review; phone admission/Journey; discharge handover; denied/unsupported microphone text fallback; hidden microphone stops and rejects late events; no overflow/page errors');
} catch (e) { await page.screenshot({ path: out + '/FAIL.png', animations: 'disabled' }).catch(() => {}); throw e; }
finally { await browser.close(); }
