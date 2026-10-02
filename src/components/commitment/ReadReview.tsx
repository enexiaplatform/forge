/**
 * Read a review for what explains the outcome and what to do differently (ADR-0030). Forge proposes; nothing is
 * recorded by reading. Each proposal is the notes' own words, labelled INFERENCE, with where it was found; the person
 * picks one into the form, edits it if they like, and records it as theirs.
 */
import { useState } from 'react';
import { type CommitmentView, fail, type Result } from '@forge/kernel';
import {
  extractLearnings,
  type GovernedLearnings,
  type LearningExtractionModel,
  type LearningProposal,
  type RawLearningFinding,
  referenceLearningExtractor,
} from '@forge/fabric';
import { OUTCOME_REVIEW_NOTES } from '@forge/demo';
import { Field, TextArea } from '../ui/form';
import { Button, Notice } from '../ui/primitives';
import { EpistemicTag } from './tags';

/** The server's model, when one is configured: raw findings only; Forge's governance runs here, on them. */
const serverReader = (model: string): LearningExtractionModel => ({
  name: 'forge-claude-learning-extractor@1',
  model,
  async extract(input) {
    try {
      const res = await fetch('/api/extract-learnings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!(res.headers.get('content-type') ?? '').includes('application/json')) return fail('extraction.unavailable', 'The extraction service did not answer.');
      return (await res.json()) as Result<{ findings: RawLearningFinding[] }>;
    } catch {
      return fail('extraction.unavailable', 'The extraction service could not be reached.');
    }
  },
});

async function chooseReader(): Promise<LearningExtractionModel> {
  try {
    const res = await fetch('/api/extract-learnings', { method: 'GET' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return referenceLearningExtractor;
    const body = (await res.json()) as { available?: boolean; model?: string };
    return body.available === true && typeof body.model === 'string' ? serverReader(body.model) : referenceLearningExtractor;
  } catch {
    return referenceLearningExtractor;
  }
}

export function ReadReview({ view, demo, onUse }: { view: CommitmentView; demo: boolean; onUse: (p: LearningProposal) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('Review notes');
  const [ref, setRef] = useState('notes:review');
  const [reading, setReading] = useState<GovernedLearnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <p className="mb-3 text-meta text-ink-600">
        Was it reviewed?{' '}
        <button type="button" className="text-accent-700 hover:underline" onClick={() => setOpen(true)}>
          Read the review notes
        </button>{' '}
        — Forge proposes what in them explains the outcome and what to do differently; you choose.
      </p>
    );
  }

  const read = async () => {
    setBusy(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const r = await extractLearnings(await chooseReader(), {
      source: { kind: 'MEETING_NOTES', system: 'notes', ref, label, heldOn: today },
      text,
      commitment: { statement: view.terms.statement, ended: view.resolution ? view.resolution.resolution.toLowerCase().replace(/_/g, ' ') : null },
    });
    setBusy(false);
    if (r.ok) setReading(r.value);
    else setError(r.error.message);
  };

  return (
    <div className="mb-4 border-y border-ink-200 py-3">
      <Field label="The review notes" hint="Pasted here, read here. Nothing is kept unless you record a learning from it.">
        <TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || text.trim() === ''} onClick={() => void read()}>
          {busy ? 'Reading…' : 'Read'}
        </Button>
        {demo && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              setText(OUTCOME_REVIEW_NOTES.text);
              setLabel(OUTCOME_REVIEW_NOTES.source.label);
              setRef(OUTCOME_REVIEW_NOTES.source.ref);
              setReading(null);
            }}
          >
            Use the DEMO outcome review
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="red">{error}</Notice>
        </div>
      )}
      {reading && (
        <div className="mt-3">
          <p className="mb-1 text-meta text-ink-500">
            Read by <span className="font-mono">{reading.extractor.name}</span>
            {reading.extractor.model && <span className="font-mono"> · {reading.extractor.model}</span>}.{' '}
            {reading.proposals.length === 0 ? 'Nothing in the notes explains the outcome or states a lesson.' : 'Proposals — the notes’ own words; nothing is recorded until you do.'}
          </p>
          <ul className="divide-y divide-ink-200 border-y border-ink-200">
            {reading.proposals.map((p, i) => (
              <li key={i} className="py-2">
                <p className="flex items-baseline gap-2">
                  <EpistemicTag value="INFERENCE" />
                  <span className="font-mono text-tag uppercase text-ink-500">{p.kind.toLowerCase()}</span>
                </p>
                <p className="mt-1 font-serif text-read text-ink-900">{p.statement}</p>
                <p className="mt-0.5 flex items-center justify-between gap-2 text-meta text-ink-500">
                  <span>
                    {p.speaker ?? 'unattributed'} · {p.drawnFrom.locator ?? 'in the notes'}
                    {p.appliesTo && <> · applies to {p.appliesTo}</>}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => onUse(p)}>
                    Use this
                  </Button>
                </p>
              </li>
            ))}
          </ul>
          {(reading.notTaken.length > 0 || reading.removed.length > 0) && (
            <p className="mt-1 text-meta text-ink-500">
              {reading.notTaken.length > 0 && `${reading.notTaken.length} left as neither. `}
              {reading.removed.length > 0 && `${reading.removed.length} removed: not in the notes.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
