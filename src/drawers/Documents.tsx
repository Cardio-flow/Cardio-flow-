import { useState } from "react";
import { Copy, FileText, Printer } from "lucide-react";
import { useData } from "../api";
import { Drawer, Segmented, useToast } from "../ui";

// Copy-ready documents from confirmed data: clinical summary, medication list, patient plan (EN / AR).
export function DocumentsDrawer({ patientId, onClose }: { patientId: string; onClose(): void }) {
  const { data } = useData<{ id: string; title: string; text: string; dir?: "rtl" }[]>(`/patients/${patientId}/documents`);
  const [which, setWhich] = useState("summary");
  const toast = useToast();
  const doc = data?.find((d) => d.id === which);
  const copy = async () => {
    if (!doc) return;
    try {
      await navigator.clipboard.writeText(doc.text);
      toast({ text: `${doc.title} copied` });
    } catch {
      toast({ text: "Copy not allowed by the browser: select the text and copy it" });
    }
  };
  const print = () => {
    if (!doc) return;
    const w = window.open("", "_blank", "noopener=no,width=800,height=900");
    if (!w) return;
    w.document.title = doc.title;
    const pre = w.document.createElement("pre");
    pre.textContent = doc.text;
    pre.dir = doc.dir ?? "ltr";
    pre.style.cssText = "white-space:pre-wrap;font:15px/1.6 system-ui,'Segoe UI',Tahoma,sans-serif;margin:32px;";
    w.document.body.appendChild(pre);
    w.print();
  };
  return (
    <Drawer
      wide
      title="Documents"
      subtitle="Built from confirmed data · edit before pasting into the hospital system"
      icon={<FileText size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" onClick={print} disabled={!doc}><Printer size={16} /> Print</button>
          <button className="btn primary" onClick={copy} disabled={!doc}><Copy size={16} /> Copy</button>
        </span>
      }
    >
      <div className="drawer-body">
        <Segmented label="Document" options={(data ?? []).map((d) => ({ value: d.id, label: d.title }))} value={which} onChange={setWhich} />
        {!data && <div className="empty">Preparing documents…</div>}
        {doc && (
          <textarea
            className={`input doc-text ${doc.dir === "rtl" ? "rtl" : ""}`}
            dir={doc.dir ?? "ltr"}
            lang={doc.dir === "rtl" ? "ar" : "en"}
            readOnly
            rows={26}
            value={doc.text}
            aria-label={doc.title}
          />
        )}
        {doc?.id === "plan-ar" && <div className="small muted" style={{ fontWeight: 600 }}>Arabic wording is fixed patient education; read it once before giving it to the patient.</div>}
      </div>
    </Drawer>
  );
}
