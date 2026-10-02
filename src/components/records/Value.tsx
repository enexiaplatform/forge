/**
 * Value, as claimed and as realized (ADR-0028): what each decision was meant to create or protect, what people said it
 * did, the measures and whether a system stood behind them, and what it took — commitments, people, days, dates moved.
 * Nothing priced, no ratio, no ranking; in the order they ended. Endings and effects are set in ink.
 */
import { Link } from 'react-router-dom';
import type { ValueRecord } from '@forge/kernel';
import { Empty } from '../ui/primitives';
import { WithheldValue } from '../commitment/tags';
import { fmtDate, fmtQuantity, fmtSigned, plural } from '../../lib/format';

const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export function ValueRecords({ records }: { records: readonly ValueRecord[] }) {
  if (records.length === 0) return <Empty>No decision Forge executes has said what value it is meant to create yet.</Empty>;
  return (
    <>
      <p className="mb-2 text-meta text-ink-500">Forge does not know what anything cost, and states no amount nobody stated. Nothing here is a ratio, and nothing is ranked.</p>
      {records.map((r) => (
        <article key={r.commitmentId} className="border-b border-ink-200 py-4">
          <Link to={`/c/${r.commitmentId}`} className="font-serif text-panel">
            {r.statement}
          </Link>
          <p className="mt-1 text-meta text-ink-600">
            {r.origin} · {r.resolution ? <span className="text-ink-900">{words(r.resolution)}</span> : 'still open'}
            {r.closedAt && <> on <span className="font-mono">{fmtDate(r.closedAt)}</span></>}
          </p>

          {r.claims.length > 0 && (
            <div className="mt-3">
              <p className="forge-label mb-1">Meant to — and what people said it did</p>
              <ul className="border-t border-ink-200">
                {r.claims.map((c, i) => (
                  <li key={i} className="grid grid-cols-[110px_1fr] gap-3 border-b border-ink-100 py-1.5 max-sm:grid-cols-1">
                    <span className="font-mono text-meta uppercase text-ink-500">
                      {words(c.claim.intent)} {words(c.claim.dimension)}
                    </span>
                    <span className="text-dense text-ink-800">
                      {c.claim.statement}
                      <span className="mt-0.5 block text-meta">
                        {c.realized ? (
                          <>
                            <span className="text-ink-900">{words(c.realized.effect)}</span> — {c.realized.statement}
                            {c.by && <span className="text-ink-500"> · {c.by}</span>}
                          </>
                        ) : r.realizedWithheld ? (
                          <span className="italic text-ink-500">what was said is withheld from you</span>
                        ) : (
                          <span className="text-ink-500">{r.resolution ? 'nobody has said' : 'not yet'}</span>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
                {r.unclaimed.map((u, i) => (
                  <li key={`u${i}`} className="grid grid-cols-[110px_1fr] gap-3 border-b border-ink-100 py-1.5 max-sm:grid-cols-1">
                    <span className="font-mono text-meta uppercase text-ink-500">unclaimed {words(u.dimension)}</span>
                    <span className="text-dense text-ink-800">
                      <span className="text-ink-900">{words(u.effect)}</span> — {u.statement}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.measures.length > 0 && (
            <ul className="mt-3">
              {r.measures.map((m) => (
                <li key={m.label} className="py-0.5 text-meta text-ink-600">
                  {m.label}: expected <span className="font-mono">{m.expected === null ? '—' : fmtQuantity(m.expected, m.unit)}</span>, actual{' '}
                  {m.withheld ? (
                    <WithheldValue protection={m.protection} />
                  ) : (
                    <span className="font-mono">{m.actual === null ? '—' : fmtQuantity(m.actual, m.unit)}</span>
                  )}
                  {!m.withheld && m.difference !== null && <span className="font-mono"> ({fmtSigned(m.difference, m.unit)})</span>}
                  {m.actual !== null || m.withheld ? (m.provenBySystem ? ' · a system’s record stands behind it' : ' · stated by a person') : ''}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-meta text-ink-600">
            <span className="forge-label mr-2">What it took</span>
            <span className="font-mono">
              {r.took.commitments} {plural(r.took.commitments, 'commitment')} · {r.took.owners.length} {plural(r.took.owners.length, 'owner')} · {r.took.days}{' '}
              {plural(r.took.days, 'day')} · dates moved {r.took.datesMoved} · changes asked {r.took.changesAsked}
              {r.took.stillOpen > 0 && <> · {r.took.stillOpen} still open</>}
            </span>
          </p>
          {r.unstated > 0 && (
            <p className="forge-caveat mt-1">
              {r.unstated === 1 ? 'One thing it was meant to do' : `${r.unstated} things it was meant to do`} — nobody has said what became of {r.unstated === 1 ? 'it' : 'them'}.
            </p>
          )}
        </article>
      ))}
    </>
  );
}
