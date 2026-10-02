/**
 * Asks — human-in-the-loop by exception (§21). The page opens on a sentence
 * about what needs the reader, then what waits on others, and beside it what
 * Forge learned from systems without asking anyone. What Forge read from notes
 * and from Memoire waits here too — as candidates, for a person to confirm.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asksFor, type CandidateView, type Condition, sameParty } from '@forge/kernel';
import { AppShell } from '../components/shell/AppShell';
import { ConditionRow } from '../components/commitment/ConditionRow';
import { CandidateList, ConfirmCandidateDialog, DismissCandidateDialog, ReadNotesDialog } from '../components/candidates/Candidates';
import { forReader } from '../components/candidates/order';
import { useActionDialog } from '../components/commitment/useActionDialog';
import { Button, Empty, PageHeader, Panel, Section, SectionHead, TwoColumn } from '../components/ui/primitives';
import { useForge, useForgeQuery } from '../forge/ForgeContext';
import { evidenceSourcing, loadLedger, pendingIntakeCount } from '../forge/queries';
import { plural, word, wordLower } from '../lib/format';

function headline(mine: readonly Condition[]): string {
  if (mine.length === 0) return 'Nothing needs you. Forge is reading the rest from the systems where the work happens.';
  const c = mine.filter((x) => x.severity === 'CANNOT_WAIT').length;
  const w = mine.filter((x) => x.severity === 'THIS_WEEK').length;
  const n = mine.filter((x) => x.severity === 'NOTED').length;
  const parts: string[] = [];
  if (c) parts.push(`${word(c)} ${plural(c, 'thing')} cannot wait.`);
  if (w) parts.push(`${word(w)} ${c ? 'more ' : ''}${plural(w, 'needs', 'need')} you this week.`);
  if (n) parts.push(`${word(n)} ${plural(n, 'is', 'are')} noted for when there is time.`);
  return parts.join(' ');
}

type CandidateDialog = { kind: 'confirm' | 'edit' | 'dismiss'; candidate: CandidateView } | { kind: 'notes' } | null;

export function AsksPage() {
  const { reader, demo } = useForge();
  const dialog = useActionDialog();
  const [candidateDialog, setCandidateDialog] = useState<CandidateDialog>(null);
  const data = useForgeQuery(async (d, scope) => {
    const ledger = await loadLedger(d, scope);
    const candidates = await d.runtime.listCandidates(scope);
    return { ledger, intake: await pendingIntakeCount(d, scope), candidates: candidates.ok ? candidates.value : [] };
  });
  if (!data) return <AppShell>{null}</AppShell>;
  const { ledger, intake, candidates } = data;
  const pendingCandidates = forReader(candidates.filter((c) => c.state === 'PENDING'), reader.scope.actsAs);
  const decided = candidates
    .filter((c) => c.state !== 'PENDING')
    .sort((a, b) => ((a.disposition?.at ?? '') < (b.disposition?.at ?? '') ? 1 : -1))
    .slice(0, 4);
  const mine = asksFor(ledger.conditions, reader.scope.actsAs);
  const others = ledger.conditions.filter((c) => c.ask !== null && !reader.scope.actsAs.some((p) => c.ask && sameParty(p, c.ask.whom)));
  const silent = ledger.conditions.filter((c) => c.ask === null);
  const sourcing = evidenceSourcing(ledger.views);
  const open = ledger.views.filter((v) => v.phase === 'ACTIVE' || v.phase === 'PROPOSED');
  const moment = demo.current();

  return (
    <AppShell>
      <PageHeader
        kicker={`Management · Asks · ${reader.name}, ${reader.title}`}
        headline={headline(mine)}
        lede="Forge asks a person only when judgment, authority or disagreeing evidence needs one. It never asks what percent done something is."
      />
      <TwoColumn
        main={
          <>
            <Section>
              <SectionHead title="For you" aside={mine.length ? `${mine.length} ${plural(mine.length, 'ask')}` : undefined} />
              {mine.length === 0 ? (
                <Empty>Nothing on the ledger is waiting for {reader.title}.</Empty>
              ) : (
                mine.map((c, i) => <ConditionRow key={`${c.commitmentId}-${c.code}-${i}`} condition={c} view={ledger.byId.get(c.commitmentId)} onAct={dialog.open} />)
              )}
            </Section>
            <Section>
              <SectionHead title="Waiting on others" small aside={others.length ? `${others.length}` : undefined} />
              {others.length === 0 ? (
                <Empty>Nobody else is being asked anything.</Empty>
              ) : (
                others.map((c, i) => <ConditionRow key={`${c.commitmentId}-${c.code}-o${i}`} condition={c} view={ledger.byId.get(c.commitmentId)} onAct={dialog.open} />)
              )}
            </Section>
            <Section>
              <SectionHead title="Read, not yet commitments" small aside={pendingCandidates.length ? `${pendingCandidates.length} waiting` : undefined} />
              <CandidateList
                candidates={pendingCandidates}
                emptyText="Nothing Forge read is waiting. Promises it reads in meeting notes or in Memoire appear here as candidates — never as commitments."
                onOpen={(candidate, mode) => setCandidateDialog({ kind: mode, candidate })}
                onDismiss={(candidate) => setCandidateDialog({ kind: 'dismiss', candidate })}
              />
              {decided.length > 0 && (
                <>
                  <p className="forge-label mt-6">Recently decided</p>
                  <CandidateList candidates={decided} emptyText="" onOpen={() => undefined} onDismiss={() => undefined} />
                </>
              )}
            </Section>
            {silent.length > 0 && (
              <Section>
                <SectionHead title="Noted, nobody asked" small />
                {silent.map((c, i) => (
                  <ConditionRow key={`s${i}`} condition={c} view={ledger.byId.get(c.commitmentId)} onAct={dialog.open} />
                ))}
              </Section>
            )}
          </>
        }
        aside={
          <>
            {moment && (
              <Panel title={moment.title}>
                <p className="text-dense text-ink-700">{moment.description}</p>
              </Panel>
            )}
            <Panel title="Read, not reported">
              <p className="text-dense text-ink-700">
                Of the evidence on the ledger, <strong className="font-medium text-ink-950">{sourcing.system}</strong> {plural(sourcing.system, 'piece')} came from the systems where the work was done and{' '}
                <strong className="font-medium text-ink-950">{sourcing.person}</strong> from a person’s word
                {sourcing.inference > 0 && <>; {sourcing.inference} {plural(sourcing.inference, 'is an inference', 'are inferences')} awaiting confirmation</>}. Nobody was asked for a status update.
              </p>
              <p className="mt-2 text-meta text-ink-500">
                {sourcing.activity} activity {plural(sourcing.activity, 'reading')} from trackers, kept apart from evidence. {open.length} {plural(open.length, 'commitment')} open.
              </p>
            </Panel>
            <Panel title="Read meeting notes">
              <p className="text-dense text-ink-700">Paste what was said. Forge proposes the promises in it as candidates, with the exact words each rests on; discussion, requests and intentions stay what they were.</p>
              <Button size="sm" className="mt-3" onClick={() => setCandidateDialog({ kind: 'notes' })}>
                Read notes…
              </Button>
            </Panel>
            {intake > 0 && (
              <Panel title={`${word(intake)} Helm ${plural(intake, 'decision')} not yet in Forge`}>
                <p className="text-dense text-ink-700">
                  Management committed {intake === 1 ? 'a decision' : `${wordLower(intake)} decisions`} that nobody has turned into owned commitments yet. Forge drafts them from what Helm already knows.
                </p>
                <Link to="/decisions" className="mt-2 inline-block text-dense">
                  See the decisions →
                </Link>
              </Panel>
            )}
          </>
        }
      />
      {dialog.element}
      {candidateDialog?.kind === 'notes' && <ReadNotesDialog onClose={() => setCandidateDialog(null)} />}
      {(candidateDialog?.kind === 'confirm' || candidateDialog?.kind === 'edit') && (
        <ConfirmCandidateDialog candidate={candidateDialog.candidate} mode={candidateDialog.kind} onClose={() => setCandidateDialog(null)} />
      )}
      {candidateDialog?.kind === 'dismiss' && <DismissCandidateDialog candidate={candidateDialog.candidate} onClose={() => setCandidateDialog(null)} />}
    </AppShell>
  );
}
