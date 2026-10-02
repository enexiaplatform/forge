/**
 * Surfaces — instrument page. The systems Forge observes, what each reported,
 * what that became on the ledger, and what Forge published back for Helm.
 */
import { Link } from 'react-router-dom';
import { outboundEvents } from '@forge/fabric';
import { AppShell } from '../components/shell/AppShell';
import { Kicker, Mono, Section, SectionHead, Tag } from '../components/ui/primitives';
import { useForge, useForgeQuery } from '../forge/ForgeContext';
import { fmtMoment } from '../lib/format';

const EFFECT_TEXT = {
  ACTIVITY: 'activity',
  EVIDENCE_SUPPORTS: 'evidence · supports',
  EVIDENCE_CONTRADICTS: 'evidence · contradicts',
  DEPENDENCY_SETTLED: 'dependency settled',
  CONTEXT_CHANGED: 'context changed',
} as const;

export function SurfacesPage() {
  const { demo } = useForge();
  const data = useForgeQuery(async (d, scope) => {
    const views = await d.runtime.list(scope);
    return { views: views.ok ? views.value : [] };
  });
  if (!data) return <AppShell wide>{null}</AppShell>;
  const entries = [...demo.ledger.entries()].sort((a, b) => (a.observation.occurredAt < b.observation.occurredAt ? 1 : -1));
  const statementOf = (id: string) => data.views.find((v) => v.record.id === id)?.terms.statement ?? id;
  const events = outboundEvents(data.views).reverse();

  return (
    <AppShell wide>
      <header className="mb-8">
        <Kicker>Instrument · Execution surfaces</Kicker>
        <h1 className="text-instrument text-ink-950">Execution surfaces, observations and what Forge published</h1>
        <p className="mt-2 max-w-reading text-dense text-ink-600">
          Forge never asks for the work to move into it. It reads what each system recorded; only a record that matches what a commitment said would prove it becomes evidence.
        </p>
      </header>

      <Section>
        <SectionHead title="Surfaces" aside={`${demo.surfaces.length} connected · fixture adapters`} />
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink-950">
              <th className="forge-label py-2 font-medium">System</th>
              <th className="forge-label py-2 font-medium">Records</th>
              <th className="forge-label py-2 font-medium">Checkpoint</th>
              <th className="forge-label py-2 text-right font-medium">Observed</th>
            </tr>
          </thead>
          <tbody>
            {demo.surfaces.map((s) => {
              const cp = demo.ledger.checkpoint(s);
              return (
                <tr key={s.system} className="border-b border-ink-200 align-baseline">
                  <td className="py-2.5 pr-4">
                    <span className="font-mono text-meta text-ink-900">{s.system}</span> <span className="text-dense text-ink-700">{s.label}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-dense text-ink-600">{s.describes}</td>
                  <td className="py-2.5 pr-4 font-mono text-meta text-ink-600">{cp ? fmtMoment(cp) : '—'}</td>
                  <td className="py-2.5 text-right font-mono text-meta text-ink-700">{entries.filter((e) => e.system === s.system).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section>
        <SectionHead title="Observation ledger" aside="newest first · each observation once" />
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink-950">
              <th className="forge-label w-[110px] py-2 font-medium">Occurred</th>
              <th className="forge-label w-[220px] py-2 font-medium">System · event · object</th>
              <th className="forge-label py-2 font-medium">What it recorded</th>
              <th className="forge-label py-2 font-medium">Became</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ observation: o }) => {
              const effects = demo.ingested.filter((e) => e.observationId === o.id);
              return (
                <tr key={`${o.system}-${o.id}`} className="border-b border-ink-200 align-top">
                  <td className="py-2.5 pr-3 font-mono text-meta text-ink-600">{fmtMoment(o.occurredAt)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="block font-mono text-meta text-ink-900">{o.system} · {o.eventType}</span>
                    <Mono>{o.objectRef}</Mono>
                  </td>
                  <td className="py-2.5 pr-3 text-dense text-ink-800">{o.summary}</td>
                  <td className="py-2.5 text-dense">
                    {effects.length === 0 ? (
                      <span className="text-meta text-ink-500">nothing was waiting for it — kept on the ledger</span>
                    ) : (
                      effects.map((e, i) => (
                        <span key={i} className="block">
                          <Tag tone={e.kind === 'EVIDENCE_CONTRADICTS' ? 'red' : e.kind === 'ACTIVITY' ? 'outline' : 'emerald'}>{EFFECT_TEXT[e.kind]}</Tag>{' '}
                          <Link to={`/c/${e.commitmentId}`} className="text-meta">
                            {statementOf(e.commitmentId)}
                          </Link>
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section>
        <SectionHead title="Published for Helm" aside="the envelope Helm’s integration fabric reads: eventType · occurredAt · sourceSystem · sourceRef · payload · idempotencyKey" />
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-ink-950">
              <th className="forge-label w-[110px] py-2 font-medium">Occurred</th>
              <th className="forge-label w-[220px] py-2 font-medium">Event</th>
              <th className="forge-label py-2 font-medium">Source · origin</th>
              <th className="forge-label py-2 font-medium">Idempotency key</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.idempotencyKey} className="border-b border-ink-200 align-baseline">
                <td className="py-2 pr-3 font-mono text-meta text-ink-600">{fmtMoment(e.occurredAt)}</td>
                <td className={`py-2 pr-3 font-mono text-meta ${e.eventType === 'review_trigger.observed' ? 'text-red-700' : 'text-ink-900'}`}>{e.eventType}</td>
                <td className="py-2 pr-3 font-mono text-meta text-ink-600">
                  {e.sourceRef} <span className="text-ink-400">←</span> {e.originRef}
                </td>
                <td className="py-2 font-mono text-meta text-ink-500">{e.idempotencyKey}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </AppShell>
  );
}
