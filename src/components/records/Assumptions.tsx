/**
 * What the decision rested on, and what became of it (ADR-0026) — on a commitment's page, and across decisions on the
 * memory page. A person's judgment, attributed, with their reason; unexamined says so. Counts and cases, never a rate;
 * ordered by the assumption's words. Endings are set in ink: holding is not praised, breaking is not blamed.
 */
import type { AssumptionRecord, CommitmentView } from '@forge/kernel';
import { Link } from 'react-router-dom';
import { EpistemicTag } from '../commitment/tags';
import { Empty, Section, SectionHead } from '../ui/primitives';
import { fmtDate } from '../../lib/format';

const said = (a: 'HELD' | 'BROKE') => (a === 'HELD' ? 'held' : 'broke');

/** On a commitment: each assumption it inherited, and what was said of it. */
export function AssumptionsSection({ view }: { view: CommitmentView }) {
  if (view.assumptions.length === 0) return null;
  return (
    <Section>
      <SectionHead id="assumptions" title="What it rested on" aside="assumptions the decision made without proof" />
      {view.assumptions.map((a) => (
        <div key={a.key} className="border-b border-ink-200 py-3">
          <p className="flex items-baseline gap-2">
            <EpistemicTag value="ASSUMPTION" />
            <span className="font-serif text-read text-ink-950">{a.statement}</span>
          </p>
          {a.assessed ? (
            <p className="mt-1 text-meta text-ink-600">
              <span className="font-medium text-ink-900">It {said(a.assessed.assessment)}</span>, said {a.assessed.actor.label} on{' '}
              <span className="font-mono">{fmtDate(a.assessed.at)}</span>
              {a.assessed.reason && <span className="forge-caveat block not-italic text-ink-700">“{a.assessed.reason}”</span>}
            </p>
          ) : (
            <p className="mt-1 text-meta text-ink-500">Nobody has said whether it held.</p>
          )}
        </div>
      ))}
    </Section>
  );
}

/** Across decisions: which assumptions held, which broke — with the cases behind the counts. */
export function AssumptionRecords({ records }: { records: readonly AssumptionRecord[] }) {
  if (records.length === 0) return <Empty>No decision Forge executes has stated an assumption yet.</Empty>;
  return (
    <>
      <p className="mb-2 text-meta text-ink-500">Counted once per decision. Nothing here is a rate, and nothing is ranked.</p>
      {records.map((r) => (
        <article key={r.statement} className="border-b border-ink-200 py-4">
          <p className="font-serif text-panel text-ink-950">{r.statement}</p>
          <p className="mt-1 font-mono text-meta text-ink-700">
            held {r.held} · broke {r.broke} · unexamined {r.unexamined}
          </p>
          {r.caveat && <p className="forge-caveat mt-1">{r.caveat}</p>}
          <ul className="mt-2">
            {r.cases.map((c, i) => (
              <li key={`${c.commitmentId}-${i}`} className="py-1 text-meta text-ink-600">
                <Link to={`/c/${c.commitmentId}`}>{c.decision}</Link>
                {' — '}
                {c.assessment ? (
                  <>
                    <span className="text-ink-900">{said(c.assessment)}</span>, said {c.by}
                    {c.at && <> on <span className="font-mono">{fmtDate(c.at)}</span></>}
                    {c.reason && <span className="forge-caveat block not-italic text-ink-700">“{c.reason}”</span>}
                  </>
                ) : (
                  'not examined'
                )}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </>
  );
}
