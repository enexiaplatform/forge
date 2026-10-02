/**
 * Intake — capture once, use everywhere (§9, §11). The draft shows where every
 * term came from; the only inputs on the page are for what nothing in the
 * ecosystem knows yet.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { type CommitmentView, precedentsFor, type TermField } from '@forge/kernel';
import { type DraftCommitment, draftFromHelm, draftSubject, type FieldState, type IntakeEdits, proposeIntake } from '@forge/fabric';
import { LessonsThatMayApply } from '../components/commitment/Precedents';
import { AppShell } from '../components/shell/AppShell';
import { CaptureTag, EpistemicTag } from '../components/commitment/tags';
import { ContextList } from '../components/commitment/sections';
import { Field, TextArea, TextInput } from '../components/ui/form';
import { Button, Empty, Kicker, Notice, Panel, Section, SectionHead, TwoColumn } from '../components/ui/primitives';
import { useForge, useForgeQuery } from '../forge/ForgeContext';
import { loadDecisions } from '../forge/queries';
import { fmtDate, plural } from '../lib/format';

const LABELS: Record<TermField, string> = {
  statement: 'Promise',
  intendedOutcome: 'What changes',
  why: 'Why',
  owner: 'Owner',
  principal: 'Made to',
  dueBy: 'Due',
  evidence: 'Proven by',
  measures: 'Measured by',
  value: 'Why it matters',
};

function DraftCard({ draft, edits, setEdit, ledger }: { draft: DraftCommitment; edits: IntakeEdits; setEdit: (key: string, field: 'intendedOutcome' | 'dueBy', value: string) => void; ledger: readonly CommitmentView[] }) {
  const t = draft.input.terms;
  const value = (f: TermField) => {
    switch (f) {
      case 'owner':
      case 'principal':
        return t[f].label;
      case 'dueBy':
        return t.dueBy ? fmtDate(t.dueBy) : '';
      case 'evidence':
        return t.evidence.map((r) => `${r.level.toLowerCase()}: ${r.description}`).join(' · ');
      case 'measures':
        return t.measures.map((m) => m.label).join(' · ');
      case 'value':
        return t.value.map((v) => v.dimension.toLowerCase()).join(' · ');
      default:
        return t[f];
    }
  };
  return (
    <article className="border-b border-ink-200 py-5">
      <p className="forge-label mb-1">{draft.role === 'OUTCOME' ? 'The outcome — owned by the decision owner' : 'An action intent — owned by the person Helm named'}</p>
      <h3 className="text-panel font-serif text-ink-950">{t.statement}</h3>
      <div className="mt-3">
        {(Object.entries(draft.fields) as [TermField, FieldState][])
          .filter(([f]) => f !== 'statement')
          .map(([f, state]) => (
            <div key={f} className="grid grid-cols-[120px_1fr_auto] items-baseline gap-3 border-b border-ink-100 py-1.5 last:border-b-0 max-sm:grid-cols-1">
              <span className="forge-label">{LABELS[f]}</span>
              {state === 'MISSING' ? (
                f === 'dueBy' ? (
                  <TextInput type="date" value={edits[draft.key]?.dueBy ?? ''} onChange={(e) => setEdit(draft.key, 'dueBy', e.target.value)} />
                ) : (
                  <TextArea rows={2} value={edits[draft.key]?.intendedOutcome ?? ''} placeholder="What changes in the world when this is kept?" onChange={(e) => setEdit(draft.key, 'intendedOutcome', e.target.value)} />
                )
              ) : (
                <span className="text-dense text-ink-800">{value(f)}</span>
              )}
              <CaptureTag value={state} />
            </div>
          ))}
      </div>
      {draft.notes.map((n, i) => (
        <p key={i} className="mt-2 flex items-baseline gap-2 text-meta text-ink-600">
          <EpistemicTag value={n.class} />
          <span>{n.text}</span>
        </p>
      ))}
      <LessonsThatMayApply reading={precedentsFor(draftSubject(draft), ledger)} />
    </article>
  );
}

export function IntakePage() {
  const { ref = '' } = useParams();
  const { act } = useForge();
  const navigate = useNavigate();
  const [edits, setEdits] = useState<Record<string, { intendedOutcome?: string; dueBy?: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const data = useForgeQuery(async (d, scope) => {
    const entry = (await loadDecisions(d, scope)).find((x) => x.ref === ref) ?? null;
    if (!entry) return { entry: null, draft: null, ledger: [] };
    const draft = await draftFromHelm(scope, entry.decision, { memoire: d.memoire });
    const ledger = await d.runtime.list(scope);
    return { entry, draft: draft.ok ? draft.value : null, ledger: ledger.ok ? ledger.value : [] };
  }, [ref]);
  if (!data) return <AppShell>{null}</AppShell>;
  if (!data.entry || !data.draft) return <AppShell><Empty>Forge cannot draft from that decision.</Empty></AppShell>;
  if (data.entry.commitments.length > 0) return <Navigate to={`/decisions/${encodeURIComponent(ref)}`} replace />;
  const { draft } = data;
  const all = [draft.outcome, ...draft.intents];
  const missingLeft = all.flatMap((d) => (Object.entries(d.fields) as [TermField, FieldState][]).filter(([f, s]) => s === 'MISSING' && !(edits[d.key]?.[f as 'intendedOutcome' | 'dueBy'] ?? '').trim())).length;

  const propose = async () => {
    setError(null);
    const r = await act((scope, d) => proposeIntake(d.runtime, scope, draft, edits));
    if (!r.ok) setError(r.error.message);
    else navigate(`/decisions/${encodeURIComponent(ref)}`);
  };

  return (
    <AppShell>
      <header className="mb-10 max-w-headline">
        <Kicker>Intake · from Helm{draft.source.demo ? ' · DEMO' : ''}</Kicker>
        <h1 className="text-title text-ink-950">{draft.source.decision.title}</h1>
        <p className="mt-3 max-w-reading text-lede text-ink-700">
          Forge read {draft.friction.inherited} facts from Helm and Memoire and inferred {draft.friction.inferred} more for the owners to confirm.{' '}
          {draft.friction.missing === 0 ? 'Nothing has to be typed.' : `${draft.friction.missing} ${plural(draft.friction.missing, 'field')} nothing in the ecosystem knows — those are the only inputs below.`}
        </p>
      </header>
      <TwoColumn
        main={
          <>
            <Section>
              <SectionHead title={`${all.length} commitments, one tree`} aside={`${draft.friction.inherited} inherited · ${draft.friction.inferred} inferred · ${draft.friction.missing} missing`} />
              {all.map((d) => (
                <DraftCard key={d.key} draft={d} ledger={data.ledger} edits={edits} setEdit={(key, field, value) => setEdits({ ...edits, [key]: { ...edits[key], [field]: value } })} />
              ))}
            </Section>
            {error && (
              <div className="mb-4">
                <Notice tone="red">{error}</Notice>
              </div>
            )}
            <div className="flex items-center gap-4">
              <Button variant="primary" disabled={missingLeft > 0} onClick={() => void propose()}>
                Propose {all.length} commitments
              </Button>
              <span className="text-meta text-ink-500">
                {missingLeft > 0 ? `${missingLeft} ${plural(missingLeft, 'field')} still missing.` : 'Each owner is asked to accept; nothing binds anyone until they do.'}
              </span>
            </div>
            <p className="mt-4 text-meta text-ink-500">
              <Link to="/decisions">Back to decisions</Link>
            </p>
          </>
        }
        aside={
          <Panel title="Context that flows with it">
            <p className="mb-2 text-meta text-ink-500">Every commitment in the tree carries this — the reason executing teams can always read why.</p>
            <ContextList fields={draft.context} />
            <Field label="Fingerprint of what management committed">
              <span className="font-mono text-meta text-ink-700">{draft.origin.fingerprint}</span>
            </Field>
          </Panel>
        }
      />
    </AppShell>
  );
}
