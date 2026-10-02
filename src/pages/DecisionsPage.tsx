/** Decisions — what management committed in Helm, and whether anyone owns it yet. */
import { Link, useNavigate } from 'react-router-dom';
import { decisionFidelity } from '@forge/fabric';
import { AppShell } from '../components/shell/AppShell';
import { Button, Empty, PageHeader, Panel, Section, SectionHead, Tag, TwoColumn } from '../components/ui/primitives';
import { useForgeQuery } from '../forge/ForgeContext';
import { loadDecisions } from '../forge/queries';
import { fmtDate, plural, word, wordLower } from '../lib/format';

export function DecisionsPage() {
  const navigate = useNavigate();
  const decisions = useForgeQuery((d, scope) => loadDecisions(d, scope));
  if (!decisions) return <AppShell>{null}</AppShell>;
  const pending = decisions.filter((d) => d.commitments.length === 0);
  const headline =
    decisions.length === 0
      ? 'Helm has committed nothing Forge can see.'
      : pending.length === 0
        ? `${word(decisions.length)} ${plural(decisions.length, 'decision')} committed in Helm, and every one has owners in Forge.`
        : `${word(decisions.length)} ${plural(decisions.length, 'decision')} committed in Helm; ${wordLower(pending.length)} ${plural(pending.length, 'has', 'have')} nobody behind ${pending.length === 1 ? 'it' : 'them'} yet.`;
  return (
    <AppShell>
      <PageHeader
        kicker="Management · Decisions"
        headline={headline}
        lede="Helm decides; Forge turns each decision into commitments people own, and reports back what happened. Forge reads Helm and never writes to it."
      />
      <TwoColumn
        main={
          <Section>
            <SectionHead title="Committed in Helm" />
            {decisions.length === 0 && <Empty>No committed decisions yet.</Empty>}
            {decisions.map(({ decision, ref, commitments }) => {
              const closed = commitments.filter((c) => c.phase === 'CLOSED').length;
              return (
                <article key={ref} className="border-b border-ink-200 py-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h3 className="text-signal text-ink-950">{decision.decision.title}</h3>
                    <span className="flex gap-1.5">
                      {decision.demo && <Tag tone="outline">demo</Tag>}
                      <Tag tone="accent">helm decision</Tag>
                    </span>
                  </div>
                  <p className="mt-1 font-serif text-[16px] italic leading-6 text-ink-700">{decision.decision.managementQuestion}</p>
                  <p className="mt-2 text-dense text-ink-800">{decision.commitment.summary}</p>
                  <p className="mt-2 text-meta text-ink-500">
                    Committed {fmtDate(decision.commitment.committedAt)} by {decision.commitment.committedBy.label} · chose {decision.commitment.chosenAlternative.label} · {decision.actionIntents.length}{' '}
                    {plural(decision.actionIntents.length, 'action intent')}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    {commitments.length === 0 ? (
                      <>
                        <Button variant="primary" size="sm" onClick={() => navigate(`/decisions/${encodeURIComponent(ref)}/intake`)}>
                          Draft commitments
                        </Button>
                        <span className="text-meta text-amber-800">Nobody owns this decision’s execution yet.</span>
                      </>
                    ) : (
                      <>
                        <Link to={`/decisions/${encodeURIComponent(ref)}`} className="text-dense">
                          Trace from decision to outcome →
                        </Link>
                        <span className="font-mono text-meta text-ink-500">
                          {commitments.length} {plural(commitments.length, 'commitment')} · {closed} closed
                        </span>
                      </>
                    )}
                  </div>
                  {commitments.length > 0 && (
                    <p className="mt-2 text-meta text-ink-700">{decisionFidelity(decision, commitments, decisions.map((x) => x.decision)).headline}</p>
                  )}
                </article>
              );
            })}
          </Section>
        }
        aside={
          <Panel title="Where Forge sits">
            <p className="text-dense text-ink-700">Memoire knows commercial reality. Helm understands and decides. Forge commits and executes, and observes the outcome. Helm learns from it.</p>
            <p className="mt-2 text-meta text-ink-500">Forge publishes what happened in the envelope Helm’s integration fabric already reads — see Surfaces.</p>
          </Panel>
        }
      />
    </AppShell>
  );
}
