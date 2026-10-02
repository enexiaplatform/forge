/**
 * Execution records — what the ledger observed of each owner's (or principal's)
 * commitments: how many, how they ended, when against the date first promised,
 * what they waited on, what people said explains the differences, what kept
 * recurring. Ordered by name. No score, no rank, no rating: a record is
 * evidence, not a judgment, and a small sample says so.
 */
import { Link } from 'react-router-dom';
import { type ExecutionRecord, type RecordGrouping, resolutions } from '@forge/kernel';
import { Notice } from '../ui/primitives';
import { fmtSigned, humanize, plural } from '../../lib/format';

function days(n: number): string {
  if (n === 0) return 'on the day';
  return `${fmtSigned(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;
}

function Record({ record: r }: { record: ExecutionRecord }) {
  const endings = resolutions.filter((x) => r.endings[x] > 0).map((x) => `${r.endings[x]} ${humanize(x).toLowerCase()}`);
  return (
    <div className="border-b border-ink-200 py-5">
      <h3 className="text-panel text-ink-950">{r.party.label}</h3>
      <p className="mt-1 text-dense text-ink-700">
        {r.observed} {plural(r.observed, 'commitment')} observed — {r.open} open, {r.concluded} concluded{endings.length ? `: ${endings.join(', ')}` : ''}.
        {r.dateChanges > 0 && ` ${r.dateChanges} ${plural(r.dateChanges, 'date change')} agreed along the way.`}
      </p>
      {r.timing.againstOriginal.length > 0 && (
        <p className="mt-1 text-dense text-ink-700">
          Against the date first promised: {r.timing.onOrBefore} on or before, {r.timing.after} after
          {r.timing.range && r.timing.againstOriginal.length > 1 ? ` (from ${days(r.timing.range[0])} to ${days(r.timing.range[1])}, median ${days(r.timing.median ?? 0)})` : ` (${days(r.timing.againstOriginal[0].days)})`}.{' '}
          <span className="text-ink-500">
            {r.timing.againstOriginal.map((t, i) => (
              <span key={t.commitmentId}>
                {i > 0 && ' · '}
                <Link to={`/c/${t.commitmentId}`}>{days(t.days)}</Link>
              </span>
            ))}
          </span>
        </p>
      )}
      {r.recurringDependencies.length > 0 && (
        <p className="mt-2 text-dense text-ink-700">
          <span className="forge-label mr-2">Waited on again</span>
          {r.recurringDependencies.map((d) => `${d.on} (${d.count} times${d.late ? `, late ${d.late}` : ''})`).join('; ')}
        </p>
      )}
      {r.causesOfVariance.length > 0 && (
        <div className="mt-2">
          <p className="forge-label mb-1">What people said explains the differences</p>
          <ul className="border-t border-ink-200">
            {r.causesOfVariance.map((c, i) => (
              <li key={i} className="border-b border-ink-200 py-1.5 text-dense text-ink-800">
                “{c.statement}” <span className="text-meta text-ink-500">— {c.author}, {c.kind === 'EXPLANATION' ? 'explaining the outcome' : 'moving the date'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.patterns.length > 0 && (
        <div className="mt-2">
          <p className="forge-label mb-1">What recurred</p>
          <ul>
            {r.patterns.map((p, i) => (
              <li key={i} className="text-dense text-ink-800">
                {p.statement} <span className="text-meta text-ink-500">({p.commitmentIds.length})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-meta text-ink-500">
        In: {r.contexts.map((c) => `${c.origin} (${c.count})`).join('; ')}. {r.sample.caveat}
      </p>
    </div>
  );
}

export function ExecutionRecords({ records, groupBy, onGroupBy }: { records: readonly ExecutionRecord[]; groupBy: RecordGrouping; onGroupBy: (g: RecordGrouping) => void }) {
  return (
    <>
      <div className="mb-3 mt-2 flex items-center gap-3 text-dense">
        <span className="forge-label">By</span>
        {(['owner', 'principal'] as const).map((g) => (
          <button key={g} type="button" onClick={() => onGroupBy(g)} className={groupBy === g ? 'font-medium text-ink-950' : 'text-accent-700 hover:underline'}>
            {g === 'owner' ? 'who promised' : 'to whom it was promised'}
          </button>
        ))}
      </div>
      <Notice>Observed records, in alphabetical order. Forge does not score, rank or rate people or units; read each record with its context and sample size.</Notice>
      {records.map((r) => (
        <Record key={`${r.party.kind}:${r.party.label}`} record={r} />
      ))}
    </>
  );
}
