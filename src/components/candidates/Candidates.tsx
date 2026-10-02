/**
 * What Forge read — from meeting notes and from Memoire's promises — offered as
 * candidates. A candidate is an inference: it shows the words it rests on, what
 * was proposed and what was not said, and waits for a person. Confirm takes the
 * proposal as read (filling only what the source did not say); Edit opens every
 * term; Dismiss keeps the reason. Nothing here becomes a commitment by itself.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type CandidateView, fail, type Party, type Result, TERM_WORDS, type Terms } from '@forge/kernel';
import { type ExtractionInput, type ExtractionModel, extractCandidates, type GovernedExtraction, type RawExtraction, referenceExtractor } from '@forge/fabric';
import { PEOPLE, QC_REVIEW_NOTES, ROLES } from '@forge/demo';
import { useForge } from '../../forge/ForgeContext';
import { Field, Modal, Select, TextArea, TextInput } from '../ui/form';
import { Button, Empty, Mono, Notice, Tag } from '../ui/primitives';
import { EpistemicTag } from '../commitment/tags';
import { fmtDate } from '../../lib/format';

const PARTIES: readonly Party[] = Object.values(ROLES);
const partyKey = (p: Party) => `${p.kind}:${p.label}`;

/** What the source did not say, which a person must supply before it can be a commitment. */
function missing(c: CandidateView): string[] {
  const p = c.record.proposal;
  return [p.owner ? null : 'owner', p.dueBy ? null : 'due date', p.intendedOutcome ? null : 'intended outcome', 'principal'].filter((x): x is string => x !== null);
}

export function CandidateRow({ candidate, onOpen, onDismiss }: { candidate: CandidateView; onOpen: (mode: 'confirm' | 'edit') => void; onDismiss: () => void }) {
  const { record: r, state, disposition } = candidate;
  const p = r.proposal;
  return (
    <div className="border-b border-ink-200 py-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Tag tone="violet">{r.utteranceClass.toLowerCase()}</Tag>
        <EpistemicTag value={r.epistemic} />
        <span className="text-meta text-ink-500">
          {r.source.label}
          {r.source.locator ? ` · ${r.source.locator}` : ''} · read by <Mono>{r.extractor.name}</Mono>
          {r.extractor.model ? <> (<Mono>{r.extractor.model}</Mono>)</> : null} · confidence {r.confidence.toFixed(2)}
        </span>
      </div>
      {r.source.quote && <blockquote className="border-l-2 border-ink-300 pl-3 font-serif text-[16px] leading-6 text-ink-950">“{r.source.quote}”</blockquote>}
      <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-dense">
        <dt className="forge-label">Proposed</dt>
        <dd className="text-ink-900">{p.statement}</dd>
        <dt className="forge-label">Owner</dt>
        <dd className={p.owner ? 'text-ink-900' : 'text-amber-800'}>{p.owner ? p.owner.label : p.ownerText ? `“${p.ownerText}” — not matched to anyone Forge knows` : 'not said'}</dd>
        <dt className="forge-label">Due</dt>
        <dd className={p.dueBy ? 'text-ink-900' : 'text-amber-800'}>{p.dueBy ? `${fmtDate(p.dueBy)}${p.dueText && p.dueText !== p.dueBy ? ` (“${p.dueText}”)` : ''}` : p.dueText ? `“${p.dueText}” — no date could be read from it` : 'not said'}</dd>
        {p.evidence.length > 0 && (
          <>
            <dt className="forge-label">Evidence</dt>
            <dd className="text-ink-900">{p.evidence.map((e) => e.description).join('; ')}</dd>
          </>
        )}
      </dl>
      {state === 'PENDING' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => onOpen('confirm')}>
            Confirm
          </Button>
          <Button size="sm" onClick={() => onOpen('edit')}>
            Edit
          </Button>
          <Button size="sm" variant="quiet" onClick={onDismiss}>
            Dismiss
          </Button>
          <span className="text-meta text-ink-500">A person still has to say: {missing(candidate).join(', ')}.</span>
        </div>
      ) : (
        <p className="mt-3 text-meta text-ink-600">
          {state === 'CONFIRMED' ? 'Confirmed' : 'Dismissed'} by {disposition?.actor.label} on {fmtDate(disposition?.at)}
          {disposition?.edited.length ? ` — supplied ${disposition.edited.map((f) => TERM_WORDS[f]).join(', ')}` : ''}
          {disposition?.reason ? ` — “${disposition.reason}”` : ''}
          {disposition?.commitmentId && (
            <>
              {' · '}
              <Link to={`/c/${disposition.commitmentId}`}>Open the commitment</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function CandidateList({ candidates, onOpen, onDismiss, emptyText }: { candidates: readonly CandidateView[]; onOpen: (c: CandidateView, mode: 'confirm' | 'edit') => void; onDismiss: (c: CandidateView) => void; emptyText: string }) {
  if (candidates.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <>
      {candidates.map((c) => (
        <CandidateRow key={c.record.id} candidate={c} onOpen={(mode) => onOpen(c, mode)} onDismiss={() => onDismiss(c)} />
      ))}
    </>
  );
}

function PartySelect({ value, onChange }: { value: Party | null; onChange: (p: Party | null) => void }) {
  return (
    <Select value={value ? partyKey(value) : ''} onChange={(e) => onChange(PARTIES.find((p) => partyKey(p) === e.target.value) ?? null)}>
      <option value="">— choose —</option>
      {PARTIES.map((p) => (
        <option key={partyKey(p)} value={partyKey(p)}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}

/** Confirm (fill only what is missing) or Edit (every term). Whatever the person changes is recorded as theirs. */
export function ConfirmCandidateDialog({ candidate, mode, onClose }: { candidate: CandidateView; mode: 'confirm' | 'edit'; onClose: () => void }) {
  const { act, reader } = useForge();
  const r = candidate.record;
  const p = r.proposal;
  const [statement, setStatement] = useState(p.statement);
  const [intendedOutcome, setIntendedOutcome] = useState(p.intendedOutcome ?? '');
  const [why, setWhy] = useState(r.source.kind === 'MEMOIRE_PROMISE' ? 'Promised to the customer in Memoire.' : `Said in ${r.source.label}${r.source.quote ? `: “${r.source.quote}”` : '.'}`);
  const [owner, setOwner] = useState<Party | null>(p.owner);
  const [principal, setPrincipal] = useState<Party | null>(p.principal ?? reader.scope.actsAs[0] ?? null);
  const [dueBy, setDueBy] = useState(p.dueBy ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const all = mode === 'edit';

  async function submit() {
    if (!owner || !principal || !dueBy || !intendedOutcome.trim() || !statement.trim() || !why.trim()) {
      setError('Say who owns it, to whom it is owed, by when, and what changes when it is kept.');
      return;
    }
    const terms: Terms = { statement: statement.trim(), intendedOutcome: intendedOutcome.trim(), why: why.trim(), owner, principal, dueBy, evidence: p.evidence, measures: [], value: [] };
    setPending(true);
    const res: Result<unknown> = await act((s, d) => d.runtime.confirmCandidate(s, r.id, { terms }));
    setPending(false);
    if (!res.ok) setError(res.error.message);
    else onClose();
  }

  return (
    <Modal
      kicker={r.source.label}
      title={mode === 'confirm' ? 'Confirm as a commitment' : 'Edit, then confirm'}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={pending} onClick={() => void submit()}>
            {pending ? 'Recording…' : 'Confirm'}
          </Button>
        </>
      }
    >
      {r.source.quote && <p className="mb-4 border-l-2 border-ink-300 pl-3 font-serif text-[15px] leading-6 text-ink-900">“{r.source.quote}”</p>}
      {all ? (
        <Field label="The promise">
          <TextInput value={statement} onChange={(e) => setStatement(e.target.value)} />
        </Field>
      ) : (
        <p className="mb-4 text-dense text-ink-800">
          <span className="forge-label mr-2">Promise</span>
          {statement}
        </p>
      )}
      {(all || !p.intendedOutcome) && (
        <Field label="What changes when it is kept" hint="The outcome, not the work.">
          <TextArea value={intendedOutcome} onChange={(e) => setIntendedOutcome(e.target.value)} rows={2} />
        </Field>
      )}
      {all && (
        <Field label="Why it matters">
          <TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} />
        </Field>
      )}
      {(all || !p.owner) && (
        <Field label="Owner" hint={p.ownerText && !p.owner ? `The source says “${p.ownerText}”.` : undefined}>
          <PartySelect value={owner} onChange={setOwner} />
        </Field>
      )}
      <Field label="Owed to">
        <PartySelect value={principal} onChange={setPrincipal} />
      </Field>
      {(all || !p.dueBy) && (
        <Field label="Due by" hint={p.dueText && !p.dueBy ? `The source says “${p.dueText}”.` : undefined}>
          <TextInput type="date" value={dueBy} onChange={(e) => setDueBy(e.target.value)} />
        </Field>
      )}
      <p className="text-meta text-ink-500">The owner still accepts it before it is theirs. Forge records which terms you supplied and which came from the source.</p>
      {error && <Notice tone="red">{error}</Notice>}
    </Modal>
  );
}

export function DismissCandidateDialog({ candidate, onClose }: { candidate: CandidateView; onClose: () => void }) {
  const { act } = useForge();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      kicker={candidate.record.source.label}
      title="Not a commitment"
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await act((s, d) => d.runtime.dismissCandidate(s, candidate.record.id, reason));
              if (!r.ok) setError(r.error.message);
              else onClose();
            }}
          >
            Dismiss
          </Button>
        </>
      }
    >
      <p className="mb-4 font-serif text-[15px] leading-6 text-ink-900">“{candidate.record.source.quote ?? candidate.record.proposal.statement}”</p>
      <Field label="Why not" hint="Kept with what was read, so the next reading of the same words is not proposed again.">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Already a commitment; said in passing; not ours to keep…" />
      </Field>
      {error && <Notice tone="red">{error}</Notice>}
    </Modal>
  );
}

// -------------------------------------------------------------- notes

/** The server's model, when one is configured: it returns raw findings; Forge's own governance runs here, on them. */
const serverExtractor = (model: string): ExtractionModel => ({
  name: 'forge-claude-extractor@1',
  model,
  async extract(input) {
    try {
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return fail('extraction.unavailable', 'The extraction service did not answer.');
      return (await res.json()) as Result<RawExtraction>;
    } catch {
      return fail('extraction.unavailable', 'The extraction service could not be reached.');
    }
  },
});

/** The Claude extractor when the server says it has one; otherwise the offline reference extractor. */
async function chooseExtractor(): Promise<ExtractionModel> {
  try {
    const res = await fetch('/api/extract', { method: 'GET' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return referenceExtractor;
    const body = (await res.json()) as { available?: boolean; model?: string };
    return body.available === true && typeof body.model === 'string' ? serverExtractor(body.model) : referenceExtractor;
  } catch {
    return referenceExtractor;
  }
}

const KNOWN_PARTIES: ExtractionInput['parties'] = Object.values(PEOPLE).map((person) => ({
  names: [person.name, person.name.split(' ')[0]],
  party: person.scope.actsAs[0],
}));

export function ReadNotesDialog({ onClose }: { onClose: () => void }) {
  const { act, demo } = useForge();
  const [label, setLabel] = useState('');
  const [heldOn, setHeldOn] = useState(demo.clock.now().slice(0, 10));
  const [text, setText] = useState('');
  const [demoNotes, setDemoNotes] = useState(false);
  const [result, setResult] = useState<{ read: GovernedExtraction; known: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function read() {
    if (!text.trim() || !label.trim()) {
      setError('Name the meeting and paste what was said.');
      return;
    }
    setPending(true);
    setError(null);
    const ref = demoNotes ? QC_REVIEW_NOTES.source.ref : `notes:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${heldOn}`;
    const input: ExtractionInput = {
      source: { kind: 'MEETING_NOTES', system: 'notes', ref, label, heldOn },
      text,
      parties: KNOWN_PARTIES,
      entities: QC_REVIEW_NOTES.entities,
    };
    const model = await chooseExtractor();
    const read = await extractCandidates(model, input);
    if (!read.ok) {
      setPending(false);
      setError(read.error.message);
      return;
    }
    const before = await demo.runtime.listCandidates(demo.people.gm.scope);
    const known = read.value.candidates.filter((c) => before.ok && before.value.some((v) => v.record.dedupeKey === c.dedupeKey)).length;
    const suggested = await act((s, d) => d.runtime.suggestCandidates(s, read.value.candidates));
    setPending(false);
    if (!suggested.ok) setError(suggested.error.message);
    else setResult({ read: read.value, known });
  }

  if (result) {
    const { read: done, known } = result;
    const fresh = done.candidates.length - known;
    const notConverted = done.findings.filter((f) => f.candidate === null);
    return (
      <Modal title="Read" kicker={label} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <Notice tone="emerald">
          {done.candidates.length === 0
            ? 'Nothing in the notes reads as a promise.'
            : `${fresh} ${fresh === 1 ? 'candidate' : 'candidates'} proposed${known ? ` (${known} already read from these notes)` : ''} — none is a commitment until a person confirms it.`}
        </Notice>
        {notConverted.length > 0 && (
          <ul className="mt-4 border-t border-ink-200">
            {notConverted.map((f, i) => (
              <li key={i} className="border-b border-ink-200 py-2 text-dense">
                <Tag>{f.class.toLowerCase()}</Tag> <span className="text-ink-800">“{f.quote}”</span>
                <p className="text-meta text-ink-500">{f.notConverted}</p>
              </li>
            ))}
          </ul>
        )}
        {done.removed.length > 0 && <p className="mt-3 text-meta text-ink-500">{done.removed.length} of the model’s findings were removed: the words were not in the notes.</p>}
        <p className="mt-3 text-meta text-ink-500">
          Read by <Mono>{done.extractor.name}</Mono>
          {done.extractor.model ? <> (<Mono>{done.extractor.model}</Mono>)</> : ' — cue phrases, offline; the Claude extractor reads when the server has a key'}.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Read meeting notes"
      kicker="Forge proposes; people decide"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="quiet"
            onClick={() => {
              setDemoNotes(true);
              setLabel(QC_REVIEW_NOTES.source.label);
              setHeldOn(QC_REVIEW_NOTES.source.heldOn);
              setText(QC_REVIEW_NOTES.text);
            }}
          >
            Use the demo notes
          </Button>
          <Button variant="primary" disabled={pending} onClick={() => void read()}>
            {pending ? 'Reading…' : 'Read for commitments'}
          </Button>
        </>
      }
    >
      <Field label="Meeting">
        <TextInput
          value={label}
          onChange={(e) => {
            setDemoNotes(false);
            setLabel(e.target.value);
          }}
          placeholder="Weekly supply review"
        />
      </Field>
      <Field label="Held on">
        <TextInput type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} />
      </Field>
      <Field label="What was said" hint="One line per remark reads best: “Minh: I will … by 30 October.”">
        <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
      </Field>
      <p className="text-meta text-ink-500">Discussion, requests and intentions are not proposed. A candidate keeps the exact words it rests on; anything a model adds that is not in the notes is removed.</p>
      {error && <Notice tone="red">{error}</Notice>}
    </Modal>
  );
}
