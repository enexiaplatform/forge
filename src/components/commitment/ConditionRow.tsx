/**
 * A condition and its ask. Severity decides treatment: what cannot wait gets an
 * editorial row; lesser ones one scannable line. Buttons appear only for acts
 * the reader may take — the ask names who must answer.
 */
import { Link } from 'react-router-dom';
import { type AskAct, type CommitmentView, type Condition, sameParty } from '@forge/kernel';
import { useForge } from '../../forge/ForgeContext';
import { Button } from '../ui/primitives';
import { ACT_LABELS, canAct } from './acts';
import { EpistemicTag, SeverityLabel } from './tags';

const ASK_LABELS: Partial<Record<AskAct, string>> = {
  DECIDE_CHANGE: 'Decide',
  REQUEST_CHANGE: 'Ask for a change',
  DISPUTE_EVIDENCE: 'Dispute',
  RECORD_EVIDENCE: 'Confirm',
  SETTLE_DEPENDENCY: 'Settle',
};

export function ConditionRow({ condition, view, onAct, showCommitment = true }: { condition: Condition; view: CommitmentView | undefined; onAct: (view: CommitmentView, act: AskAct, subject: string | null) => void; showCommitment?: boolean }) {
  const { reader } = useForge();
  const ask = condition.ask;
  const mine = ask !== null && reader.scope.actsAs.some((p) => sameParty(p, ask.whom));
  const acts = view && ask && mine ? ask.acts.filter((a) => canAct(a, view, reader.scope)) : [];
  const major = condition.severity === 'CANNOT_WAIT';

  return (
    <article className={`border-b border-ink-200 ${major ? 'py-5' : 'py-3'}`}>
      <div className="flex items-baseline justify-between gap-4">
        <SeverityLabel value={condition.severity} />
        <span className="forge-meta">{condition.code.toLowerCase().replace(/_/g, ' ')}</span>
      </div>
      {showCommitment && view && (
        <Link to={`/c/${view.record.id}`} className={`mt-1 block font-serif text-ink-950 no-underline hover:text-accent-800 ${major ? 'text-signal' : 'text-panel'}`}>
          {view.terms.statement}
        </Link>
      )}
      <p className={`mt-1.5 flex items-baseline gap-2 ${major ? 'text-read' : 'text-dense'} text-ink-800`}>
        <EpistemicTag value={condition.statement.class} />
        <span>{condition.statement.text}</span>
      </p>
      {ask && (
        <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 ${major ? '' : ''}`}>
          <p className={`${major ? 'font-serif text-[16px] italic leading-6' : 'text-dense'} text-ink-700`}>
            {mine ? 'You are asked: ' : `${ask.whom.label} is asked: `}
            {ask.question}
          </p>
          {acts.length > 0 && view && (
            <div className="flex gap-2">
              {acts.map((a, i) => (
                <Button key={a} size="sm" variant={i === 0 ? 'secondary' : 'quiet'} onClick={() => onAct(view, a, ask.subject)}>
                  {ASK_LABELS[a] ?? ACT_LABELS[a]}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
