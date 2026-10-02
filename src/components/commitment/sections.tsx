/** The commitment page, section by section — each one a link in the chain. */
import { Link } from 'react-router-dom';
import {
  type CaptureMode,
  type CommitmentView,
  type ContextField,
  dependencyCommitmentState,
  type EvidenceEntry,
  isWatchable,
  varianceOf,
  type ViewLookup,
} from '@forge/kernel';
import { Empty, FactRow, Mono, Section, SectionHead, Tag } from '../ui/primitives';
import { fmtDate, fmtMoment, fmtQuantity, fmtSigned, humanize, relativeDays } from '../../lib/format';
import { CaptureTag, EpistemicTag, RequirementTag, WithheldValue } from './tags';

// -------------------------------------------------------------------- why

export function WhySection({ view, ancestors }: { view: CommitmentView; ancestors: readonly CommitmentView[] }) {
  const o = view.record.origin;
  const question = view.record.context.find((c) => c.key === 'situation.question');
  const chosen = view.record.context.find((c) => c.key === 'decision.chosen');
  return (
    <Section>
      <SectionHead id="why" title="Why" aside={o.system === 'helm' ? 'from Helm, by reference' : undefined} />
      {question && <blockquote className="mt-4 border-l-2 border-ink-300 pl-4 font-serif text-[19px] italic leading-7 text-ink-800">{question.value}</blockquote>}
      <p className="mt-4 max-w-reading text-read text-ink-900">{view.terms.why}</p>
      <div className="mt-4">
        <FactRow label="Answers to" aside={<Tag tone="accent">{o.system} {o.kind.toLowerCase()}</Tag>}>
          {o.system === 'helm' && o.ref ? <Link to={`/decisions/${encodeURIComponent(o.ref)}`}>{o.label}</Link> : o.label}
        </FactRow>
        {chosen && (
          <FactRow label="Chosen" aside={<EpistemicTag value="DECISION" />}>
            {chosen.value}
          </FactRow>
        )}
        {o.fingerprint && (
          <FactRow label="Fingerprint">
            <Mono>{o.fingerprint}</Mono> <span className="text-meta text-ink-500">— what management committed, frozen when this commitment was made</span>
          </FactRow>
        )}
        {ancestors.length > 0 && (
          <FactRow label="Up the chain">
            {ancestors.map((a, i) => (
              <span key={a.record.id}>
                {i > 0 && <span className="text-ink-400"> › </span>}
                <Link to={`/c/${a.record.id}`}>{a.terms.statement}</Link>
              </span>
            ))}
          </FactRow>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- promise

export function PromiseSection({ view }: { view: CommitmentView }) {
  const t = view.terms;
  const cap = (f: keyof CommitmentView['capture']) => <CaptureTag value={view.capture[f] as CaptureMode} />;
  const typed = Object.values(view.capture).filter((c) => c === 'MANUAL').length;
  return (
    <Section>
      <SectionHead id="commitment" title="The promise" aside={`${typed} of ${Object.keys(view.capture).length} terms typed by a person`} />
      <FactRow label="Promise" aside={cap('statement')}>
        {t.statement}
      </FactRow>
      <FactRow label="What changes" aside={cap('intendedOutcome')}>
        {t.intendedOutcome}
      </FactRow>
      <div id="ownership" className="scroll-mt-6" />
      <FactRow label="Owner" aside={cap('owner')}>
        {t.owner.label}
        {view.acceptance ? (
          <span className="ml-2 text-meta text-ink-500">accepted {fmtMoment(view.acceptance.at)}</span>
        ) : view.declined ? (
          <span className="ml-2 text-meta text-red-700">declined — {view.declined.reason}</span>
        ) : (
          <span className="ml-2 text-meta text-amber-800">has not accepted</span>
        )}
      </FactRow>
      <FactRow label="Made to" aside={cap('principal')}>
        {t.principal.label}
      </FactRow>
      <FactRow label="Due" aside={cap('dueBy')}>
        <span className="font-mono text-meta text-ink-900">{fmtDate(t.dueBy)}</span>
        {view.redates.map((r) => (
          <span key={r.eventId} className="ml-2 text-meta text-ink-500">
            moved from <s>{fmtDate(r.from)}</s>
          </span>
        ))}
      </FactRow>
      {t.measures.length > 0 && (
        <FactRow label="Measured by" aside={cap('measures')}>
          <ul className="space-y-0.5">
            {t.measures.map((m) => (
              <li key={m.key} className="text-dense">
                {m.label}:{' '}
                {m.comparator === 'QUALITATIVE' ? (
                  <span className="italic text-ink-700">{m.statement}</span>
                ) : (
                  <span className="font-mono text-meta">
                    {m.comparator === 'AT_MOST' ? '≤' : '≥'} {fmtQuantity(m.expected, m.unit)}
                  </span>
                )}
                {m.source.system === 'helm' && <span className="ml-1 text-meta text-ink-500">· Helm’s committed future</span>}
              </li>
            ))}
          </ul>
        </FactRow>
      )}
      {t.value.length > 0 && (
        <FactRow label="Why it matters" aside={cap('value')}>
          <ul className="space-y-1">
            {t.value.map((v, i) => (
              <li key={i} className="text-dense">
                <span className="font-mono text-meta uppercase text-ink-500">
                  {v.intent.toLowerCase()} {v.dimension.toLowerCase().replace(/_/g, ' ')}
                </span>{' '}
                — {v.statement}
                {v.precision === 'UNQUANTIFIED' && <span className="ml-1 text-meta text-ink-400">(unquantified)</span>}
              </li>
            ))}
          </ul>
        </FactRow>
      )}
    </Section>
  );
}

// -------------------------------------------------------------- execution

export function ExecutionSection({ view, lookup }: { view: CommitmentView; lookup: ViewLookup }) {
  return (
    <Section>
      <SectionHead id="execution" title="Execution" aside="where the work happens — Forge observes it there" />
      {view.links.length === 0 && view.dependencies.length === 0 && <Empty>Not linked to any system yet. Forge does not need the work moved here; it needs to know where to look.</Empty>}
      {view.links.map((l) => (
        <FactRow key={l.link.id} label={l.link.system} aside={<Tag tone="outline">{l.link.kind.toLowerCase().replace(/_/g, ' ')}</Tag>}>
          <span className="font-mono text-meta text-ink-900">{l.link.ref}</span> <span className="text-dense text-ink-700">{l.link.label}</span>
          {l.activity ? (
            <p className="mt-0.5 text-meta text-ink-500">
              Activity: {l.activity.done} of {l.activity.total} {l.activity.unit} done ({fmtMoment(l.activity.observedAt)}). Activity says work happened — not that the promise is kept.
            </p>
          ) : (
            <p className="mt-0.5 text-meta text-ink-500">Reports no activity counts — its records arrive as evidence instead.</p>
          )}
        </FactRow>
      ))}
      {view.dependencies.map((d) => {
        const viaCommitment = dependencyCommitmentState(d, lookup);
        const settled = d.settled !== null || viaCommitment === 'SETTLED';
        const late = !settled && d.dependency.neededBy !== null && view.lens.asOf.slice(0, 10) > d.dependency.neededBy;
        return (
          <FactRow
            key={d.dependency.key}
            label="Waits on"
            aside={settled ? <Tag tone="emerald">settled</Tag> : late ? <Tag tone="red">late</Tag> : <Tag tone="outline">open</Tag>}
          >
            {d.dependency.on.kind === 'COMMITMENT' ? <Link to={`/c/${d.dependency.on.commitmentId}`}>{d.dependency.description}</Link> : d.dependency.description}
            <p className="mt-0.5 text-meta text-ink-500">
              {d.dependency.neededBy && <>needed by {fmtDate(d.dependency.neededBy)}</>}
              {d.settled && <> · settled {fmtMoment(d.settled.at)}{d.settled.observationId ? ' by a system record' : ''}</>}
              {d.dependency.matcher && !d.settled && <> · Forge watches {d.dependency.matcher.system} for {d.dependency.matcher.eventType}</>}
              {d.dependency.helmTriggerKey && <> · stands for Helm review trigger <Mono>{d.dependency.helmTriggerKey}</Mono></>}
            </p>
          </FactRow>
        );
      })}
    </Section>
  );
}

// --------------------------------------------------------------- evidence

function EvidenceItemRow({ e }: { e: EvidenceEntry }) {
  const struck = e.disputed !== null || e.supersededBy !== null;
  return (
    <li className={`flex items-baseline gap-2 py-1.5 ${struck ? 'opacity-60' : ''}`}>
      <EpistemicTag value={e.item.epistemic} />
      <span className="min-w-0 flex-1">
        <span className={`text-dense ${e.item.withheld ? 'italic text-ink-500' : 'text-ink-900'} ${struck ? 'line-through decoration-ink-400' : ''}`}>{e.item.statement}</span>
        <span className="mt-0.5 block text-meta text-ink-500">
          {e.item.stance === 'CONTRADICTS' ? 'contradicts · ' : e.item.stance === 'CONTEXT' ? 'context · ' : ''}
          {e.item.channel === 'SYSTEM_EVENT' ? `${e.item.source.system} record` : humanize(e.item.channel).toLowerCase()}
          {e.item.source.ref && <> <Mono>{e.item.source.ref}</Mono></>} · {fmtMoment(e.item.observedAt)} · {e.actor.label}
          {e.disputed && <span className="text-ink-700"> · disputed by {e.disputed.actor.label}: “{e.disputed.reason}”</span>}
          {e.supersededBy && <span> · replaced by the same system’s later record</span>}
        </span>
      </span>
    </li>
  );
}

export function EvidenceSection({ view }: { view: CommitmentView }) {
  const loose = view.evidence.filter((e) => e.item.requirementKey === null);
  return (
    <Section>
      <SectionHead id="evidence" title="Evidence" aside="observable reality over reported status" />
      {view.requirements.map((r) => {
        const items = view.evidence.filter((e) => e.item.requirementKey === r.requirement.key);
        return (
          <div key={r.requirement.key} className="border-b border-ink-200 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-base text-ink-950">
                <span className="mr-2 font-mono text-tag uppercase text-ink-500">{r.requirement.level}</span>
                {r.requirement.description}
                {!r.requirement.required && <span className="ml-1 text-meta text-ink-500">(optional)</span>}
              </p>
              <span className="flex items-center gap-2">
                {r.basis === 'PERSON' && <span className="text-meta text-ink-500">on a person’s word</span>}
                <RequirementTag value={r.status} />
              </span>
            </div>
            <p className="mt-0.5 text-meta text-ink-500">
              {r.requirement.matcher === null
                ? 'Only a person can confirm this.'
                : isWatchable(r.requirement.matcher)
                  ? `Forge watches ${r.requirement.matcher.system} for ${r.requirement.matcher.eventType}${r.requirement.matcher.objectRef ? ` on ${r.requirement.matcher.objectRef}` : ''}${Object.keys(r.requirement.matcher.where).length ? ` where ${Object.entries(r.requirement.matcher.where).map(([k, v]) => `${k} = ${v}`).join(', ')}` : ''}.`
                  : `Not watched yet: name the ${r.requirement.matcher.system} object it will be recorded on.`}
            </p>
            {items.length > 0 && <ul className="mt-1.5">{items.map((e) => <EvidenceItemRow key={e.item.id} e={e} />)}</ul>}
          </div>
        );
      })}
      {loose.length > 0 && (
        <div className="py-3">
          <p className="forge-label mb-1">Context</p>
          <ul>{loose.map((e) => <EvidenceItemRow key={e.item.id} e={e} />)}</ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- outcome

export function OutcomeSection({ view }: { view: CommitmentView }) {
  const v = varianceOf(view);
  const outputs = view.requirements.filter((r) => r.requirement.level === 'OUTPUT');
  const outcomes = view.requirements.filter((r) => r.requirement.level === 'OUTCOME');
  const held = (rs: typeof outputs) => `${rs.filter((r) => r.status === 'EVIDENCED').length} of ${rs.length} evidenced${rs.some((r) => r.status === 'CONFLICTED' || r.status === 'CONTRADICTED') ? ', disputed' : ''}`;
  return (
    <Section>
      <SectionHead id="outcome" title="Outcome and variance" aside="kept apart, never summed" />
      <div className="mt-2">
        <FactRow label="Activity" aside={<span className="forge-meta">what was done</span>}>
          {v.activity.links > 0 ? `${v.activity.done} of ${v.activity.total} tracked items done` : 'No activity tracked'}
        </FactRow>
        <FactRow label="Output" aside={<span className="forge-meta">what was produced</span>}>
          {outputs.length > 0 ? held(outputs) : 'No output named'}
        </FactRow>
        <FactRow label="Outcome" aside={<span className="forge-meta">what changed</span>}>
          {view.outcome ? view.outcome.outcome.statement : outcomes.length > 0 ? held(outcomes) : 'Not yet observed'}
          {view.resolution && (
            <p className="mt-1 text-meta text-ink-500">
              Closed {humanize(view.resolution.resolution).toLowerCase()} by {view.resolution.actor.label}, {fmtMoment(view.resolution.at)}
              {view.resolution.confirmedWithoutEvidence && ' — on their confirmation, without system evidence'}.
              {view.resolution.reason && <span className="forge-caveat block not-italic"> “{view.resolution.reason}”</span>}
            </p>
          )}
        </FactRow>
        <FactRow label="Value" aside={<span className="forge-meta">why it mattered</span>}>
          {v.value.length === 0 ? (
            'No value claim'
          ) : (
            <ul className="space-y-0.5">
              {v.value.map((x, i) => (
                <li key={i} className="text-dense">
                  <span className="font-mono text-meta uppercase text-ink-500">{x.claim.dimension.toLowerCase().replace(/_/g, ' ')}</span>{' '}
                  {x.realized ? (
                    <>
                      {x.realized.effect.toLowerCase()} — {x.realized.statement}
                    </>
                  ) : (
                    <span className="text-ink-500">not yet stated</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </FactRow>
      </div>
      {v.activityOutcomeGap && (
        <p className="mt-3 font-serif text-[16px] italic leading-6 text-ink-800">
          Every tracked activity is done, and the outcome {view.phase === 'CLOSED' ? 'did not hold' : 'is not proven'}. Activity is not the outcome.
        </p>
      )}
      {v.measures.length > 0 && (
        <table className="mt-6 w-full text-left">
          <thead>
            <tr className="border-b border-ink-950">
              <th className="forge-label py-2 font-medium">Measure</th>
              <th className="forge-label py-2 text-right font-medium">Expected</th>
              <th className="forge-label py-2 text-right font-medium">Actual</th>
              <th className="forge-label py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {v.measures.map((m) => (
              <tr key={m.key} className="border-b border-ink-200 align-baseline">
                <td className="py-2.5 pr-3 text-dense text-ink-900">
                  {m.label}
                  {m.note && <span className="mt-0.5 block text-meta text-ink-500">{m.note}</span>}
                </td>
                <td className="py-2.5 text-right font-mono text-meta text-ink-700">{m.comparator === 'QUALITATIVE' ? 'stated' : fmtQuantity(m.expected, m.unit)}</td>
                <td className="py-2.5 text-right font-mono text-meta text-ink-900">
                  {m.withheld ? <WithheldValue protection={m.protection} /> : m.comparator === 'QUALITATIVE' ? (m.note ? 'observed' : '—') : fmtQuantity(m.actual, m.unit)}
                </td>
                <td className="py-2.5 text-right font-mono text-meta text-ink-900">{m.withheld ? <WithheldValue protection={m.protection} /> : m.difference === null ? '—' : fmtSigned(m.difference, m.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-4 text-dense text-ink-700">
        Time: first promised for <span className="font-mono text-meta">{fmtDate(v.time.originalDueBy)}</span>
        {v.time.redates > 0 && (
          <>
            , agreed <span className="font-mono text-meta">{fmtDate(v.time.agreedDueBy)}</span> after {v.time.redates} {v.time.redates === 1 ? 'change' : 'changes'}
          </>
        )}
        {v.time.endedOn ? (
          <>
            ; ended <span className="font-mono text-meta">{fmtDate(v.time.endedOn)}</span> — {relativeDays(v.time.daysAgainstOriginal)} against the first promise
            {v.time.redates > 0 && <>, {relativeDays(v.time.daysAgainstAgreed)} against the agreed date</>}.
          </>
        ) : v.time.runningDaysLate ? (
          <>; still open, {relativeDays(v.time.runningDaysLate)}.</>
        ) : (
          '.'
        )}
      </p>
    </Section>
  );
}

// --------------------------------------------------------------- learning

export function LearningSection({ view }: { view: CommitmentView }) {
  return (
    <Section>
      <SectionHead id="learning" title="Learning" aside="what the enterprise keeps" />
      {view.learnings.length === 0 ? (
        <Empty>{view.phase === 'CLOSED' ? 'Nothing recorded yet.' : 'Recorded when the commitment ends — while what happened is still known.'}</Empty>
      ) : (
        view.learnings.map((l) => (
          <div key={l.eventId} className="border-b border-ink-200 py-3">
            <p className="flex items-baseline gap-2">
              <EpistemicTag value={l.learning.kind === 'LESSON' ? 'RECOMMENDATION' : 'INFERENCE'} />
              <span className="font-mono text-tag uppercase text-ink-500">{l.learning.kind.toLowerCase()}</span>
            </p>
            <p className="mt-1 font-serif text-[17px] leading-7 text-ink-950">{l.learning.statement}</p>
            <p className="mt-1 text-meta text-ink-500">
              {l.actor.label} · {fmtMoment(l.at)}
              {l.learning.appliesTo && <> · applies to {l.learning.appliesTo}</>}
            </p>
            {l.learning.drawnFrom && (
              <p className="mt-0.5 text-meta text-ink-500">
                drawn from {l.learning.drawnFrom.label}
                {l.learning.drawnFrom.locator && <>, {l.learning.drawnFrom.locator}</>}: <span className="italic">“{l.learning.drawnFrom.quote}”</span>
              </p>
            )}
          </div>
        ))
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- history

export function HistorySection({ view }: { view: CommitmentView }) {
  return (
    <Section>
      <SectionHead id="history" title="History" aside="append-only — who, when, under what authority, and why" />
      <ol>
        {[...view.history].reverse().map((h, i) => (
          <li key={h.eventId ?? `p${i}`} className="grid grid-cols-[92px_1fr] gap-4 border-b border-ink-200 py-2.5 max-sm:grid-cols-1 max-sm:gap-0.5">
            <span className="font-mono text-meta text-ink-500">{fmtMoment(h.at)}</span>
            <div>
              <p className="text-dense text-ink-900">{h.summary}</p>
              <p className="mt-0.5 text-meta text-ink-500">
                {h.actor.label}
                {h.actor.kind !== 'PERSON' && <span className="font-mono uppercase"> · {h.actor.kind.toLowerCase()}</span>}
                {h.authority && <> · <Mono>{h.authority.rule}</Mono></>}
                {h.recordedAt.slice(0, 16) !== h.at.slice(0, 16) && <> · recorded {fmtMoment(h.recordedAt)}</>}
              </p>
              {h.reason && <p className="forge-caveat mt-1">“{h.reason}”</p>}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---------------------------------------------------------------- context

export function ContextList({ fields: all }: { fields: readonly ContextField[] }) {
  const fields = all.filter((c) => c.key !== 'situation.question' && c.key !== 'decision.chosen');
  if (fields.length === 0) return <Empty>No inherited context.</Empty>;
  return (
    <ul>
      {fields.map((c) => (
        <li key={c.key} className="border-b border-ink-200 py-2.5 last:border-b-0">
          <div className="flex items-center justify-between gap-2">
            <span className="forge-label">{c.label}</span>
            <span className="flex gap-1">
              <EpistemicTag value={c.epistemic} />
              <Tag tone="outline">{c.source.system}</Tag>
            </span>
          </div>
          <p className="mt-1 text-dense text-ink-800">{c.value}</p>
        </li>
      ))}
    </ul>
  );
}
