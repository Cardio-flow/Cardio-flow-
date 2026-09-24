import express, { type NextFunction, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import type { DB, Q } from "./db/db.js";
import { ApiError, nowIso, today, patientInSite, type Actor } from "./kernel/base.js";
import * as K from "./kernel/clinical.js";
import { loadState } from "./kernel/state.js";
import { attentionCount, journey, summary, worklist, planView, results } from "./kernel/views.js";
import { draftNote } from "./kernel/notes.js";
import { reassess } from "./engine/engine.js";
import { completeWizard, declineRecommendation, getWizard, saveDraft } from "./engine/wizard.js";
import { draftRule, listRules, transitionRule } from "./engine/governance.js";
import { LABS, VITALS, PLAN_TEMPLATES } from "../shared/catalog.js";
import { addDays } from "../shared/clinical.js";

export type Session = Actor & { email: string; expires: number; csrf: string };
export type HostedAuth = {
  origin: string;
  mount(app: express.Express): void;
  authenticate(req: Request, res: Response): Promise<Session | null>;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");
const uuidS = z.string().uuid();

export function createApp(db: DB, hosted?: HostedAuth, ready?: Promise<unknown>) {
  const app = express();
  app.disable("x-powered-by");
  if (ready) app.use("/api", (_req, _res, next) => void ready.then(() => next(), next));
  const sessions = new Map<string, Session>();

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    if (!hosted && !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname))
      return res.status(403).json({ error: "The local workspace only answers on localhost." });
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin && origin !== (hosted?.origin ?? `http://${req.get("host")}`)) return res.status(403).json({ error: "Untrusted origin" });
    }
    next();
  });
  hosted?.mount(app);
  app.use(express.json({ limit: "512kb" }));
  app.get("/api/config", (_req, res) => res.json({ hosted: !!hosted }));
  app.get("/api/health", async (_req, res) => {
    const t = Date.now();
    await db.query("SELECT 1");
    // region only (from the host name) so the server can be placed next to the database
    const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
    res.json({ status: "ok", today: today(), dbRoundTripMs: Date.now() - t, dbRegion: host.match(/\.([a-z]{2}-[a-z]+-\d)\./)?.[1] ?? (host ? "unknown" : "local"), serverRegion: process.env.VERCEL_REGION ?? "local" });
  });

  // Local sandbox sign-in: choose one of the seeded synthetic team members.
  app.get("/api/demo-users", async (_req, res) => {
    if (hosted) return res.status(404).json({ error: "Not available" });
    res.json((await db.query(`SELECT email, display_name, role FROM cf.member WHERE active ORDER BY role, display_name`)).rows);
  });
  app.post("/api/demo-session", async (req, res) => {
    if (hosted) return res.status(404).json({ error: "Demo sign-in is disabled" });
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const m = (await db.query(`SELECT m.*, s.mode FROM cf.member m JOIN cf.site s ON s.id=m.site_id WHERE email=$1 AND active`, [email])).rows[0];
    if (!m) return res.status(404).json({ error: "Unknown user" });
    const token = randomBytes(32).toString("hex");
    const session: Session = { id: m.email, name: m.display_name, role: m.role, siteId: m.site_id, email: m.email, expires: Date.now() + 12 * 3600_000, csrf: randomBytes(24).toString("hex") };
    sessions.set(token, session);
    res.cookie("cf_session", token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 12 * 3600_000 });
    res.json(publicSession(session));
  });

  app.use("/api", async (req, res, next) => {
    try {
      const token = req.headers.cookie?.split(/;\s*/).find((v) => v.startsWith("cf_session="))?.split("=")[1];
      const session = hosted ? await hosted.authenticate(req, res) : token ? sessions.get(token) : undefined;
      if (res.headersSent) return;
      if (!session || session.expires < Date.now()) return res.status(401).json({ error: hosted ? "Sign in to continue" : "Choose a user to continue" });
      if (!["GET", "HEAD"].includes(req.method) && req.get("x-csrf-token") !== session.csrf) return res.status(403).json({ error: "Invalid request token" });
      res.locals.session = session;
      next();
    } catch (e) {
      next(e);
    }
  });

  const actor = (res: Response): Actor => res.locals.session;
  const siteMode = async (q: Q, siteId: string) =>
    ((await q.query(`SELECT mode FROM cf.site WHERE id=$1`, [siteId])).rows[0]?.mode ?? "production") as "sandbox" | "production";
  const clinician = (_req: Request, res: Response, next: NextFunction) =>
    ["clinician", "admin"].includes(actor(res).role) || actor(res).role === "reviewer" ? next() : res.status(403).json({ error: "Not allowed" });

  // Every clinical write: one transaction → kernel op → engine reassesses the inputs that changed.
  async function write<T extends { changed?: string[] }>(res: Response, patientId: string, op: (tx: Q, a: Actor) => Promise<T>) {
    const a = actor(res);
    const out = await db.transaction(async (tx) => {
      await patientInSite(tx, a, patientId);
      const r = await op(tx, a);
      const engine = await reassess(tx, patientId, await siteMode(tx, a.siteId), r.changed ?? null);
      return { ...r, engine };
    });
    res.json(out);
  }
  const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

  app.get("/api/session", (_req, res) => res.json(publicSession(res.locals.session)));
  app.post("/api/logout", (req, res) => {
    const token = req.headers.cookie?.split(/;\s*/).find((v) => v.startsWith("cf_session="))?.split("=")[1];
    if (token) sessions.delete(token);
    res.clearCookie("cf_session");
    res.json({ ok: true });
  });
  app.get("/api/site", route(async (_req, res) => {
    res.json((await db.query(`SELECT id,name,mode FROM cf.site WHERE id=$1`, [actor(res).siteId])).rows[0]);
  }));

  // ---------- worklist & patients ----------
  app.get("/api/attention-count", route(async (_req, res) => res.json({ count: await attentionCount(db, actor(res).siteId) })));
  app.get("/api/worklist", route(async (_req, res) => {
    const rows = await worklist(db, actor(res).siteId);
    res.json({ today: today(), rows });
  }));
  app.get("/api/patients", route(async (req, res) => {
    const q = z.string().max(80).parse(req.query.q ?? "");
    res.json(
      (
        await db.query(`SELECT id,name,mrn,sex,birth_date FROM cf.patient WHERE site_id=$1 AND (name ILIKE $2 OR mrn ILIKE $2) ORDER BY name LIMIT 30`, [actor(res).siteId, `%${q}%`])
      ).rows,
    );
  }));
  app.post("/api/patients", clinician, route(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(120),
        mrn: z.string().trim().min(1).max(40),
        sex: z.enum(["Male", "Female"]),
        birthDate: isoDate,
        allergies: z.string().max(300).optional(),
        conditions: z.array(z.string()).max(30).default([]),
      })
      .parse(req.body);
    const id = await db.transaction(async (tx) => {
      const id = await K.createPatient(tx, actor(res), input);
      await reassess(tx, id, await siteMode(tx, actor(res).siteId));
      return id;
    });
    res.status(201).json({ id });
  }));
  app.get("/api/patients/:id/summary", route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    res.json((await patientInSite(db, actor(res), id), await summary(db, id, await siteMode(db, actor(res).siteId))));
  }));
  app.get("/api/patients/:id/journey", route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    res.json((await patientInSite(db, actor(res), id), await journey(db, id)));
  }));
  app.get("/api/patients/:id/record", route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    res.json(
      await (async (tx) => {
        await patientInSite(tx, actor(res), id);
        const s = await loadState(tx, id);
        const meds = s.meds.map((m) => ({ ...m, events: m.events }));
        const studies = s.studies.map((st) => ({ ...st, lvef: s.observations.find((o) => o.code === "lvef" && (o as any).study_id === st.id)?.value_num ?? null }));
        return {
          today: s.today,
          meds,
          plan: planView(s),
          results: results(s, [...LABS.map((l) => l.code)]),
          vitals: results(s, VITALS.map((v) => v.code)),
          studies,
          lvefResolution: (() => {
            const r = s.resolved("lvef");
            return { currentId: r.current?.id ?? null, reason: r.reason, preferred: s.preferences.lvef ?? null };
          })(),
          contexts: s.contexts,
          conditions: s.conditions,
        };
      })(db),
    );
  }));

  // ---------- observations ----------
  app.post("/api/patients/:id/observations", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        effectiveAt: isoDateTime,
        contextId: uuidS.nullish(),
        items: z
          .array(z.object({ code: z.string().max(40), value: z.number().finite().nullish(), unit: z.string().max(20).nullish(), text: z.string().max(40).nullish() }))
          .min(1)
          .max(30),
      })
      .parse(req.body);
    await write(res, id, (tx, a) => K.recordObservations(tx, a, id, input));
  }));
  app.post("/api/patients/:id/observations/:oid/correct", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ value: z.number().finite().optional(), enteredInError: z.boolean().optional() }).parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.correctObservation(tx, a, id, uuidS.parse(req.params.oid), input) }));
  }));
  app.post("/api/patients/:id/preferences", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ code: z.string().max(40), observationId: uuidS.nullable(), reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.preferValue(tx, a, id, input.code, input.observationId, input.reason) }));
  }));
  app.post("/api/patients/:id/echo", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        date: isoDateTime,
        quality: z.enum(["formal", "limited", "bedside"]),
        lvef: z.number().min(5).max(85),
        findings: z.array(z.string().max(80)).max(20).default([]),
        conclusion: z.string().max(2000).optional(),
        contextId: uuidS.nullish(),
      })
      .parse(req.body);
    await write(res, id, (tx, a) => K.recordEcho(tx, a, id, input));
  }));

  // ---------- conditions ----------
  app.post("/api/patients/:id/conditions", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ codes: z.array(z.string()).min(1).max(20), onset: isoDate.nullish(), contextId: uuidS.nullish() }).parse(req.body);
    await write(res, id, async (tx, a) => {
      for (const code of input.codes) await K.addCondition(tx, a, id, { code, onset: input.onset, contextId: input.contextId });
      return { changed: ["conditions"] };
    });
  }));
  app.post("/api/patients/:id/conditions/:cid/status", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const { status } = z.object({ status: z.enum(["resolved", "entered_in_error", "active"]) }).parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.setConditionStatus(tx, a, id, uuidS.parse(req.params.cid), status) }));
  }));

  // ---------- medications ----------
  app.post("/api/patients/:id/medications", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        code: z.string().max(60),
        doseValue: z.number().positive().nullable(),
        frequency: z.string().max(60),
        route: z.string().max(20),
        indication: z.string().max(80),
        reason: z.string().max(300).optional(),
        effectiveAt: isoDateTime.optional(),
        contextId: uuidS.nullish(),
        monitoring: z.object({ dueDate: isoDate, title: z.string().max(120), codes: z.array(z.string()).min(1) }).nullish(),
      })
      .parse(req.body);
    await write(res, id, async (tx, a) => {
      const r = await K.startMedication(tx, a, id, { ...input, effectiveAt: input.effectiveAt ?? nowIso() });
      if (input.monitoring)
        await K.addPlanAction(tx, a, id, {
          category: "monitoring", title: input.monitoring.title, reason: `After starting ${input.code}`, dueDate: input.monitoring.dueDate,
          completesOn: { type: "lab", codes: input.monitoring.codes }, contextId: input.contextId, medicationId: r.medicationId,
        });
      return { ...r, changed: ["meds", "plan"] };
    });
  }));
  app.post("/api/patients/:id/medications/:mid/events", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        kind: z.enum(["increase", "decrease", "hold", "restart", "stop", "continue"]),
        doseValue: z.number().positive().nullish(),
        frequency: z.string().max(60).nullish(),
        reason: z.string().max(300).optional(),
        contextId: uuidS.nullish(),
        review: z.object({ dueDate: isoDate, title: z.string().max(120), codes: z.array(z.string()).optional() }).nullish(),
      })
      .parse(req.body);
    await write(res, id, async (tx, a) => {
      const changed = await K.medicationEvent(tx, a, id, uuidS.parse(req.params.mid), { ...input, effectiveAt: nowIso() });
      if (input.review)
        await K.addPlanAction(tx, a, id, {
          category: input.review.codes?.length ? "monitoring" : "follow_up",
          title: input.review.title,
          dueDate: input.review.dueDate,
          completesOn: input.review.codes?.length ? { type: "lab", codes: input.review.codes } : { type: "visit" },
          contextId: input.contextId,
          medicationId: uuidS.parse(req.params.mid),
        });
      return { changed: [...changed, "plan"] };
    });
  }));

  // ---------- plan ----------
  app.post("/api/patients/:id/plan", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        items: z
          .array(
            z.object({
              category: z.enum(["medication", "investigation", "monitoring", "follow_up", "referral", "procedure", "education", "other"]),
              title: z.string().trim().min(2).max(160),
              reason: z.string().max(300).optional(),
              dueDate: isoDate.nullable(),
              completesOn: z.record(z.string(), z.unknown()).optional(),
              medicationId: uuidS.nullish(),
            }),
          )
          .min(1)
          .max(20),
        contextId: uuidS.nullish(),
      })
      .parse(req.body);
    await write(res, id, async (tx, a) => {
      for (const item of input.items) await K.addPlanAction(tx, a, id, { ...item, contextId: input.contextId });
      return { changed: ["plan"] };
    });
  }));
  app.post("/api/patients/:id/plan/:pid", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({ action: z.enum(["complete", "defer", "cancel", "reschedule"]), outcome: z.string().max(300).optional(), dueDate: isoDate.optional(), version: z.number().int() })
      .parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.updatePlanAction(tx, a, id, uuidS.parse(req.params.pid), input) }));
  }));

  // ---------- care contexts ----------
  app.post("/api/patients/:id/admissions", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        startedAt: isoDateTime,
        location: z.string().trim().min(1).max(80),
        reasons: z.array(z.string().max(80)).min(1).max(6),
        confirmations: z.array(z.object({ kind: z.enum(["condition", "medication"]), id: uuidS, answer: z.enum(["unchanged", "changed", "unknown", "not-assessed"]) })).optional(),
      })
      .parse(req.body);
    await write(res, id, (tx, a) => K.startAdmission(tx, a, id, input));
  }));
  app.post("/api/patients/:id/admissions/:cid/discharge", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z
      .object({
        endedAt: isoDateTime,
        status: z.string().max(120),
        note: z.string().max(4000).optional(),
        plan: z
          .array(z.object({ category: z.string(), title: z.string().max(160), dueDate: isoDate.nullable(), completesOn: z.record(z.string(), z.unknown()).optional(), reason: z.string().max(200).optional() }))
          .max(20),
      })
      .parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.discharge(tx, a, id, uuidS.parse(req.params.cid), input) }));
  }));
  app.post("/api/patients/:id/visits", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ reasons: z.array(z.string().max(80)).min(1).max(8), service: z.string().max(60) }).parse(req.body);
    await write(res, id, (tx, a) => K.startVisit(tx, a, id, { ...input, startedAt: nowIso() }));
  }));
  app.post("/api/patients/:id/visits/:cid/close", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ note: z.string().max(8000).optional() }).parse(req.body);
    await write(res, id, async (tx, a) => ({ changed: await K.closeVisit(tx, a, id, uuidS.parse(req.params.cid), input) }));
  }));
  app.get("/api/patients/:id/contexts/:cid/note", route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    res.json(await db.transaction(async (tx) => (await patientInSite(tx, actor(res), id), draftNote(tx, id, uuidS.parse(req.params.cid)))));
  }));

  // ---------- wizards & recommendations ----------
  app.get("/api/patients/:id/wizards/:wizard", route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    res.json(await db.transaction(async (tx) => (await patientInSite(tx, actor(res), id), getWizard(tx, id, String(req.params.wizard)))));
  }));
  app.put("/api/patients/:id/wizards/:wizard/draft", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ answers: z.record(z.string(), z.any()), step: z.number().int().min(0).max(20), recommendationId: uuidS.nullish() }).parse(req.body);
    await db.transaction(async (tx) => (await patientInSite(tx, actor(res), id), saveDraft(tx, actor(res), id, String(req.params.wizard), input)));
    res.json({ ok: true });
  }));
  app.post("/api/patients/:id/wizards/:wizard/complete", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ answers: z.record(z.string(), z.any()), recommendationId: uuidS.nullish(), contextId: uuidS.nullish() }).parse(req.body);
    await write(res, id, (tx, a) => completeWizard(tx, a, id, String(req.params.wizard), input));
  }));
  app.post("/api/patients/:id/recommendations/:rid/decline", clinician, route(async (req, res) => {
    const id = uuidS.parse(req.params.id);
    const input = z.object({ outcome: z.enum(["declined", "deferred"]), reason: z.string().max(300) }).parse(req.body);
    await write(res, id, async (tx, a) => (await declineRecommendation(tx, a, id, uuidS.parse(req.params.rid), input), { changed: [] }));
  }));

  // ---------- governance ----------
  app.get("/api/rules", route(async (_req, res) => res.json(await db.transaction((tx) => listRules(tx)))));
  app.post("/api/rules/:rule/:version/transition", route(async (req, res) => {
    const input = z.object({ to: z.enum(["DRAFT", "CLINICAL_REVIEW", "APPROVED", "PUBLISHED", "RETIRED"]), note: z.string().max(2000).default("") }).parse(req.body);
    await db.transaction((tx) => transitionRule(tx, actor(res), String(req.params.rule), Number(req.params.version), input.to, input.note));
    await reassessSite(db, actor(res).siteId);
    res.json({ ok: true });
  }));
  app.post("/api/rules/:rule/draft", route(async (req, res) => {
    const input = z.object({ params: z.record(z.string(), z.union([z.number(), z.string()])), evidence: z.string().max(2000).default("") }).parse(req.body);
    const version = await db.transaction((tx) => draftRule(tx, actor(res), String(req.params.rule), input.params, input.evidence));
    await reassessSite(db, actor(res).siteId);
    res.json({ version });
  }));

  app.get("/api/templates", (_req, res) => res.json(PLAN_TEMPLATES.map((t) => ({ ...t, dates: t.offsets.map((d) => addDays(today(), d)) }))));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) return res.status(400).json({ error: "Please check the entry: " + error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") });
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: "Something went wrong. Nothing was saved." });
  });
  return app;
}

export async function reassessSite(db: DB, siteId: string) {
  const mode = ((await db.query(`SELECT mode FROM cf.site WHERE id=$1`, [siteId])).rows[0]?.mode ?? "production") as "sandbox" | "production";
  const ids = (await db.query(`SELECT id FROM cf.patient WHERE site_id=$1`, [siteId])).rows as { id: string }[];
  for (const { id } of ids) await db.transaction((tx) => reassess(tx, id, mode));
}

function publicSession(s: Session) {
  return { id: s.id, name: s.name, role: s.role, siteId: s.siteId, email: s.email, csrf: s.csrf };
}
