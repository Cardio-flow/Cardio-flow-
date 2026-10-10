import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { api } from "./api";
import type { DictationSuggestion } from "../shared/dictation";

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function Dictation({ patientId, mode, active = true, disabled = false, fields = "all", onApply, onDraftChange, onRecordingChange }: { patientId: string; mode: "visit" | "admission"; active?: boolean; disabled?: boolean; fields?: "all" | "vitals" | "none"; onApply(text: string, fields: DictationSuggestion[]): boolean | void; onDraftChange?(text: string): void; onRecordingChange?(recording: boolean): void }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-GB");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ suggestions: DictationSuggestion[]; warnings: string[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [includeText, setIncludeText] = useState(true);
  const recognition = useRef<Recognition | null>(null);
  const mounted = useRef(true);
  const currentText = useRef(text); currentText.current = text;
  const revision = useRef(0);
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
  function update(value: string) { revision.current++; setText(value.slice(0, 4000)); setReview(null); setSelected([]); }
  function start() {
    if (!ctor) return;
    if (!window.confirm("Browser dictation may send audio to your browser's speech provider. Use it only if approved for your clinical setting. CardioFlow does not store audio. Start microphone?")) return;
    setError(""); setReview(null); setSelected([]); revision.current++;
    const speech = new ctor(); recognition.current = speech;
    speech.lang = lang; speech.continuous = true; speech.interimResults = true;
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
      if (mounted.current && revision.current === version) { setReview(result); setSelected([]); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="dictation" aria-label="Dictation">
    <button type="button" className="btn secondary" disabled={disabled} aria-expanded={expanded} onClick={() => { if (expanded) recognition.current?.stop(); setExpanded(!expanded); }}><Mic size={17} />{expanded ? "Hide dictation" : "Dictate or paste"}</button>
    {expanded && <div className="dictation-body">
      <p className="help">Speak, check the transcript, then choose which entries to use. Nothing saves until you confirm the visit or admission form.</p>
      <div className="row wrap">
        <label className="field"><span>Dictation language</span><select className="input" value={lang} disabled={listening || busy || disabled} onChange={e => setLang(e.target.value)}><option value="en-GB">English</option><option value="ar-KW">Arabic</option></select></label>
        {listening ? <button type="button" className="btn secondary" onClick={() => recognition.current?.stop()}><Square size={15} />Stop dictation</button> : <button type="button" className="btn primary" disabled={!ctor || busy || disabled || !active} onClick={start}><Mic size={17} />Start dictation</button>}
      </div>
      <p className="help">{ctor ? "Audio may be processed by your browser's speech provider. CardioFlow does not store audio. Microphone access needs your permission." : "Microphone dictation is unavailable in this browser. Use your keyboard microphone, or type/paste below."}</p>
      <label className="field"><span>Transcript to review</span><textarea className="input" rows={5} maxLength={4000} value={text} disabled={listening || disabled} onChange={e => update(e.target.value)} /></label>
      {listening && <p role="status">Listening… {interim}</p>}
      <details><summary>Examples for field suggestions</summary><p className="help">{mode === "visit" ? "Reason: Heart failure." : "Reason: Acute decompensated HF."} Symptoms: Dyspnoea, Leg swelling. Blood pressure 110 over 70 mmHg. Heart rate 88 bpm. Weight 80 kg. Use a period or a new line between entries. Arabic and unrecognised phrases remain narrative.</p></details>
      <button type="button" className="btn secondary" disabled={!text.trim() || listening || busy || disabled} onClick={prepare}>{busy ? "Preparing review…" : "Review transcript"}</button>
      {review && <div className="dictation-review">
        <b>Choose entries after checking the transcript</b>
        {review.warnings.map(w => <p className="help" key={w}>{w}</p>)}
        {available.map(s => <label className="dictation-choice" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e => setSelected(x => e.target.checked ? [...x, s.id] : x.filter(id => id !== s.id))} /><span><b>{s.label}</b><small>From: {s.source}</small></span></label>)}
        {fields === "none" && <p className="help">At this step, dictation adds to the narrative only. Use the assessment and usual entry forms to change structured data.</p>}
        <label className="dictation-choice"><input type="checkbox" checked={includeText} onChange={e => setIncludeText(e.target.checked)} /><span>Include the reviewed transcript in the narrative</span></label>
        <p className="help">Selected entries may replace an existing value in this form. Check the filled fields before saving.</p>
        <button type="button" className="btn primary" disabled={disabled || listening || busy || (!includeText && !selected.length)} onClick={() => { if (onApply(includeText ? text.trim() : "", available.filter(s => selected.includes(s.id))) === false) { setError("The narrative is too long. Shorten it before using these entries."); return; } update(""); setExpanded(false); }}>Use reviewed entries</button>
      </div>}
      {error && <p className="error-box" role="alert">{error}</p>}
    </div>}
  </section>;
}
