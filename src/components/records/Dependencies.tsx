/**
 * What work waited on (ADR-0029): each thing commitments waited on, how often, how often it came after the date it
 * was needed, and every case. Counts and cases, never a rate; ordered by name. Lateness is a fact with its days.
 */
import { Link } from 'react-router-dom';
import type { DependencyRecord } from '@forge/kernel';
import { Empty } from '../ui/primitives';
import { fmtDate, plural } from '../../lib/format';

export function DependencyRecords({ records }: { records: readonly DependencyRecord[] }) {
  if (records.length === 0) return <Empty>No commitment has waited on anything yet.</Empty>;
  return (
    <>
      <p className="mb-2 text-meta text-ink-500">Counted per commitment that waited. Nothing here is a rate, and nothing is ranked.</p>
      {records.map((r) => (
        <article key={r.on} className="border-b border-ink-200 py-4">
          <p className="font-serif text-panel text-ink-950">{r.on}</p>
          <p className="mt-1 font-mono text-meta text-ink-700">
            waited on {r.waitedOn} · after the date needed {r.late}
            {r.stillWaiting > 0 && <> · still waiting {r.stillWaiting}</>}
          </p>
          {r.caveat && <p className="forge-caveat mt-1">{r.caveat}</p>}
          <ul className="mt-2">
            {r.cases.map((c, i) => (
              <li key={`${c.commitmentId}-${i}`} className="py-1 text-meta text-ink-600">
                <Link to={`/c/${c.commitmentId}`}>{c.commitment}</Link> — {c.owner}
                <span className="block">
                  {c.description}
                  {c.neededBy && (
                    <>
                      {' '}· needed by <span className="font-mono">{fmtDate(c.neededBy)}</span>
                    </>
                  )}
                  {c.settledAt ? (
                    <>
                      {' '}· came <span className="font-mono">{fmtDate(c.settledAt)}</span>
                    </>
                  ) : (
                    ' · not yet'
                  )}
                  {c.daysLate !== null && (
                    <span className="text-ink-900">
                      {' '}
                      · {c.daysLate} {plural(c.daysLate, 'day')} after it was needed
                    </span>
                  )}
                  {c.datesMovedAfter > 0 && <> · the waiting commitment’s date moved {c.datesMovedAfter === 1 ? 'once' : `${c.datesMovedAfter} times`} after</>}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </>
  );
}
