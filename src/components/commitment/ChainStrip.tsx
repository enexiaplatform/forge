/**
 * WHY → DECISION → COMMITMENT → OWNERSHIP → EXECUTION → EVIDENCE → OUTCOME → LEARNING
 *
 * The success condition of the source of truth (§28), read off one commitment.
 * Each link states a fact about where the chain stands; none is a score, and
 * nothing is summed across them.
 */
import type { CommitmentView } from '@forge/kernel';
import { varianceOf } from '@forge/kernel';
import { fmtShort, humanize } from '../../lib/format';

type Link = { key: string; label: string; state: string; tone: 'held' | 'open' | 'broken' | 'quiet' };

function chainOf(v: CommitmentView): Link[] {
  const variance = varianceOf(v);
  const required = v.requirements.filter((r) => r.requirement.required);
  const evidenced = required.filter((r) => r.status === 'EVIDENCED').length;
  const disputed = v.requirements.some((r) => r.status === 'CONFLICTED' || r.status === 'CONTRADICTED');
  const activity = variance.activity;
  return [
    { key: 'why', label: 'Why', state: v.terms.why ? 'stated' : 'unstated', tone: v.terms.why ? 'held' : 'broken' },
    {
      key: 'decision',
      label: 'Decision',
      state: v.record.origin.kind === 'DIRECT' ? 'direct promise' : `${v.record.origin.system} ${v.record.origin.kind.toLowerCase()}`,
      tone: v.record.origin.kind === 'DIRECT' ? 'quiet' : 'held',
    },
    {
      key: 'commitment',
      label: 'Commitment',
      state: v.redates.length > 0 ? `due ${fmtShort(v.terms.dueBy)} · moved ${v.redates.length}×` : `due ${fmtShort(v.terms.dueBy)}`,
      tone: variance.time.runningDaysLate ? 'broken' : 'held',
    },
    {
      key: 'ownership',
      label: 'Ownership',
      state: v.acceptance ? 'accepted' : v.phase === 'DECLINED' ? 'declined' : 'not accepted',
      tone: v.acceptance ? 'held' : v.phase === 'DECLINED' ? 'broken' : 'open',
    },
    {
      key: 'execution',
      label: 'Execution',
      state: v.links.length === 0 ? 'not linked' : activity.links > 0 ? `${activity.done}/${activity.total} activity` : `${v.links.length} linked`,
      tone: v.links.length === 0 ? 'quiet' : 'held',
    },
    {
      key: 'evidence',
      label: 'Evidence',
      state: disputed ? 'disputed' : `${evidenced} of ${required.length}`,
      tone: disputed ? 'broken' : required.length > 0 && evidenced === required.length ? 'held' : 'open',
    },
    {
      key: 'outcome',
      label: 'Outcome',
      state: v.resolution ? humanize(v.resolution.resolution).toLowerCase() : v.outcome ? 'observed' : 'not yet',
      tone: v.resolution ? 'held' : 'open',
    },
    {
      key: 'learning',
      label: 'Learning',
      state: v.learnings.length > 0 ? `${v.learnings.length} kept` : v.phase === 'CLOSED' && variance.hasVariance ? 'open' : '—',
      tone: v.learnings.length > 0 ? 'held' : v.phase === 'CLOSED' && variance.hasVariance ? 'open' : 'quiet',
    },
  ];
}

const tone = {
  held: 'border-ink-950 text-ink-950',
  open: 'border-amber-500 text-amber-800',
  broken: 'border-red-600 text-red-700',
  quiet: 'border-ink-300 text-ink-500',
};

export function ChainStrip({ view }: { view: CommitmentView }) {
  const links = chainOf(view);
  return (
    <ol className="mb-10 grid grid-cols-8 gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 max-lg:grid-cols-4" aria-label="The chain from why to learning">
      {links.map((l, i) => (
        <li key={l.key} className="bg-white">
          <a href={`#${l.key}`} className="block h-full px-3 pb-3 pt-2.5 no-underline hover:bg-ink-50 hover:no-underline">
            <span className={`block border-t-2 pt-2 ${tone[l.tone]}`}>
              <span className="block font-mono text-tag uppercase text-ink-500">
                {String(i + 1).padStart(2, '0')} {l.label}
              </span>
              <span className="mt-0.5 block text-dense font-medium">{l.state}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
