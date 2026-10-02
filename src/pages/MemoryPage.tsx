/**
 * Memory — organizational execution memory (§18, §30). Each concluded
 * commitment leaves an episode in the shape Helm's genome wraps by reference:
 * situation through learning, every line classed, nothing graded. Below the
 * episode, the execution records: what was observed of each party's
 * commitments — facts with their sample size, never a score or a rank.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type ExecutionEpisode, episodeSections, executionRecords, type RecordGrouping } from '@forge/kernel';
import { ExecutionRecords } from '../components/records/ExecutionRecords';
import { AppShell } from '../components/shell/AppShell';
import { EpistemicTag, PhaseTag } from '../components/commitment/tags';
import { Empty, Mono, PageHeader, Panel, Section, SectionHead, TwoColumn } from '../components/ui/primitives';
import { useForgeQuery } from '../forge/ForgeContext';
import { humanize, plural, word } from '../lib/format';

export function MemoryPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<RecordGrouping>('owner');
  const data = useForgeQuery(async (d, scope) => {
    const views = await d.runtime.list(scope);
    const all = views.ok ? views.value : [];
    const closed = all.filter((v) => v.phase === 'CLOSED');
    const episodes: { id: string; episode: ExecutionEpisode }[] = [];
    for (const v of closed) {
      const e = await d.runtime.episode(scope, v.record.id);
      if (e.ok) episodes.push({ id: v.record.id, episode: e.value });
    }
    return { all, closed, episodes };
  });
  if (!data) return <AppShell>{null}</AppShell>;
  const { all, closed, episodes } = data;
  const records = executionRecords(all, groupBy);
  const lessons = closed.flatMap((v) => v.learnings.filter((l) => l.learning.kind === 'LESSON').map((l) => ({ l, v })));
  const current = episodes.find((e) => e.id === selected) ?? episodes.find((e) => e.episode.sections.learning.length > 0) ?? episodes[0];

  return (
    <AppShell>
      <PageHeader
        kicker="Management · Memory"
        headline={
          closed.length === 0
            ? 'Nothing has concluded yet, so nothing is remembered yet.'
            : `${word(closed.length)} ${plural(closed.length, 'commitment has', 'commitments have')} concluded; ${lessons.length === 0 ? 'no lesson is kept yet' : `${word(lessons.length).toLowerCase()} ${plural(lessons.length, 'lesson is', 'lessons are')} kept`}.`
        }
        lede="When a commitment ends, Forge keeps what happened in the shape Helm’s genome reads — process and outcome side by side, graded by neither."
      />
      <TwoColumn
        main={
          <>
            {current ? (
              <Section>
                <SectionHead
                  title={closed.find((v) => v.record.id === current.id)?.terms.statement ?? current.episode.ref}
                  aside={<Link to={`/c/${current.id}`}>Open the commitment</Link>}
                />
                <p className="mt-2 text-meta text-ink-500">
                  <Mono>{current.episode.ref}</Mono> · <Mono>{current.episode.fingerprint}</Mono> · {current.episode.complete ? 'complete' : 'so far'}
                </p>
                {episodeSections.map((s) =>
                  current.episode.sections[s].length === 0 ? null : (
                    <div key={s} className="mt-6">
                      <p className="forge-label mb-1">{humanize(s)}</p>
                      <ul className="border-t border-ink-200">
                        {current.episode.sections[s].map((st, i) => (
                          <li key={i} className="flex items-baseline gap-2 border-b border-ink-200 py-2">
                            <EpistemicTag value={st.class} />
                            <span className={`text-dense ${s === 'learning' || s === 'explanation' ? 'font-serif text-[16px] leading-6 text-ink-950' : 'text-ink-800'}`}>{st.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
              </Section>
            ) : (
              <Empty>Advance the demo clock: episodes appear as commitments conclude.</Empty>
            )}
            <Section>
              <SectionHead title="Execution records" small aside={`${records.length} ${plural(records.length, groupBy === 'owner' ? 'owner' : 'principal')}`} />
              <ExecutionRecords records={records} groupBy={groupBy} onGroupBy={setGroupBy} />
            </Section>
          </>
        }
        aside={
          <>
            <Panel title="Concluded">
              {closed.length === 0 && <p className="text-dense text-ink-600">None yet.</p>}
              <ul>
                {closed.map((v) => (
                  <li key={v.record.id} className="border-b border-ink-200 py-2 last:border-b-0">
                    <button type="button" onClick={() => setSelected(v.record.id)} className={`text-left text-dense ${current?.id === v.record.id ? 'font-medium text-ink-950' : 'text-accent-700 hover:underline'}`}>
                      {v.terms.statement}
                    </button>
                    <p className="mt-0.5 flex items-center gap-2 text-meta text-ink-500">
                      {v.terms.owner.label} <PhaseTag view={v} />
                      {v.publications.length > 0 && <span title={v.publications[v.publications.length - 1].publication.fingerprint}>published to Helm</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="For Helm’s genome">
              <p className="text-dense text-ink-700">
                Each episode has a stable reference and a fingerprint. A verified outcome is published for Helm: Helm records it as its own outcome review, and its genome binds that review to an episode. People author the patterns; Forge proposes none.
              </p>
            </Panel>
          </>
        }
      />
    </AppShell>
  );
}
