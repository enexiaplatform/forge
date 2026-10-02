/**
 * One commitment, as one coherent chain (§28): why it exists, what was promised
 * and by whom, where the work happens, what proves it, what happened, and what
 * was learned — with its asks on top and its full history underneath.
 */
import { Link, useParams } from 'react-router-dom';
import { type CommitmentView, conditionsOf, precedentsFor, subjectOf } from '@forge/kernel';
import { AppShell } from '../components/shell/AppShell';
import { ChainStrip } from '../components/commitment/ChainStrip';
import { ConditionRow } from '../components/commitment/ConditionRow';
import { useActionDialog } from '../components/commitment/useActionDialog';
import { availableActs } from '../components/commitment/acts';
import { DueDate, EvidenceSummary } from '../components/commitment/CommitmentRow';
import { ContextList, EvidenceSection, ExecutionSection, HistorySection, LearningSection, OutcomeSection, PromiseSection, WhySection } from '../components/commitment/sections';
import { PhaseTag } from '../components/commitment/tags';
import { PrecedentsSection } from '../components/commitment/Precedents';
import { AssumptionsSection } from '../components/records/Assumptions';
import { Button, Empty, Kicker, Mono, Panel, Section, SectionHead, TwoColumn } from '../components/ui/primitives';
import { useForge, useForgeQuery } from '../forge/ForgeContext';
import { loadLedger } from '../forge/queries';

export function CommitmentPage() {
  const { id = '' } = useParams();
  const { reader } = useForge();
  const dialog = useActionDialog();
  const data = useForgeQuery(async (d, scope) => {
    const ledger = await loadLedger(d, scope);
    const trace = await d.runtime.trace(scope, id);
    return { ledger, ancestors: trace.ok ? trace.value.ancestors : [] };
  }, [id]);

  if (!data) return <AppShell>{null}</AppShell>;
  const view = data.ledger.byId.get(id);
  if (!view) {
    return (
      <AppShell>
        <Empty>
          That commitment is not on the ledger at this moment. <Link to="/commitments">Back to commitments</Link>
        </Empty>
      </AppShell>
    );
  }
  const lookup = (cid: string) => data.ledger.byId.get(cid) ?? null;
  const conditions = conditionsOf(view, lookup);
  const children = data.ledger.views.filter((v) => v.record.parentId === view.record.id);
  const acts = availableActs(view, reader.scope);
  const precedents = precedentsFor(subjectOf(view), data.ledger.views);
  const demoLabel = view.record.origin.snapshot && (view.record.origin.snapshot as { demo?: boolean }).demo ? ' · DEMO' : '';

  return (
    <AppShell>
      <header className="mb-8 max-w-headline">
        <Kicker>
          Commitment · answers to {view.record.origin.system} {view.record.origin.kind.toLowerCase()}
          {demoLabel}
        </Kicker>
        <h1 className="text-title text-ink-950">{view.terms.statement}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-700">
          <span>
            {view.terms.owner.label} <span className="text-ink-400">promised</span> {view.terms.principal.label}
          </span>
          <PhaseTag view={view} />
          <DueDate view={view} />
          <EvidenceSummary view={view} />
        </p>
      </header>
      <ChainStrip view={view} />
      <TwoColumn
        main={
          <>
            {conditions.length > 0 && (
              <Section>
                <SectionHead title="Needs a person" aside={`${conditions.length}`} />
                {conditions.map((c, i) => (
                  <ConditionRow key={`${c.code}-${i}`} condition={c} view={view} onAct={dialog.open} showCommitment={false} />
                ))}
              </Section>
            )}
            <WhySection view={view} ancestors={data.ancestors} />
            <PromiseSection view={view} />
            <AssumptionsSection view={view} />
            <PrecedentsSection reading={precedents} />
            <ExecutionSection view={view} lookup={lookup} />
            <EvidenceSection view={view} />
            <OutcomeSection view={view} />
            <LearningSection view={view} />
            <HistorySection view={view} />
          </>
        }
        aside={
          <>
            <Panel title={`What ${reader.name} can do`}>
              {acts.length === 0 ? (
                <p className="text-dense text-ink-600">
                  Nothing, as {reader.title}: the owner accepts and reports, the party it was promised to changes it. Pick someone else under “Reading as” to act for them.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {acts.map((a) => (
                    <Button key={a.act} variant={a.primary ? 'primary' : 'secondary'} onClick={() => dialog.open(view, a.act)}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
              <p className="mt-3 text-meta text-ink-500">
                Authority: <Mono>forge-interim-authority@1</Mono>, until Helm’s authority service answers the same port.
              </p>
            </Panel>
            {children.length > 0 && (
              <Panel title="Beneath it">
                <ul>
                  {children.map((c: CommitmentView) => (
                    <li key={c.record.id} className="border-b border-ink-200 py-2 last:border-b-0">
                      <Link to={`/c/${c.record.id}`} className="text-dense">
                        {c.terms.statement}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-2 text-meta text-ink-500">
                        {c.terms.owner.label} <PhaseTag view={c} />
                      </p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <Panel title="Inherited context">
              <p className="mb-2 text-meta text-ink-500">Carried in from Helm and Memoire when the commitment was made — referenced, not copied, and never retyped.</p>
              <ContextList fields={view.record.context} />
            </Panel>
            <p className="forge-meta px-1">
              {view.record.id} · {view.record.fingerprint}
            </p>
          </>
        }
      />
      {dialog.element}
    </AppShell>
  );
}
