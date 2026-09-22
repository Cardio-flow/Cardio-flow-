import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api, currentDate, date, useData } from "./api";
import { Badge, Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";

type Evidence = {
  key: string;
  version: string;
  title: string;
  organization: string;
  topic: string;
  publication_year: number | null;
  authoritative_url: string;
  lifecycle_status: string;
  last_verified_at: string | null;
  next_review_date: string | null;
  reviewDue: boolean;
};
type Rule = {
  key: string;
  version: number;
  title: string;
  clinical_domain: string;
  subdomain: string;
  rule_type: string;
  recommendation_category: string;
  test_status: string;
  latest_test_status: string | null;
  author: string;
  lifecycle_state: string;
  lifecycle_actor: string | null;
  review_due_date: string | null;
  definition: {
    output?: { recommendation?: string };
    trigger?: Record<string, unknown>;
  };
  evidence: Array<{
    evidence_key: string;
    evidence_version: string;
    relationship: string;
  }>;
};
type GovernanceData = {
  siteId: string;
  capabilities: {
    maker: boolean;
    reviewer: boolean;
    technicalAdmin: boolean;
  };
  evidence: Evidence[];
  rules: Rule[];
  reviews: Array<{
    rule_key: string;
    rule_version: number;
    outcome: string;
    reviewer: string;
    comments: string;
    created_at: string;
  }>;
  guidelinePreferences: Array<{
    clinical_domain: string;
    organization: string;
    priority: number;
    rationale: string;
  }>;
  sitePolicies: Array<{
    category: string;
    key: string;
    version: number;
    value: unknown;
    status: string;
  }>;
  evidenceReviewQueue: Array<{
    review_id: string;
    evidence_key: string;
    evidence_version: string;
    reason: string;
    created_at: string;
  }>;
};

const lifecycleActions: Record<string, string[]> = {
  DRAFT: ["submit"],
  CHANGES_REQUESTED: ["submit"],
  CLINICAL_REVIEW: ["approve", "request_changes", "reject"],
  APPROVED: ["publish"],
  PUBLISHED: ["suspend", "supersede", "retire"],
  SUSPENDED: ["supersede", "retire"],
};
const actionLabels: Record<string, string> = {
  submit: "Submit for review",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  publish: "Publish",
  suspend: "Suspend",
  supersede: "Supersede",
  retire: "Retire",
};
const reviewChecklist = [
  ["logic", "Rule logic"],
  ["population", "Patient population"],
  ["thresholds", "Thresholds and timing"],
  ["exclusions", "Exclusions and contraindications"],
  ["evidence", "Evidence version and strength"],
  ["monitoring", "Monitoring and follow-up"],
  ["tests", "Automated tests"],
] as const;

export function ClinicalGovernance() {
  const [revision, setRevision] = useState(0),
    [tab, setTab] = useState("Evidence catalogue"),
    [draft, setDraft] = useState<Rule | null | "new">(null),
    [action, setAction] = useState<{ rule: Rule; action: string } | null>(null),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const { data, error: loadError } = useData<GovernanceData>(
    "/clinical-governance",
    revision,
  );
  const currentRules = useMemo(() => {
    const latest = new Map<string, Rule>();
    for (const rule of data?.rules ?? [])
      if (!latest.has(rule.key)) latest.set(rule.key, rule);
    return [...latest.values()];
  }, [data]);
  function changed(message: string) {
    setNotice(message);
    setError("");
    setDraft(null);
    setAction(null);
    setRevision((value) => value + 1);
  }
  if (!data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError ? <Loading /> : null}
      </>
    );
  const reviewCount = currentRules.filter((rule) =>
    ["CLINICAL_REVIEW", "APPROVED"].includes(rule.lifecycle_state),
  ).length;
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">CLINICAL GOVERNANCE</span>
          <h1>Evidence & rule publication</h1>
          <p>
            Versioned evidence, independent clinical review, immutable rule
            publication and patient-level traceability.
          </p>
        </div>
        <Badge tone="active">
          <ShieldCheck size={14} /> Maker-checker enforced
        </Badge>
      </div>
      <ErrorBox message={error || loadError} />
      {notice ? (
        <div className="success" role="status">
          <CheckCircle2 size={18} /> {notice}
        </div>
      ) : null}
      <div className="governance-summary">
        <div>
          <BookOpen size={19} />
          <strong>{data.evidence.length}</strong>
          <span>versioned sources</span>
        </div>
        <div>
          <FileCheck2 size={19} />
          <strong>
            {
              currentRules.filter(
                (rule) => rule.lifecycle_state === "PUBLISHED",
              ).length
            }
          </strong>
          <span>published rules</span>
        </div>
        <div>
          <Clock3 size={19} />
          <strong>{reviewCount}</strong>
          <span>awaiting review</span>
        </div>
        <div>
          <AlertTriangle size={19} />
          <strong>
            {data.evidence.filter((source) => source.reviewDue).length +
              data.evidenceReviewQueue.length}
          </strong>
          <span>evidence review items</span>
        </div>
      </div>
      <div
        className="care-tabs"
        role="tablist"
        aria-label="Governance sections"
      >
        {["Evidence catalogue", "Rule publication", "Local configuration"].map(
          (item) => (
            <button
              key={item}
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      {tab === "Evidence catalogue" ? (
        <EvidenceCatalogue data={data} />
      ) : tab === "Rule publication" ? (
        <section className="panel care-section">
          <SectionTitle
            title="Clinical rule versions"
            subtitle="Only independently reviewed, approved and published versions can execute for patients."
            action={
              data.capabilities.maker ? (
                <button className="primary" onClick={() => setDraft("new")}>
                  <Plus size={16} /> New governed draft
                </button>
              ) : null
            }
          />
          {currentRules.length ? (
            <div className="rule-list">
              {currentRules.map((rule) => {
                const review = data.reviews.find(
                  (item) =>
                    item.rule_key === rule.key &&
                    item.rule_version === rule.version,
                );
                return (
                  <article
                    className="rule-card"
                    key={`${rule.key}-${rule.version}`}
                  >
                    <div className="rule-card-head">
                      <div>
                        <span className="eyebrow">
                          {rule.clinical_domain.replaceAll("_", " ")}
                        </span>
                        <h3>{rule.title}</h3>
                        <p>
                          {rule.key} · version {rule.version} ·{" "}
                          {rule.rule_type.replaceAll("_", " ")}
                        </p>
                      </div>
                      <Badge
                        tone={
                          rule.lifecycle_state === "PUBLISHED"
                            ? "active"
                            : "draft"
                        }
                      >
                        {rule.lifecycle_state.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p>{rule.definition.output?.recommendation}</p>
                    <div className="rule-meta">
                      <span>
                        Category{" "}
                        <strong>
                          {rule.recommendation_category.replaceAll("_", " ")}
                        </strong>
                      </span>
                      <span>
                        Tests{" "}
                        <strong>
                          {rule.latest_test_status ?? rule.test_status}
                        </strong>
                      </span>
                      <span>
                        Maker <strong>{rule.author}</strong>
                      </span>
                      <span>
                        Checker{" "}
                        <strong>{review?.reviewer ?? "Not reviewed"}</strong>
                      </span>
                      <span>
                        Next review{" "}
                        <strong>
                          {rule.review_due_date
                            ? date(rule.review_due_date)
                            : "Not set"}
                        </strong>
                      </span>
                    </div>
                    <details>
                      <summary>Evidence and publication detail</summary>
                      <ul>
                        {rule.evidence.map((reference) => (
                          <li
                            key={`${reference.evidence_key}-${reference.evidence_version}`}
                          >
                            {reference.relationship}: {reference.evidence_key}{" "}
                            {reference.evidence_version}
                          </li>
                        ))}
                      </ul>
                      {review ? (
                        <p>
                          Latest review: {review.outcome} — {review.comments}
                        </p>
                      ) : null}
                    </details>
                    <div className="rule-actions">
                      {data.capabilities.maker &&
                      ["DRAFT", "CHANGES_REQUESTED"].includes(
                        rule.lifecycle_state,
                      ) ? (
                        <button
                          className="secondary"
                          onClick={() => setDraft(rule)}
                        >
                          Edit as new version
                        </button>
                      ) : null}
                      {(lifecycleActions[rule.lifecycle_state] ?? []).map(
                        (item) => {
                          const allowed =
                            item === "submit"
                              ? data.capabilities.maker
                              : data.capabilities.reviewer;
                          return allowed ? (
                            <button
                              key={item}
                              className={
                                item === "publish" ? "primary" : "secondary"
                              }
                              onClick={() => setAction({ rule, action: item })}
                            >
                              {actionLabels[item]}
                            </button>
                          ) : null;
                        },
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <Empty title="No clinical rules have been created">
              The evidence catalogue is ready. Disease rules will be added only
              through a clinically reviewed later stage.
            </Empty>
          )}
        </section>
      ) : (
        <LocalConfiguration data={data} />
      )}
      {draft ? (
        <DraftRuleModal
          original={draft === "new" ? null : draft}
          evidence={data.evidence}
          onClose={() => setDraft(null)}
          onCreated={() => changed("Immutable draft version created.")}
          onError={setError}
        />
      ) : null}
      {action ? (
        <RuleActionModal
          value={action}
          onClose={() => setAction(null)}
          onSaved={() =>
            changed(
              `Rule ${actionLabels[action.action].toLowerCase()} recorded.`,
            )
          }
          onError={setError}
        />
      ) : null}
    </>
  );
}

function EvidenceCatalogue({ data }: { data: GovernanceData }) {
  return (
    <section className="panel care-section">
      <SectionTitle
        title="Evidence source catalogue"
        subtitle="Metadata and authoritative links only. Guideline text is not copied into CardioFlow."
      />
      <div className="evidence-list">
        {data.evidence.map((source) => (
          <article key={`${source.key}-${source.version}`}>
            <div>
              <span className="eyebrow">
                {source.organization} · {source.topic.replaceAll("_", " ")}
              </span>
              <h3>{source.title}</h3>
              <p>
                Version {source.version}
                {source.publication_year ? ` · ${source.publication_year}` : ""}
                {source.last_verified_at
                  ? ` · verified ${date(source.last_verified_at)}`
                  : ""}
              </p>
            </div>
            <div className="evidence-status">
              <Badge
                tone={
                  source.lifecycle_status === "current" ? "active" : "warning"
                }
              >
                {source.lifecycle_status.replaceAll("_", " ")}
              </Badge>
              {source.reviewDue ? (
                <Badge tone="warning">Review due</Badge>
              ) : null}
              {source.authoritative_url ? (
                <a
                  href={source.authoritative_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Authoritative source
                </a>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LocalConfiguration({ data }: { data: GovernanceData }) {
  return (
    <div className="summary-grid governance-config">
      <section className="panel care-section">
        <SectionTitle
          title="Preferred guideline frameworks"
          subtitle={`Site-scoped configuration for ${data.siteId}. Alternative major guidance remains representable.`}
        />
        {data.guidelinePreferences.map((item) => (
          <div
            className="policy-row"
            key={`${item.clinical_domain}-${item.organization}`}
          >
            <span>
              <strong>{item.clinical_domain.replaceAll("_", " ")}</strong>
              <small>{item.rationale}</small>
            </span>
            <Badge>
              #{item.priority} {item.organization}
            </Badge>
          </div>
        ))}
      </section>
      <section className="panel care-section">
        <SectionTitle
          title="Institutional policy layer"
          subtitle="Formulary, laboratory, referral and service availability are stored separately from evidence."
        />
        {data.sitePolicies.length ? (
          data.sitePolicies.map((item) => (
            <div
              className="policy-row"
              key={`${item.category}-${item.key}-${item.version}`}
            >
              <span>
                <strong>{item.key}</strong>
                <small>
                  {item.category.replaceAll("_", " ")} · version {item.version}
                </small>
              </span>
              <Badge>{item.status}</Badge>
            </div>
          ))
        ) : (
          <Empty title="No local policy values configured">
            Evidence remains independent from formulary and local service
            availability.
          </Empty>
        )}
      </section>
    </div>
  );
}

function DraftRuleModal({
  original,
  evidence,
  onClose,
  onCreated,
  onError,
}: {
  original: Rule | null;
  evidence: Evidence[];
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget),
      source = String(form.get("evidence")).split("|"),
      key = original?.key ?? String(form.get("key"));
    try {
      await api("/clinical-governance/rules", {
        key,
        title: String(form.get("title")),
        clinical_domain: String(form.get("clinical_domain")),
        subdomain: String(form.get("subdomain") || ""),
        rule_type: String(form.get("rule_type")),
        patient_population: {},
        trigger: {
          kind: "fact",
          conceptCode: String(form.get("concept_code")),
          operator: "exists",
        },
        required: [],
        optional_supporting_data: [],
        exclusions: [],
        contraindications: [],
        cautions: [],
        recommendation: String(form.get("recommendation")),
        urgency: "routine",
        recommendation_category: String(form.get("category")),
        alert_severity: "information",
        priority: 4,
        conflict_group: null,
        follow_up_implications: {},
        recommendation_class: null,
        evidence_level: null,
        evidence_strength: null,
        evidence: [
          { key: source[0], version: source[1], relationship: "primary" },
        ],
        review_due_date: String(form.get("review_due_date")),
        test_status: "not_run",
        changelog: String(form.get("changelog")),
        previous_version: original?.version ?? null,
        fixture: false,
      });
      onCreated();
    } catch (caught) {
      onError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        original ? "Create revised draft version" : "Create governed rule draft"
      }
      onClose={onClose}
      wide
    >
      <p className="modal-intro">
        This creates an immutable draft. It cannot execute until independent
        clinical review, passing tests, approval and publication.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Rule key
            <input
              name="key"
              required
              disabled={!!original}
              defaultValue={original?.key}
              pattern="[a-z0-9][a-z0-9._-]{2,119}"
            />
          </label>
          <label>
            Rule title
            <input name="title" required defaultValue={original?.title} />
          </label>
          <label>
            Clinical domain
            <input
              name="clinical_domain"
              required
              defaultValue={original?.clinical_domain}
            />
          </label>
          <label>
            Subdomain
            <input name="subdomain" defaultValue={original?.subdomain} />
          </label>
          <label>
            Rule type
            <select
              name="rule_type"
              defaultValue={original?.rule_type ?? "diagnosis_support"}
            >
              {[
                "diagnosis_support",
                "treatment_opportunity",
                "contraindication",
                "caution",
                "medication_monitoring",
                "investigation_indication",
                "follow_up_timing",
                "laboratory_monitoring",
                "risk_assessment",
                "preventive_care",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Presentation category
            <select
              name="category"
              defaultValue={
                original?.recommendation_category ?? "informational"
              }
            >
              {[
                "critical",
                "warning",
                "monitoring",
                "clinical_review",
                "treatment_opportunity",
                "informational",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Trigger concept
            <input
              name="concept_code"
              required
              defaultValue={String(
                original?.definition.trigger?.conceptCode ?? "",
              )}
              placeholder="e.g. investigation.example"
            />
            <small>
              This initial editor creates an “exists” trigger; complex logic
              remains versioned in the API.
            </small>
          </label>
          <label className="span-2">
            Recommendation text
            <textarea
              name="recommendation"
              required
              defaultValue={original?.definition.output?.recommendation}
            />
          </label>
          <label>
            Primary evidence
            <select name="evidence" required>
              {evidence.map((source) => (
                <option
                  key={`${source.key}-${source.version}`}
                  value={`${source.key}|${source.version}`}
                >
                  {source.organization} · {source.title} · {source.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Next clinical review
            <input
              name="review_due_date"
              type="date"
              min={currentDate()}
              required
            />
          </label>
          <label className="span-2">
            Version changelog
            <textarea
              name="changelog"
              required
              placeholder="Describe the clinical and logic changes in this version"
            />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create immutable draft"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RuleActionModal({
  value,
  onClose,
  onSaved,
  onError,
}: {
  value: { rule: Rule; action: string };
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget),
      checklist = Object.fromEntries(
        reviewChecklist.map(([key]) => [
          key,
          form.get(`check-${key}`) === "on",
        ]),
      );
    try {
      await api(
        `/clinical-governance/rules/${value.rule.key}/${value.rule.version}/actions`,
        {
          action: value.action,
          comment: String(form.get("comment")),
          checklist: value.action === "approve" ? checklist : {},
        },
      );
      onSaved();
    } catch (caught) {
      onError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${actionLabels[value.action]} · ${value.rule.title}`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {value.action === "approve" ? (
          <fieldset className="review-checklist">
            <legend>Independent clinical review</legend>
            {reviewChecklist.map(([key, label]) => (
              <label key={key}>
                <input name={`check-${key}`} type="checkbox" required /> {label}{" "}
                reviewed
              </label>
            ))}
          </fieldset>
        ) : null}
        <label>
          Governance comment
          <textarea
            name="comment"
            required
            minLength={2}
            placeholder="Record the reason and material review findings"
          />
        </label>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Recording…" : actionLabels[value.action]}
          </button>
        </div>
      </form>
    </Modal>
  );
}
