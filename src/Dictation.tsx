import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "./api";
import type { DictationReview, DictationSuggestion } from "../shared/dictation";

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function Dictation({ patientId, mode, active = true, disabled = false, fields = "all", currentValues = {}, onApply, onDraftChange, onRecordingChange }: { patientId: string; mode: "visit" | "admission"; active?: boolean; disabled?: boolean; fields?: "all" | "vitals" | "none"; currentValues?: Record<string, string>; onApply(text: string, fields: DictationSuggestion[]): boolean | void; onDraftChange?(text: string): void; onRecordingChange?(recording: boolean): void }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<DictationReview | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [includeText, setIncludeText] = useState(true);
  const recognition = useRef<Recognition | null>(null);
  const mounted = useRef(true);
  const currentText = useRef(text); currentText.current = text;
  const revision = useRef(0);
  const consent = useRef(false);
  const callback = useRef(onDraftChange); callback.current = onDraftChange;
  const recordingCallback = useRef(onRecordingChange); recordingCallback.current = onRecordingChange;
  const ctor = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
  const available = review?.suggestions.filter(s => fields === "all" || (fields === "vitals" && s.field === "vital")) ?? [];
  useEffect(() => { setSelected([]); recognition.current?.stop(); }, [fields]);
  useEffect(() => { callback.current?.(text); }, [text]);
  useEffect(() => { recordingCallback.current?.(listening); }, [listening]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; recognition.current?.abort(); };
  }, []);
  useEffect(() => {
    const cancel = () => { const speech = recognition.current; recognition.current = null; speech?.abort(); setListening(false); setInterim(""); };
    if (!active || disabled) cancel();
    const hide = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [active, disabled]);
  function update(value: string) { revision.current++; currentText.current = value.slice(0, 4000); setText(currentText.current); setReview(null); setSelected([]); setEdited({}); }
  function start() {
    if (!ctor) return;
    if (!consent.current && !window.confirm("Browser dictation may send audio to your browser's speech provider. Use it only if approved for your clinical setting. CardioFlow does not store audio. Start microphone?")) return;
    consent.current = true;
    setError(""); setReview(null); setSelected([]); revision.current++;
    const speech = new ctor(); recognition.current = speech;
    speech.lang = "en-GB"; speech.continuous = true; speech.interimResults = true;
    speech.onresult = event => {
      if (!mounted.current || recognition.current !== speech) return;
      let final = "", pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript + " ";
        else pending += event.results[i][0].transcript;
      }
      if (final) {
        const next = [currentText.current, final.trim()].filter(Boolean).join("\n");
        if (next.length > 4000) { speech.stop(); setError("Transcript limit reached. Review and use this part before starting another dictation; the last phrase was not added."); return; }
        currentText.current = next; revision.current++; setText(next); setReview(null);
      }
      setInterim(pending);
    };
    speech.onerror = event => { if (mounted.current && recognition.current === speech) { setListening(false); setInterim(""); setError(event.error === "not-allowed" ? "Microphone permission was denied. Type or paste your transcript instead." : "Dictation stopped. Check the transcript and try again, or type instead."); speech.abort(); } };
    speech.onend = () => { if (mounted.current && recognition.current === speech) { setListening(false); setInterim(""); } };
    try { speech.start(); setListening(true); } catch { setError("Dictation could not start. Type or paste your transcript instead."); }
  }
  async function prepare() {
    const version = revision.current;
    setBusy(true); setError("");
    try {
      const result = await api(`/patients/${patientId}/dictation/preview`, { body: { text, mode } });
      if (mounted.current && revision.current === version) { setReview(result); setSelected([]); setEdited({}); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  function apply(noteOnly = false) {
    const entries = noteOnly ? [] : available.filter(s => selected.includes(s.id)).map(s => ({ ...s, value: edited[s.id] ?? s.value }));
    if (entries.some(s => s.field === "vital" && (!s.value.trim() || !Number.isFinite(Number(s.value)) || Number(s.value) < 0))) { setError("Correct the selected numeric values before filling fields."); return; }
    if (onApply(noteOnly || includeText ? text.trim() : "", entries) === false) { setError("The narrative is too long. Shorten it before using these entries."); return; }
    update(""); setExpanded(false); setError(""); setIncludeText(true);
  }
  function template(kind: string) {
    const headings = kind === "HF follow-up" ? "History:\nSymptoms:\nExamination:\nVitals:\nMedicines to review:\nPlan:" : "History:\nPresenting symptoms:\nExamination:\nVitals:\nMedicines to review:\nAdmission plan:";
    const next = [text, headings].filter(Boolean).join("\n\n");
    if (next.length > 4000) { setError("Shorten the transcript before adding headings."); return; }
    update(next);
  }
  return <section className="dictation" aria-label="Dictation">
    {!expanded ? <div className="row wrap"><button type="button" className="btn primary" disabled={disabled || !active} onClick={() => { setExpanded(true); if (ctor) start(); }}><Mic size={17} />{mode === "visit" ? "Dictate visit" : "Dictate admission"}</button><button type="button" className="btn ghost" disabled={disabled} aria-expanded={expanded} onClick={() => setExpanded(true)}>Type or paste</button><span className="help">English</span></div> : <button type="button" className="btn secondary" disabled={disabled} aria-expanded={expanded} onClick={() => { recognition.current?.stop(); setExpanded(false); }}>Hide dictation</button>}
    {expanded && <div className="dictation-body">
      <p className="help">Speak, check the transcript, then choose which entries to use. Nothing saves until you confirm the visit or admission form.</p>
      <div className="row wrap">
        {listening ? <button type="button" className="btn secondary" onClick={() => recognition.current?.stop()}><Square size={15} />Pause dictation</button> : <button type="button" className="btn primary" disabled={!ctor || busy || disabled || !active} onClick={start}><Mic size={17} />{text ? "Resume dictation" : "Start dictation"}</button>}
        <span className="dictation-state" role="status">{listening ? "Recording · English" : text ? "Paused · transcript kept" : "English dictation"}</span>
      </div>
      <p className="help">{ctor ? "Audio may be processed by your browser's speech provider. CardioFlow does not store audio. Microphone access needs your permission." : "Microphone dictation is unavailable in this browser. Use your keyboard microphone, or type/paste below."}</p>
      <div className="row wrap"><span className="help">Blank headings:</span>{["HF follow-up", "Admission history"].map(t => <button type="button" className="btn ghost small" key={t} disabled={listening || busy || disabled} onClick={() => template(t)}>{t}</button>)}</div>
      <label className="field"><span>Transcript to review</span><textarea aria-label="Transcript to review" className="input" rows={5} maxLength={4000} value={text} disabled={listening || disabled} onChange={e => update(e.target.value)} /></label>
      {listening && <p role="status">Listening… {interim}</p>}
      <details><summary>Examples for field suggestions</summary><p className="help">{mode === "visit" ? "Here for heart failure follow-up." : "Admitted for acute decompensated heart failure."} Patient has breathlessness and ankle swelling. BP is 110 over 70 mmHg. Heart rate is 88 bpm. Weight 80 kg. Use a period or a new line between entries. Unrecognised phrases remain narrative.</p></details>
      <div className="row wrap"><button type="button" className="btn secondary" disabled={!text.trim() || listening || busy || disabled} onClick={prepare}>{busy ? "Preparing review…" : "Review transcript"}</button><button type="button" className="btn ghost" disabled={!text.trim() || listening || busy || disabled} onClick={() => apply(true)}>Add to note</button><span className="help">Adds the reviewed transcript only; fills no fields.</span></div>
      {review && <div className="dictation-review">
        <b>Choose entries after checking the transcript</b>
        {review.issues.length > 0 && <div className="dictation-issues"><b>Needs attention · {review.issues.length}</b>{review.issues.map((issue, i) => <div key={i}><strong>{issue.group}</strong> · {issue.message}<blockquote>{issue.source}</blockquote></div>)}</div>}
        <details><summary>Grouped narrative · nothing saved</summary>{review.sections.map(section => <div className="dictation-section" key={section.title}><b>{section.title}</b><p>{section.text}</p></div>)}</details>
        <details><summary>What this review covers</summary>{review.warnings.map(w => <p className="help" key={w}>{w}</p>)}</details>
        {(["reason", "symptom", "vital"] as const).map(group => available.some(s => s.field === group) && <fieldset className="dictation-fields" key={group}><legend>{group === "reason" ? "Visit / admission reasons" : group === "symptom" ? "Symptoms" : "Vitals · confirm numbers and units"}</legend>{available.filter(s => s.field === group).map(s => <div className="dictation-choice" key={s.id}><label><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(x => e.target.checked ? [...x, s.id] : x.filter(id => id !== s.id))} /><span><b>{s.field === "vital" ? s.label.replace(`: ${s.value}`, `: ${edited[s.id] ?? s.value}`) : s.label}</b><small>From: {s.source}</small>{s.field === "vital" && currentValues[s.code] && currentValues[s.code] !== (edited[s.id] ?? s.value) && <small className="dictation-replace">Replaces this form's value: {currentValues[s.code]}</small>}</span></label>{s.field === "vital" && <label className="dictation-value"><span className="sr-only">Correct {s.label.split(":")[0]}</span><input className="input" inputMode="decimal" aria-label={`Correct ${s.label.split(":")[0]}`} value={edited[s.id] ?? s.value} onChange={e => setEdited(x => ({ ...x, [s.id]: e.target.value }))} /></label>}</div>)}</fieldset>)}
        {fields === "none" && <p className="help">At this step, dictation adds to the narrative only. Use the assessment and usual entry forms to change structured data.</p>}
        <label className="dictation-choice"><input type="checkbox" checked={includeText} onChange={e => setIncludeText(e.target.checked)} /><span>Include the reviewed transcript in the narrative</span></label>
        <p className="help">Selected entries may replace an existing value in this form. Check the filled fields before saving.</p>
        <button type="button" className="btn primary" disabled={disabled || listening || busy || (!includeText && !selected.length)} onClick={() => apply()}>Use reviewed entries</button>
      </div>}
      {error && <p className="error-box" role="alert">{error}</p>}
    </div>}
  </section>;
}
