/**
 * Every act a person can take on a commitment, as one dialog. Each form asks
 * only for judgment the ledger cannot supply — a reason, a choice, a date — and
 * prefills the rest from the record. The runtime decides; the dialog reports
 * what it said, including when a change now waits for someone else.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  type AskAct,
  type CommitmentView,
  deliveryResolutions,
  describeProtection,
  type EvidenceRequirement,
  isLive,
  isWatchable,
  precedentsFor,
  subjectOf,
  type RealizedValue,
  type Resolution,
  resolutions,
  type Result,
  readableBy,
  textCeiling,
  verifyOutcome,
} from '@forge/kernel';
import { useForge, useForgeQuery } from '../../forge/ForgeContext';
import { LessonsThatMayApply } from './Precedents';
import { Checkbox, Field, Modal, Select, TextArea, TextInput } from '../ui/form';
import { Button, Notice } from '../ui/primitives';
import { fmtDate, fmtQuantity, humanize } from '../../lib/format';
import { ACT_LABELS } from './acts';
import { RequirementTag } from './tags';

type Props = { view: CommitmentView; act: AskAct; subject?: string | null; onClose: () => void };

export function ActionDialog({ view, act, subject = null, onClose }: Props) {
  const { act: run, demo, reader } = useForge();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = view.record.id;

  async function submit<T>(fn: Parameters<typeof run<T>>[0], success: (v: T) => string | null) {
    setPending(true);
    setError(null);
    const r: Result<T> = await run(fn);
    setPending(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    const note = success(r.value);
    if (note) setDone(note);
    else onClose();
  }

  const title = { ...ACT_LABELS, CLOSE: 'Close the commitment', REQUEST_CHANGE: 'Change the promise' }[act];
  const kicker = view.terms.statement.length > 70 ? `${view.terms.statement.slice(0, 70)}…` : view.terms.statement;

  if (done) {
    return (
      <Modal title="Recorded" kicker={kicker} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <Notice tone="emerald">{done}</Notice>
      </Modal>
    );
  }

  const footer = (submitLabel: string, onSubmit: () => void, disabled = false, extra?: ReactNode) => (
    <>
      <Button variant="quiet" onClick={onClose}>
        Cancel
      </Button>
      {extra}
      <Button variant="primary" disabled={pending || disabled} onClick={onSubmit}>
        {pending ? 'Recording…' : submitLabel}
      </Button>
    </>
  );

  const body = (() => {
    switch (act) {
      case 'ACCEPT':
        return <AcceptForm view={view} onSubmit={(evidence, reason) => submit((s, d) => d.runtime.accept(s, id, { evidence, reason }), () => null)} footer={footer} />;
      case 'DECLINE':
        return <ReasonForm placeholder="What would have to change for you to take it on?" submitLabel="Decline" footer={footer} onSubmit={(reason) => submit((s, d) => d.runtime.decline(s, id, reason), () => null)} />;
      case 'DECIDE_CHANGE':
        return <DecideForm view={view} subject={subject} footer={footer} onSubmit={(requestId, decision, reason) => submit((s, d) => d.runtime.decideChange(s, id, requestId, decision, reason), () => null)} />;
      case 'REQUEST_CHANGE':
        return (
          <ChangeForm
            view={view}
            footer={footer}
            onSubmit={(change, reason) =>
              submit(
                (s, d) => d.runtime.change(s, id, change, reason),
                (r) => (r.applied ? null : `Asked of ${view.terms.principal.label}. The change takes effect when they approve it; until then the promise stands as it is.`),
              )
            }
          />
        );
      case 'CLOSE':
        return (
          <CloseForm
            view={view}
            footer={footer}
            onSubmit={(resolution, reason, confirmed, supersededBy) =>
              submit(
                (s, d) => d.runtime.close(s, id, { resolution, confirmedWithoutEvidence: confirmed, supersededBy }, reason),
                (r) => (r.applied ? null : `Withdrawing a promise is ${view.terms.principal.label}’s call — asked of them.`),
              )
            }
          />
        );
      case 'RECORD_EVIDENCE':
        return <EvidenceForm view={view} subject={subject} footer={footer} onSubmit={(input) => submit((s, d) => d.runtime.recordEvidence(s, id, input), () => null)} />;
      case 'DISPUTE_EVIDENCE':
        return <DisputeForm view={view} subject={subject} footer={footer} onSubmit={(evidenceId, reason) => submit((s, d) => d.runtime.disputeEvidence(s, id, evidenceId, reason), () => null)} />;
      case 'REAFFIRM': {
        const cc = view.contextChanges.find((c) => c.eventId === subject) ?? view.contextChanges.find((c) => c.material && c.reaffirmed === null);
        return (
          <>
            {cc && <p className="mb-4 text-read text-ink-800">{cc.statement}</p>}
            <ReasonForm placeholder="Why the commitment still stands" submitLabel="Reaffirm" footer={footer} onSubmit={(reason) => cc && submit((s, d) => d.runtime.reaffirm(s, id, cc.eventId, reason), () => null)} />
          </>
        );
      }
      case 'SETTLE_DEPENDENCY':
        return <SettleForm view={view} subject={subject} footer={footer} onSubmit={(key, reason) => submit((s, d) => d.runtime.settleDependency(s, id, key, { observationId: null, reason }), () => null)} />;
      case 'RECORD_OUTCOME':
        return <OutcomeForm view={view} footer={footer} demoLedger={demo.ledger} onSubmit={(outcome) => submit((s, d) => d.runtime.recordOutcome(s, id, outcome), () => null)} />;
      case 'RECORD_LEARNING':
        return <LearningForm footer={footer} onSubmit={(input) => submit((s, d) => d.runtime.recordLearning(s, id, input), () => null)} />;
      case 'PUBLISH_OUTCOME':
        return (
          <PublishForm
            view={view}
            footer={footer}
            onSubmit={() =>
              submit(
                (s, d) => d.runtime.publishOutcome(s, id),
                (r) => `Published as ${r.publication.fingerprint}. Helm reads it from Forge; a Helm manager records the outcome review, and Helm’s genome can wrap the episode ${r.publication.episode.ref} by reference.`,
              )
            }
          />
        );
    }
  })();

  // ADR-0017: words written here take the classes this commitment rests on; say so before anyone writes them.
  const ceiling = readableBy(reader.scope.clearances, textCeiling(view.record, view.events));

  return (
    <Modal title={title} kicker={kicker} onClose={onClose}>
      {error && (
        <div className="mb-4">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      {ceiling.length > 0 && act !== 'RECORD_EVIDENCE' && act !== 'RECORD_OUTCOME' && act !== 'PUBLISH_OUTCOME' && (
        <div className="mb-4">
          <Notice>This commitment rests on {describeProtection(ceiling)} values, so what you write here is sealed with them and shown only to people Helm has cleared.</Notice>
        </div>
      )}
      {body}
    </Modal>
  );
}

type Footer = (label: string, onSubmit: () => void, disabled?: boolean, extra?: ReactNode) => ReactNode;

function FormFooter({ children }: { children: ReactNode }) {
  return <div className="-mx-6 -mb-5 mt-6 flex justify-end gap-2 border-t border-ink-200 px-6 py-4">{children}</div>;
}

function ReasonForm({ placeholder, submitLabel, footer, onSubmit }: { placeholder: string; submitLabel: string; footer: Footer; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <>
      <Field label="Why">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
      </Field>
      <FormFooter>{footer(submitLabel, () => onSubmit(reason), reason.trim() === '')}</FormFooter>
    </>
  );
}

function AcceptForm({ view, footer, onSubmit }: { view: CommitmentView; footer: Footer; onSubmit: (evidence: EvidenceRequirement[] | undefined, reason: string | null) => void }) {
  const [refs, setRefs] = useState<Record<string, string>>(() => Object.fromEntries(view.terms.evidence.map((r) => [r.key, r.matcher?.objectRef ?? ''])));
  // What the enterprise learned the last time — read before taking this on, not after.
  const reading = useForgeQuery(async (d, scope) => {
    const all = await d.runtime.list(scope);
    return all.ok ? precedentsFor(subjectOf(view), all.value) : null;
  }, [view.record.id]);
  const inferred = view.capture.evidence === 'INFERRED';
  const changed = view.terms.evidence.some((r) => r.matcher && (refs[r.key] ?? '') !== (r.matcher.objectRef ?? ''));
  const evidence = view.terms.evidence.map((r) => (r.matcher && refs[r.key] ? { ...r, matcher: { ...r.matcher, objectRef: refs[r.key].trim() } } : r));
  return (
    <>
      <p className="mb-4 text-read text-ink-800">
        You promise <strong className="font-medium">{view.terms.principal.label}</strong>: {view.terms.intendedOutcome} By <span className="font-mono text-meta">{fmtDate(view.terms.dueBy)}</span>.
      </p>
      {reading && <div className="mb-4"><LessonsThatMayApply reading={reading} /></div>}
      <p className="forge-label mb-2">What will prove it{inferred ? ' — inferred by Forge, confirm or name the object' : ''}</p>
      <div className="mb-4 divide-y divide-ink-200 border-y border-ink-200">
        {view.terms.evidence.map((r) => (
          <div key={r.key} className="py-3">
            <p className="text-dense text-ink-900">{r.description}</p>
            {r.matcher ? (
              <>
                <p className="forge-meta mt-0.5">
                  {r.matcher.system} · {r.matcher.eventType}
                </p>
                <div className="mt-2">
                  <TextInput value={refs[r.key] ?? ''} placeholder={`The ${r.matcher.system} object it will be recorded on, e.g. TR-0412`} onChange={(e) => setRefs({ ...refs, [r.key]: e.target.value })} />
                  {!isWatchable(r.matcher) && !(refs[r.key] ?? '').trim() && (
                    <p className="mt-1 text-meta text-ink-500">Without an object Forge cannot tell this record from any other, and will not watch for it.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="forge-meta mt-0.5">Confirmed by a person — no system Forge observes records this.</p>
            )}
          </div>
        ))}
      </div>
      <FormFooter>{footer('Accept the commitment', () => onSubmit(changed ? evidence : undefined, null))}</FormFooter>
    </>
  );
}

function DecideForm({ view, subject, footer, onSubmit }: { view: CommitmentView; subject: string | null; footer: Footer; onSubmit: (requestId: string, decision: 'APPROVED' | 'REJECTED', reason: string | null) => void }) {
  const req = view.changeRequests.find((r) => r.requestId === subject) ?? view.changeRequests.find((r) => r.decided === null);
  const [reason, setReason] = useState('');
  if (!req) return <p className="forge-caveat">No change is waiting for a decision.</p>;
  const what =
    req.change.kind === 'REDATE'
      ? `Move the due date from ${fmtDate(view.terms.dueBy)} to ${fmtDate(req.change.dueBy)}.`
      : req.change.kind === 'REASSIGN'
        ? `Hand the commitment to ${req.change.owner.label}.`
        : req.change.kind === 'CLOSE'
          ? `Close it as ${humanize(req.change.resolution).toLowerCase()}.`
          : 'Change what is promised.';
  return (
    <>
      <p className="forge-label mb-1">{req.requestedBy.label} asks</p>
      <p className="mb-2 text-read text-ink-900">{what}</p>
      {req.reason && <p className="forge-caveat mb-4">“{req.reason}”</p>}
      {view.originalDueBy !== view.terms.dueBy && req.change.kind === 'REDATE' && (
        <p className="mb-4 text-meta text-ink-500">First promised for {fmtDate(view.originalDueBy)}; Forge keeps that date whatever you decide.</p>
      )}
      <Field label="Your reason" hint="Required to reject; kept with the decision either way.">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormFooter>
        {footer('Approve', () => onSubmit(req.requestId, 'APPROVED', reason.trim() || null), false, (
          <Button variant="danger" disabled={reason.trim() === ''} onClick={() => onSubmit(req.requestId, 'REJECTED', reason)}>
            Reject
          </Button>
        ))}
      </FormFooter>
    </>
  );
}

type ChangeKindChoice = 'REDATE' | 'REASSIGN' | 'RESCOPE' | 'WITHDRAW';

function ChangeForm({ view, footer, onSubmit }: { view: CommitmentView; footer: Footer; onSubmit: (change: Parameters<ReturnType<typeof useForge>['demo']['runtime']['change']>[2], reason: string) => void }) {
  const [kind, setKind] = useState<ChangeKindChoice>('REDATE');
  const [dueBy, setDueBy] = useState(view.terms.dueBy);
  const [owner, setOwner] = useState('');
  const [statement, setStatement] = useState(view.terms.statement);
  const [outcome, setOutcome] = useState(view.terms.intendedOutcome);
  const [withdraw, setWithdraw] = useState<Resolution>('CANCELLED');
  const [reason, setReason] = useState('');
  const change = (() => {
    switch (kind) {
      case 'REDATE':
        return { kind: 'REDATE' as const, dueBy };
      case 'REASSIGN':
        return { kind: 'REASSIGN' as const, owner: { kind: 'ROLE' as const, label: owner.trim(), ref: null } };
      case 'RESCOPE':
        return {
          kind: 'RESCOPE' as const,
          statement: statement !== view.terms.statement ? statement : null,
          intendedOutcome: outcome !== view.terms.intendedOutcome ? outcome : null,
          evidence: null,
          measures: null,
        };
      case 'WITHDRAW':
        return { kind: 'CLOSE' as const, resolution: withdraw, supersededBy: null, confirmedWithoutEvidence: false };
    }
  })();
  return (
    <>
      <Field label="What changes">
        <Select value={kind} onChange={(e) => setKind(e.target.value as ChangeKindChoice)}>
          <option value="REDATE">A new due date</option>
          <option value="REASSIGN">Someone else owns it</option>
          <option value="RESCOPE">What is promised</option>
          <option value="WITHDRAW">Withdraw the promise</option>
        </Select>
      </Field>
      {kind === 'REDATE' && (
        <Field label="New due date" hint={`Currently ${fmtDate(view.terms.dueBy)}${view.originalDueBy !== view.terms.dueBy ? `; first promised ${fmtDate(view.originalDueBy)}` : ''}.`}>
          <TextInput type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} />
        </Field>
      )}
      {kind === 'REASSIGN' && (
        <Field label="New owner" hint="They will be asked to accept it; ownership is not assignment.">
          <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Logistics Manager HCMC" />
        </Field>
      )}
      {kind === 'RESCOPE' && (
        <>
          <Field label="The promise">
            <TextArea value={statement} onChange={(e) => setStatement(e.target.value)} />
          </Field>
          <Field label="What changes in the world">
            <TextArea value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          </Field>
        </>
      )}
      {kind === 'WITHDRAW' && (
        <Field label="How it ends">
          <Select value={withdraw} onChange={(e) => setWithdraw(e.target.value as Resolution)}>
            <option value="CANCELLED">Cancelled</option>
            <option value="ABANDONED">Intentionally abandoned</option>
            {view.contextChanges.some((c) => c.material) && <option value="INVALIDATED">Invalidated by what changed</option>}
          </Select>
        </Field>
      )}
      <Field label="Why">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormFooter>{footer('Record the change', () => onSubmit(change, reason), reason.trim() === '' || (kind === 'REASSIGN' && owner.trim() === ''))}</FormFooter>
    </>
  );
}

function CloseForm({ view, footer, onSubmit }: { view: CommitmentView; footer: Footer; onSubmit: (resolution: Resolution, reason: string, confirmed: boolean, supersededBy: string | null) => void }) {
  const delivery = view.phase === 'ACTIVE';
  const options = resolutions.filter((r) => (delivery ? true : !deliveryResolutions.includes(r)) && r !== 'SUPERSEDED');
  const [resolution, setResolution] = useState<Resolution>(options[0]);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const required = view.requirements.filter((r) => r.requirement.required);
  const missing = required.filter((r) => r.status !== 'EVIDENCED');
  return (
    <>
      <Field label="How it ended" hint="Delay and rescoping are not endings; they stay on the record as variance.">
        <Select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
          {options.map((r) => (
            <option key={r} value={r}>
              {humanize(r)}
            </option>
          ))}
        </Select>
      </Field>
      {resolution === 'FULFILLED' && (
        <div className="mb-4 divide-y divide-ink-200 border-y border-ink-200">
          {required.map((r) => (
            <div key={r.requirement.key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-dense text-ink-800">{r.requirement.description}</span>
              <RequirementTag value={r.status} />
            </div>
          ))}
        </div>
      )}
      {resolution === 'FULFILLED' && missing.length > 0 && (
        <Checkbox checked={confirmed} onChange={setConfirmed}>
          Close it on my own confirmation. The record will say that no system proved it.
        </Checkbox>
      )}
      <Field label="Why">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened, in a sentence — whoever reads this later will need it." />
      </Field>
      <FormFooter>{footer('Close', () => onSubmit(resolution, reason, confirmed, null), reason.trim() === '')}</FormFooter>
    </>
  );
}

function EvidenceForm({ view, subject, footer, onSubmit }: { view: CommitmentView; subject: string | null; footer: Footer; onSubmit: (input: Parameters<ReturnType<typeof useForge>['demo']['runtime']['recordEvidence']>[2]) => void }) {
  const { demo } = useForge();
  const [requirementKey, setRequirementKey] = useState<string>(subject ?? view.terms.evidence[0]?.key ?? '');
  const [stance, setStance] = useState<'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT'>('SUPPORTS');
  const [channel, setChannel] = useState<'HUMAN_CONFIRMATION' | 'DOCUMENT' | 'COMMUNICATION'>('HUMAN_CONFIRMATION');
  const [statement, setStatement] = useState('');
  const [ref, setRef] = useState('');
  return (
    <>
      <Field label="It bears on">
        <Select value={requirementKey} onChange={(e) => setRequirementKey(e.target.value)}>
          {view.terms.evidence.map((r) => (
            <option key={r.key} value={r.key}>
              {r.description}
            </option>
          ))}
          <option value="">Context only</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="It">
          <Select value={stance} onChange={(e) => setStance(e.target.value as typeof stance)}>
            <option value="SUPPORTS">Supports it</option>
            <option value="CONTRADICTS">Contradicts it</option>
            <option value="CONTEXT">Gives context</option>
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option value="HUMAN_CONFIRMATION">My confirmation</option>
            <option value="DOCUMENT">A document</option>
            <option value="COMMUNICATION">A message or call</option>
          </Select>
        </Field>
      </div>
      <Field label="What it shows">
        <TextArea value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>
      <Field label="Where it lives" hint="A document, message or record id, if there is one.">
        <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <p className="mb-2 text-meta text-ink-500">Recorded as a fact, attributed to you. A system’s own record, when it arrives, is shown beside it — and if they disagree, Forge asks.</p>
      <FormFooter>
        {footer(
          'Record',
          () =>
            onSubmit({
              requirementKey: requirementKey || null,
              stance,
              epistemic: 'FACT',
              channel,
              source: { system: 'manual', ref: ref.trim() || null, url: null },
              statement,
              observedAt: demo.clock.now(),
              confidence: null,
              observationId: null,
            }),
          statement.trim() === '',
        )}
      </FormFooter>
    </>
  );
}

function DisputeForm({ view, subject, footer, onSubmit }: { view: CommitmentView; subject: string | null; footer: Footer; onSubmit: (evidenceId: string, reason: string) => void }) {
  const live = view.evidence.filter(isLive);
  const preferred = live.find((e) => e.item.requirementKey === subject && e.item.channel === 'HUMAN_CONFIRMATION') ?? live.find((e) => e.item.requirementKey === subject) ?? live[0];
  const [evidenceId, setEvidenceId] = useState(preferred?.item.id ?? '');
  const [reason, setReason] = useState('');
  return (
    <>
      <Field label="Evidence that is wrong" hint="It stays on the record with your reason, and stops counting.">
        <Select value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
          {live.map((e) => (
            <option key={e.item.id} value={e.item.id}>
              {e.item.source.system} — {e.item.statement.slice(0, 80)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Why it is wrong">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormFooter>{footer('Dispute', () => onSubmit(evidenceId, reason), reason.trim() === '' || !evidenceId)}</FormFooter>
    </>
  );
}

function SettleForm({ view, subject, footer, onSubmit }: { view: CommitmentView; subject: string | null; footer: Footer; onSubmit: (key: string, reason: string) => void }) {
  const open = view.dependencies.filter((d) => d.settled === null && d.dependency.on.kind !== 'COMMITMENT');
  const [key, setKey] = useState(subject ?? open[0]?.dependency.key ?? '');
  const [reason, setReason] = useState('');
  return (
    <>
      <Field label="Dependency">
        <Select value={key} onChange={(e) => setKey(e.target.value)}>
          {open.map((d) => (
            <option key={d.dependency.key} value={d.dependency.key}>
              {d.dependency.description}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="How you know" hint="If a system will record it, Forge settles it on its own when the record arrives.">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <FormFooter>{footer('Settle', () => onSubmit(key, reason), reason.trim() === '' || !key)}</FormFooter>
    </>
  );
}

const EFFECTS: RealizedValue['effect'][] = ['CREATED', 'PROTECTED', 'DELAYED', 'DESTROYED', 'NONE', 'UNKNOWN'];

function OutcomeForm({ view, footer, onSubmit, demoLedger }: { view: CommitmentView; footer: Footer; onSubmit: (o: Parameters<ReturnType<typeof useForge>['demo']['runtime']['recordOutcome']>[2]) => void; demoLedger: ReturnType<typeof useForge>['demo']['ledger'] }) {
  // Actuals already observed by a system are offered, not retyped.
  const observed = useMemo(() => {
    const byObs = new Map(demoLedger.entries().map((e) => [e.observation.id, e.observation]));
    const out: Record<string, string> = {};
    for (const m of view.terms.measures) {
      const ev = view.evidence.find((e) => isLive(e) && e.item.observationId && byObs.get(e.item.observationId)?.payload.metricKey === m.key);
      const value = ev?.item.observationId ? byObs.get(ev.item.observationId)?.payload.value : undefined;
      if (typeof value === 'string' || typeof value === 'number') out[m.key] = String(value);
    }
    return out;
  }, [view, demoLedger]);
  const [statement, setStatement] = useState('');
  const [achievedOn, setAchievedOn] = useState('');
  const [actuals, setActuals] = useState<Record<string, string>>(observed);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [effects, setEffects] = useState<Record<string, RealizedValue['effect']>>({});
  const [valueNotes, setValueNotes] = useState<Record<string, string>>({});
  const dims = [...new Set(view.terms.value.map((v) => v.dimension))];
  return (
    <>
      <Field label="What actually happened">
        <TextArea value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>
      <Field label="Achieved on" hint="Leave empty if it was not achieved.">
        <TextInput type="date" value={achievedOn} onChange={(e) => setAchievedOn(e.target.value)} />
      </Field>
      {view.terms.measures.length > 0 && (
        <div className="mb-4">
          <p className="forge-label mb-2">Measures</p>
          {view.terms.measures.map((m) => (
            <div key={m.key} className="grid grid-cols-[1fr_140px] items-center gap-3 border-b border-ink-200 py-2">
              <div>
                <p className="text-dense text-ink-900">{m.label}</p>
                <p className="forge-meta">expected {m.comparator === 'QUALITATIVE' ? (m.statement ?? '—') : fmtQuantity(m.expected, m.unit)}</p>
              </div>
              {m.comparator === 'QUALITATIVE' ? (
                <TextInput placeholder="What you saw" value={notes[m.key] ?? ''} onChange={(e) => setNotes({ ...notes, [m.key]: e.target.value })} />
              ) : (
                <div>
                  <TextInput placeholder="actual" value={actuals[m.key] ?? ''} onChange={(e) => setActuals({ ...actuals, [m.key]: e.target.value })} />
                  {observed[m.key] && <p className="mt-0.5 text-tag text-emerald-800">observed by Helm</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {dims.length > 0 && (
        <div className="mb-4">
          <p className="forge-label mb-2">Value</p>
          {dims.map((d) => (
            <div key={d} className="grid grid-cols-[120px_130px_1fr] items-center gap-2 border-b border-ink-200 py-2">
              <span className="font-mono text-meta text-ink-700">{d.toLowerCase().replace(/_/g, ' ')}</span>
              <Select value={effects[d] ?? 'UNKNOWN'} onChange={(e) => setEffects({ ...effects, [d]: e.target.value as RealizedValue['effect'] })}>
                {EFFECTS.map((x) => (
                  <option key={x} value={x}>
                    {x.toLowerCase()}
                  </option>
                ))}
              </Select>
              <TextInput placeholder="In a sentence" value={valueNotes[d] ?? ''} onChange={(e) => setValueNotes({ ...valueNotes, [d]: e.target.value })} />
            </div>
          ))}
        </div>
      )}
      <FormFooter>
        {footer(
          'Record the outcome',
          () =>
            onSubmit({
              statement,
              achievedOn: achievedOn || null,
              measures: view.terms.measures.map((m) => ({ key: m.key, actual: m.comparator === 'QUALITATIVE' ? null : actuals[m.key]?.trim() || null, note: notes[m.key]?.trim() || null })),
              realizedValue: dims.map((d) => ({ dimension: d, effect: effects[d] ?? 'UNKNOWN', statement: valueNotes[d]?.trim() || 'Not stated.', amount: null, unit: null })),
              basis: view.evidence.filter((e) => isLive(e) && e.item.stance === 'SUPPORTS').map((e) => e.item.id),
            }),
          statement.trim() === '',
        )}
      </FormFooter>
    </>
  );
}

function LearningForm({ footer, onSubmit }: { footer: Footer; onSubmit: (input: { kind: 'EXPLANATION' | 'LESSON'; statement: string; appliesTo: string | null }) => void }) {
  const [kind, setKind] = useState<'EXPLANATION' | 'LESSON'>('LESSON');
  const [statement, setStatement] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  return (
    <>
      <Field label="Kind">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="EXPLANATION">Explanation — why it differed</option>
          <option value="LESSON">Lesson — what to do differently</option>
        </Select>
      </Field>
      <Field label="Statement">
        <TextArea value={statement} onChange={(e) => setStatement(e.target.value)} />
      </Field>
      {kind === 'LESSON' && (
        <Field label="Where it applies next time" hint="In words — Helm’s genome reads it as a candidate pattern, which people review.">
          <TextInput value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="e.g. reallocations of consignment stock" />
        </Field>
      )}
      <FormFooter>{footer('Record', () => onSubmit({ kind, statement, appliesTo: appliesTo.trim() || null }), statement.trim() === '')}</FormFooter>
    </>
  );
}

function PublishForm({ view, footer, onSubmit }: { view: CommitmentView; footer: Footer; onSubmit: () => void }) {
  const verified = verifyOutcome(view);
  if (!verified.ok) return <Notice tone="red">{verified.error.message}</Notice>;
  const p = verified.value;
  return (
    <>
      <p className="mb-3 text-read text-ink-800">
        Helm will read a frozen statement of what was promised, what changed, and what each actual rests on. Forge does not write into Helm; a Helm manager turns it into an outcome review.
      </p>
      <div className="mb-4 divide-y divide-ink-200 border-y border-ink-200">
        {p.measures.map((m) => (
          <div key={m.key} className="flex items-baseline justify-between gap-3 py-2">
            <span className="text-dense text-ink-900">{m.label}</span>
            <span className="text-right font-mono text-meta text-ink-700">
              {m.comparator === 'QUALITATIVE' ? 'stated' : `${fmtQuantity(m.expected, m.unit)} → ${fmtQuantity(m.actual, m.unit)}`}
              <span className="ml-2 text-ink-500">{m.basis.kind === 'SYSTEM' ? 'system record' : m.basis.kind === 'PERSON' ? 'a person’s word' : 'no actual'}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="mb-2 text-meta text-ink-500">
        {humanize(p.resolution)} · {p.explanations.length} explanation{p.explanations.length === 1 ? '' : 's'} · {p.lessons.length} lesson{p.lessons.length === 1 ? '' : 's'} · episode{' '}
        <span className="font-mono">{p.episode.fingerprint}</span>
      </p>
      <FormFooter>{footer('Publish', onSubmit)}</FormFooter>
    </>
  );
}
