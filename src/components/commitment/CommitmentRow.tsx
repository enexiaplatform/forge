/** One commitment on a hairline: the promise, who owes it to whom, by when, what proves it, and what needs a person. */
import { Link } from 'react-router-dom';
import type { CommitmentView, Condition } from '@forge/kernel';
import { varianceOf } from '@forge/kernel';
import { fmtShort, relativeDays } from '../../lib/format';
import { PhaseTag, SeverityLabel } from './tags';

export function EvidenceSummary({ view }: { view: CommitmentView }) {
  const required = view.requirements.filter((r) => r.requirement.required);
  const evidenced = required.filter((r) => r.status === 'EVIDENCED');
  const disputed = view.requirements.filter((r) => r.status === 'CONFLICTED' || r.status === 'CONTRADICTED');
  const bySystem = evidenced.filter((r) => r.basis === 'SYSTEM').length;
  if (disputed.length > 0) return <span className="font-mono text-meta text-red-700">evidence disputed</span>;
  return (
    <span className="font-mono text-meta text-ink-600">
      evidence {evidenced.length}/{required.length}
      {evidenced.length > 0 && <span className="text-ink-400"> · {bySystem === evidenced.length ? 'systems' : bySystem === 0 ? 'people' : 'systems + people'}</span>}
    </span>
  );
}

export function DueDate({ view }: { view: CommitmentView }) {
  const v = varianceOf(view);
  return (
    <span className="font-mono text-meta text-ink-700">
      {view.redates.length > 0 && <s className="mr-1 text-ink-400">{fmtShort(view.originalDueBy)}</s>}
      {fmtShort(view.terms.dueBy)}
      {v.time.runningDaysLate ? <span className="ml-1 text-red-700">· {v.time.runningDaysLate}d past</span> : null}
      {view.phase === 'CLOSED' && v.time.daysAgainstOriginal !== null && v.time.daysAgainstOriginal !== 0 && (
        <span className="ml-1 text-ink-500">· ended {relativeDays(v.time.daysAgainstOriginal)}</span>
      )}
    </span>
  );
}

export function CommitmentRow({ view, depth = 0, conditions = [] }: { view: CommitmentView; depth?: number; conditions?: readonly Condition[] }) {
  const worst = conditions[0];
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-b border-ink-200 py-3.5 max-sm:grid-cols-1" style={{ paddingLeft: depth * 28 }}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          {depth > 0 && <span className="font-mono text-meta text-ink-300" aria-hidden="true">└</span>}
          <Link to={`/c/${view.record.id}`} className={`font-serif text-ink-950 no-underline hover:text-accent-800 ${depth === 0 ? 'text-section-sm' : 'text-panel'}`}>
            {view.terms.statement}
          </Link>
        </div>
        <p className="mt-0.5 text-dense text-ink-600" style={{ paddingLeft: depth > 0 ? 20 : 0 }}>
          {view.terms.owner.label} <span className="text-ink-400">→</span> {view.terms.principal.label}
          {worst && (
            <span className="ml-3 inline-flex items-baseline gap-1.5">
              <SeverityLabel value={worst.severity} />
              <span className="text-meta text-ink-600">{worst.code.toLowerCase().replace(/_/g, ' ')}</span>
              {conditions.length > 1 && <span className="font-mono text-meta text-ink-400">+{conditions.length - 1}</span>}
            </span>
          )}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-right max-sm:items-start" style={{ paddingLeft: depth > 0 ? 20 : 0 }}>
        <PhaseTag view={view} />
        <DueDate view={view} />
        <EvidenceSummary view={view} />
      </div>
    </div>
  );
}
