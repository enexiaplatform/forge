/**
 * Where execution differs from what management decided — each difference a record: when, who, why, on what
 * authority. Calm by design: a departure is something to learn from, not a fault, so only what asks for someone's
 * attention now is marked; endings are set in ink.
 */
import { Link } from 'react-router-dom';
import { type DecisionFidelity, type Departure, type DepartureKind } from '@forge/fabric';
import { Empty, SectionHead, Tag } from '../ui/primitives';
import { fmtDate } from '../../lib/format';

const LABEL: Record<DepartureKind, string> = {
  RECOMMITTED: 'Helm recommitted',
  INTENT_NOT_TAKEN_UP: 'not taken up',
  OUTCOME_NOT_COMPARABLE: 'not comparable',
  OUTCOME_NOT_PROVABLE: 'not provable',
  NOT_OWNED: 'not owned',
  DECLINED: 'declined',
  REDATED: 'redated',
  RESCOPED: 'rescoped',
  TARGET_MOVED: 'target moved',
  REASSIGNED: 'reassigned',
  ADDED: 'added',
  CONTEXT_CHANGED: 'context changed',
  ENDED_SHORT: 'ended short',
};

/** What someone has to act on now; the rest is history. */
const ASKS: readonly DepartureKind[] = ['RECOMMITTED', 'INTENT_NOT_TAKEN_UP', 'NOT_OWNED'];

function Row({ d }: { d: Departure }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 border-b border-ink-200 py-3 max-sm:grid-cols-1 max-sm:gap-1">
      <span className="font-mono text-meta text-ink-500">{d.at ? fmtDate(d.at) : 'from the start'}</span>
      <div>
        <p className="flex flex-wrap items-center gap-2">
          <Tag tone={ASKS.includes(d.kind) ? 'amber' : 'outline'}>{LABEL[d.kind]}</Tag>
          {d.commitmentId && (
            <Link to={`/c/${d.commitmentId}`} className="text-meta text-accent-700">
              open
            </Link>
          )}
        </p>
        <p className="mt-1 font-serif text-[15px] leading-6 text-ink-950">{d.statement}</p>
        {d.reason && <p className="mt-1 font-serif text-dense italic text-ink-700">“{d.reason}”</p>}
        {(d.by || d.authority) && (
          <p className="mt-1 text-meta text-ink-500">
            {d.by && <>{d.authority?.approvedBy ? 'Asked by' : 'By'} {d.by}</>}
            {d.authority?.approvedBy && <> · approved by {d.authority.approvedBy}{d.authority.approvalReason ? ` — “${d.authority.approvalReason}”` : ''}</>}
            {d.authority && !d.authority.trusted && <> · on Forge’s interim policy, not yet Helm’s authority</>}
          </p>
        )}
      </div>
    </div>
  );
}

export function FidelitySection({ fidelity }: { fidelity: DecisionFidelity }) {
  return (
    <>
      <SectionHead title="Where execution differs from the decision" aside="against Helm’s committed version" />
      <p className="mt-2 max-w-reading text-read text-ink-900">{fidelity.headline}</p>
      {fidelity.departures.length === 0 ? (
        <Empty>Every intent and expected outcome is carried as Helm committed it.</Empty>
      ) : (
        <div className="mt-2">
          {fidelity.departures.map((d, i) => (
            <Row key={`${d.kind}-${d.commitmentId ?? 'decision'}-${d.at ?? i}`} d={d} />
          ))}
        </div>
      )}
      {fidelity.heldAsDecided.length > 0 && (
        <p className="mt-3 text-meta text-ink-500">
          Held as decided: {fidelity.heldAsDecided.map((h) => h.statement).join(' · ')}
        </p>
      )}
    </>
  );
}
