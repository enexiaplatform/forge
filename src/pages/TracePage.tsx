/**
 * Decision trace — downward from what management decided to what happened
 * (§14, §15). Every commitment that answers to the decision, its ownership,
 * execution, evidence, outcome and variance, and what Forge told Helm.
 */
import { Link, Navigate, useParams } from 'react-router-dom';
import { type TraceNode } from '@forge/kernel';
import { decisionFidelity, outboundEvents } from '@forge/fabric';
import { FidelitySection } from '../components/commitment/Fidelity';
import { WithheldValue } from '../components/commitment/tags';
import { AppShell } from '../components/shell/AppShell';
import { PhaseTag } from '../components/commitment/tags';
import { EvidenceSummary } from '../components/commitment/CommitmentRow';
import { Empty, FactRow, Kicker, Mono, Panel, Section, SectionHead, Tag, TwoColumn } from '../components/ui/primitives';
import { useForgeQuery } from '../forge/ForgeContext';
import { loadDecisions } from '../forge/queries';
import { fmtDate, fmtMoment, fmtQuantity, fmtSigned, relativeDays } from '../lib/format';

function flatten(nodes: readonly TraceNode[], depth = 0): { node: TraceNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children, depth + 1)]);
}

export function TracePage() {
  const { ref = '' } = useParams();
  const data = useForgeQuery(async (d, scope) => {
    const decisions = await loadDecisions(d, scope);
    const entry = decisions.find((x) => x.ref === ref) ?? null;
    const trace = await d.runtime.traceOrigin(scope, ref);
    return { entry, roots: trace.ok ? trace.value : [], later: decisions.map((x) => x.decision) };
  }, [ref]);
  if (!data) return <AppShell>{null}</AppShell>;
  if (!data.entry) return <AppShell><Empty>Forge cannot see that decision.</Empty></AppShell>;
  if (data.roots.length === 0) return <Navigate to={`/decisions/${encodeURIComponent(ref)}/intake`} replace />;

  const { decision } = data.entry;
  const rows = flatten(data.roots);
  const root = data.roots[0];
  const events = outboundEvents(data.entry.commitments);
  const fidelity = decisionFidelity(decision, data.entry.commitments, data.later);

  return (
    <AppShell>
      <header className="mb-10 max-w-headline">
        <Kicker>Decision trace · Helm {decision.demo ? '· DEMO' : ''}</Kicker>
        <h1 className="text-title text-ink-950">{decision.decision.title}</h1>
        <p className="mt-3 font-serif text-[19px] italic leading-7 text-ink-700">{decision.decision.managementQuestion}</p>
        <p className="mt-3 max-w-reading text-read text-ink-900">{decision.commitment.summary}</p>
      </header>
      <TwoColumn
        main={
          <>
            <Section>
              <SectionHead title="What management expected, and what happened" aside="expected values are Helm’s committed future" />
              {root.variance.measures.length === 0 ? (
                <Empty>No measured outcomes.</Empty>
              ) : (
                <table className="mt-2 w-full text-left">
                  <thead>
                    <tr className="border-b border-ink-950">
                      <th className="forge-label py-2 font-medium">Outcome</th>
                      <th className="forge-label py-2 text-right font-medium">Expected</th>
                      <th className="forge-label py-2 text-right font-medium">Actual</th>
                      <th className="forge-label py-2 text-right font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {root.variance.measures.map((m) => (
                      <tr key={m.key} className="border-b border-ink-200 align-baseline">
                        <td className="py-2.5 pr-3 text-dense text-ink-900">
                          {m.label}
                          {m.comparator === 'QUALITATIVE' && <span className="mt-0.5 block text-meta italic text-ink-500">{m.note ?? 'Not yet observed.'}</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono text-meta text-ink-700">{m.comparator === 'QUALITATIVE' ? 'stated' : fmtQuantity(m.expected, m.unit)}</td>
                        <td className="py-2.5 text-right font-mono text-meta text-ink-900">{m.withheld ? <WithheldValue protection={m.protection} /> : m.comparator === 'QUALITATIVE' ? '—' : fmtQuantity(m.actual, m.unit)}</td>
                        <td className="py-2.5 text-right font-mono text-meta text-ink-900">{m.withheld ? <WithheldValue protection={m.protection} /> : m.difference === null ? '—' : fmtSigned(m.difference, m.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
            <Section>
              <FidelitySection fidelity={fidelity} />
            </Section>
            <Section>
              <SectionHead title="From decision to reality" aside={`${rows.length} commitments`} />
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[640px] text-left">
                  <thead>
                    <tr className="border-b border-ink-950">
                      <th className="forge-label py-2 font-medium">Commitment · owner</th>
                      <th className="forge-label py-2 font-medium">Execution</th>
                      <th className="forge-label py-2 font-medium">Evidence</th>
                      <th className="forge-label py-2 font-medium">Outcome</th>
                      <th className="forge-label py-2 text-right font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ node, depth }) => {
                      const v = node.view;
                      return (
                        <tr key={v.record.id} className="border-b border-ink-200 align-top">
                          <td className="py-3 pr-4" style={{ paddingLeft: depth * 20 }}>
                            <Link to={`/c/${v.record.id}`} className="font-serif text-[15px] leading-5 text-ink-950 no-underline hover:text-accent-800">
                              {v.terms.statement}
                            </Link>
                            <p className="mt-0.5 text-meta text-ink-500">
                              {v.terms.owner.label}
                              {v.acceptance ? '' : ' · not accepted'}
                            </p>
                          </td>
                          <td className="py-3 pr-4 text-meta text-ink-700">
                            {v.links.length === 0 ? '—' : v.links.map((l) => <span key={l.link.id} className="block font-mono">{l.link.ref}{l.activity ? ` ${l.activity.done}/${l.activity.total}` : ''}</span>)}
                          </td>
                          <td className="py-3 pr-4">
                            <EvidenceSummary view={v} />
                          </td>
                          <td className="py-3 pr-4">
                            <PhaseTag view={v} />
                          </td>
                          <td className="py-3 text-right font-mono text-meta text-ink-700">
                            {node.variance.time.endedOn
                              ? relativeDays(node.variance.time.daysAgainstOriginal)
                              : node.variance.time.runningDaysLate
                                ? <span className="text-red-700">{node.variance.time.runningDaysLate}d past</span>
                                : `due ${fmtDate(v.terms.dueBy)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section>
              <SectionHead title="What the enterprise learned" small />
              {rows.flatMap(({ node }) => node.view.learnings.map((l) => ({ l, v: node.view }))).length === 0 ? (
                <Empty>Nothing yet — learning is recorded when commitments end.</Empty>
              ) : (
                rows.flatMap(({ node }) =>
                  node.view.learnings.map((l) => (
                    <div key={l.eventId} className="border-b border-ink-200 py-3">
                      <p className="font-mono text-tag uppercase text-ink-500">{l.learning.kind.toLowerCase()} · {l.actor.label}</p>
                      <p className="mt-1 font-serif text-[17px] leading-7 text-ink-950">{l.learning.statement}</p>
                    </div>
                  )),
                )
              )}
            </Section>
            <Section>
              <SectionHead title="Published to Helm" small aside="Forge never writes into Helm; Helm reads these" />
              {events.map((e) => (
                <div key={e.idempotencyKey} className="grid grid-cols-[92px_200px_1fr] gap-3 border-b border-ink-200 py-2 max-sm:grid-cols-1 max-sm:gap-0.5">
                  <span className="font-mono text-meta text-ink-500">{fmtMoment(e.occurredAt)}</span>
                  <span className={`font-mono text-meta ${e.eventType === 'review_trigger.observed' ? 'text-red-700' : 'text-ink-800'}`}>{e.eventType}</span>
                  <span className="truncate text-meta text-ink-600">
                    {e.eventType === 'review_trigger.observed'
                      ? `Helm’s own trigger “${String(e.payload.triggerKey)}” — ${String(e.payload.dependency)}`
                      : e.eventType === 'outcome.published'
                        ? `The verified outcome, published by ${String(e.payload.publishedBy)} — ${String((e.payload.publication as { fingerprint?: string } | undefined)?.fingerprint ?? '')}`
                        : e.sourceRef}
                  </span>
                </div>
              ))}
            </Section>
          </>
        }
        aside={
          <>
            <Panel title="The decision, as Helm committed it">
              <FactRow label="Chosen">{decision.commitment.chosenAlternative.label}</FactRow>
              <FactRow label="By">{decision.commitment.committedBy.label}</FactRow>
              <FactRow label="On">
                <span className="font-mono text-meta">{fmtDate(decision.commitment.committedAt)}</span>
              </FactRow>
              <FactRow label="Fingerprint">
                <Mono>{decision.commitment.fingerprint}</Mono>
              </FactRow>
              <p className="mt-3 text-meta text-ink-500">Read from Helm by reference; the snapshot Forge took when the commitments were made is frozen on each of them.</p>
            </Panel>
            {decision.commitment.acceptedTradeOffs.length > 0 && (
              <Panel title="Trade-offs management accepted">
                {decision.commitment.acceptedTradeOffs.map((t) => (
                  <div key={t.label} className="border-b border-ink-200 py-2 last:border-b-0">
                    <p className="forge-label">{t.label}</p>
                    <p className="mt-0.5 text-dense text-ink-800">{t.statement}</p>
                  </div>
                ))}
              </Panel>
            )}
            {decision.assumptions.length > 0 && (
              <Panel title="What it rested on">
                {decision.assumptions.map((a) => (
                  <div key={a.statement} className="border-b border-ink-200 py-2 last:border-b-0">
                    <p className="flex items-center gap-2">
                      <Tag tone="amber">assumption</Tag>
                      <span className="font-mono text-tag uppercase text-ink-500">{a.criticality.toLowerCase()}</span>
                    </p>
                    <p className="mt-1 text-dense text-ink-800">{a.statement}</p>
                    <p className={`mt-0.5 text-meta ${a.ownerLabel ? 'text-ink-500' : 'text-red-700'}`}>{a.ownerLabel ?? 'Nobody stands behind this.'}</p>
                  </div>
                ))}
              </Panel>
            )}
          </>
        }
      />
    </AppShell>
  );
}
