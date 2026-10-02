/** Commitments — the ledger, grouped by what each tree answers to: a Helm decision, a customer promise, a meeting. No progress bars; evidence and dates speak. */
import { Link } from 'react-router-dom';
import type { CommitmentView, Condition } from '@forge/kernel';
import { AppShell } from '../components/shell/AppShell';
import { CommitmentRow } from '../components/commitment/CommitmentRow';
import { Empty, PageHeader, Panel, Section, SectionHead, Tag, TwoColumn } from '../components/ui/primitives';
import { useForgeQuery } from '../forge/ForgeContext';
import { asTree, loadLedger } from '../forge/queries';
import { plural, word, wordLower } from '../lib/format';

const SOURCES: readonly { kind: string; one: string; many: string }[] = [
  { kind: 'DECISION', one: 'Helm decision', many: 'Helm decisions' },
  { kind: 'OBLIGATION', one: 'customer promise', many: 'customer promises' },
  { kind: 'COMMUNICATION', one: 'meeting', many: 'meetings' },
];

/** “one Helm decision, one customer promise and one meeting” — what the trees answer to, by kind. */
function answerTo(views: readonly CommitmentView[]): string {
  const roots = new Map<string, string>();
  for (const v of views) roots.set(v.record.origin.ref ?? v.record.id, v.record.origin.kind);
  const kinds = [...roots.values()];
  const parts = SOURCES.map((s) => ({ s, n: kinds.filter((k) => k === s.kind).length })).filter((x) => x.n > 0).map(({ s, n }) => `${wordLower(n)} ${plural(n, s.one, s.many)}`);
  const other = kinds.filter((k) => !SOURCES.some((s) => s.kind === k)).length;
  if (other > 0) parts.push(`${wordLower(other)} other ${plural(other, 'source')}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'nothing yet');
}

function headline(views: readonly CommitmentView[], conditions: readonly Condition[]): string {
  const open = views.filter((v) => v.phase === 'ACTIVE' || v.phase === 'PROPOSED').length;
  const pastDue = new Set(conditions.filter((c) => c.code === 'PAST_DUE').map((c) => c.commitmentId)).size;
  const disputed = new Set(conditions.filter((c) => c.code === 'EVIDENCE_CONFLICT' || c.code === 'EVIDENCE_CONTRADICTED').map((c) => c.commitmentId)).size;
  let s = `${word(views.length)} ${plural(views.length, 'commitment')} answer to ${answerTo(views)}; ${wordLower(open)} ${plural(open, 'is', 'are')} open.`;
  if (pastDue) s += ` ${word(pastDue)} ${plural(pastDue, 'is', 'are')} past due.`;
  if (disputed) s += ` The evidence on ${wordLower(disputed)} disagrees.`;
  return s;
}

export function LedgerPage() {
  const ledger = useForgeQuery((d, scope) => loadLedger(d, scope));
  if (!ledger) return <AppShell>{null}</AppShell>;
  const groups = new Map<string, CommitmentView[]>();
  for (const v of ledger.views) {
    const key = v.record.origin.ref ?? `direct:${v.record.id}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const conditionsFor = (id: string) => ledger.conditions.filter((c) => c.commitmentId === id);
  return (
    <AppShell>
      <PageHeader
        kicker="Management · Commitments"
        headline={ledger.views.length ? headline(ledger.views, ledger.conditions) : 'No commitments yet.'}
        lede="Each tree starts at what management decided and ends at who owes what. A commitment is closed by evidence, not by a status someone sets."
      />
      <TwoColumn
        main={
          ledger.views.length === 0 ? (
            <Empty>Nothing has been committed. Draft commitments from a Helm decision to begin.</Empty>
          ) : (
            [...groups.entries()].map(([ref, views]) => {
              const root = views.find((v) => v.record.parentId === null) ?? views[0];
              const o = root.record.origin;
              return (
                <Section key={ref}>
                  <SectionHead
                    title={o.label}
                    aside={
                      <span className="flex items-center gap-2">
                        <Tag tone="accent">
                          {o.system} {o.kind.toLowerCase()}
                        </Tag>
                        {o.system === 'helm' && o.ref && <Link to={`/decisions/${encodeURIComponent(o.ref)}`}>Trace</Link>}
                      </span>
                    }
                  />
                  {asTree(views).map(({ view, depth }) => (
                    <CommitmentRow key={view.record.id} view={view} depth={depth} conditions={conditionsFor(view.record.id)} />
                  ))}
                </Section>
              );
            })
          )
        }
        aside={
          <Panel title="How to read this ledger">
            <ul className="space-y-2 text-dense text-ink-700">
              <li>
                <span className="font-mono text-meta">evidence 1/2</span> counts what proves the promise, not the work done towards it.
              </li>
              <li>
                <span className="font-mono text-meta">
                  <s className="text-ink-400">2 Oct</s> 6 Oct
                </span>{' '}
                — a moved date keeps the one first promised.
              </li>
              <li>Endings are facts set in ink: fulfilled, partly, missed, superseded, cancelled, invalidated, abandoned. Forge does not colour an outcome.</li>
              <li>Nothing here is ranked, scored or totalled.</li>
            </ul>
          </Panel>
        }
      />
    </AppShell>
  );
}
