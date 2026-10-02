/**
 * Been here before — the precedents and lessons Forge finds for a commitment or a draft (`precedentsFor`).
 *
 * The match is Forge's inference and is labelled so, with every tie stated; what the precedents hold is the record —
 * how they ended, against which date, and what people said explains it. Nothing is ranked: most recent first.
 * Endings are set in ink; Forge does not colour an outcome good or bad.
 */
import { Link } from 'react-router-dom';
import type { ApplicableLesson, Precedent, PrecedentReading, Said } from '@forge/kernel';
import { Empty, Section, SectionHead } from '../ui/primitives';
import { EpistemicTag } from './tags';
import { fmtDate, relativeDays } from '../../lib/format';

const ENDING: Record<Precedent['resolution'], string> = {
  FULFILLED: 'fulfilled',
  PARTIALLY_FULFILLED: 'partly fulfilled',
  MISSED: 'missed',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
  INVALIDATED: 'invalidated',
  ABANDONED: 'abandoned',
};

function Quote({ said, kind }: { said: Said; kind: 'explanation' | 'lesson' }) {
  return (
    <div className="mt-2">
      <p className="flex items-baseline gap-2">
        <EpistemicTag value={kind === 'lesson' ? 'RECOMMENDATION' : 'INFERENCE'} />
        <span className="font-mono text-tag uppercase text-ink-500">{kind}</span>
      </p>
      <p className={`mt-1 font-serif text-read ${said.withheld ? 'text-ink-500' : 'text-ink-900'} italic`}>{said.statement}</p>
      <p className="text-meta text-ink-500">
        {said.author}
        {said.appliesTo && !said.withheld && <> · applies to {said.appliesTo}</>}
      </p>
    </div>
  );
}

function PrecedentRow({ p }: { p: Precedent }) {
  return (
    <article className="border-b border-ink-200 py-4">
      <Link to={`/c/${p.commitmentId}`} className="font-serif text-panel">
        {p.statement}
      </Link>
      <p className="mt-1 text-meta text-ink-600">
        {p.owner} · <span className="text-ink-900">{ENDING[p.resolution]}</span> on <span className="font-mono">{fmtDate(p.closedAt)}</span> ·{' '}
        <span className="font-mono">{relativeDays(p.daysAgainstOriginal)}</span> against the date first promised
        {p.redates > 0 && <> · date moved {p.redates === 1 ? 'once' : `${p.redates} times`}</>}
      </p>
      <ul className="mt-2">
        {p.ties.map((t, i) => (
          <li key={i} className="flex items-baseline gap-2 text-meta text-ink-600">
            <EpistemicTag value="INFERENCE" />
            <span>{t.statement}</span>
          </li>
        ))}
      </ul>
      {p.explanations.map((s, i) => (
        <Quote key={`e${i}`} said={s} kind="explanation" />
      ))}
      {p.lessons.map((s, i) => (
        <Quote key={`l${i}`} said={s} kind="lesson" />
      ))}
    </article>
  );
}

function LessonRow({ l }: { l: ApplicableLesson }) {
  return (
    <article className="border-b border-ink-200 py-3 last:border-b-0">
      <p className={`font-serif text-read italic ${l.withheld ? 'text-ink-500' : 'text-ink-900'}`}>{l.statement}</p>
      <p className="mt-1 text-meta text-ink-500">
        {l.author} · learned on <Link to={`/c/${l.commitmentId}`}>{l.commitmentStatement}</Link>
      </p>
      <p className="mt-1 flex items-baseline gap-2 text-meta text-ink-600">
        <EpistemicTag value="INFERENCE" />
        <span>{l.why}</span>
      </p>
    </article>
  );
}

/** The full reading, as a section of a commitment's page. */
export function PrecedentsSection({ reading }: { reading: PrecedentReading }) {
  const nothing = reading.precedents.length === 0 && reading.lessons.length === 0;
  return (
    <Section>
      <SectionHead id="precedents" title="Been here before" aside={<span className="font-mono">{reading.rule}</span>} />
      {nothing ? (
        <Empty>{reading.headline}</Empty>
      ) : (
        <>
          <p className="font-serif text-lede text-ink-900">{reading.headline}</p>
          {reading.caveat && <p className="forge-caveat mt-1">{reading.caveat}</p>}
          {reading.precedents.map((p) => (
            <PrecedentRow key={p.commitmentId} p={p} />
          ))}
          {reading.lessons.length > 0 && (
            <div className="mt-4">
              <p className="forge-label mb-1">Lessons that may apply</p>
              {reading.lessons.map((l, i) => (
                <LessonRow key={`${l.commitmentId}-${i}`} l={l} />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/** Only the lessons, for where someone is about to take something on: a draft at intake, the accept dialog. */
export function LessonsThatMayApply({ reading }: { reading: PrecedentReading }) {
  if (reading.lessons.length === 0) return null;
  return (
    <div className="mt-3 border-t border-ink-200 pt-2">
      <p className="forge-label mb-1">
        {reading.lessons.length === 1 ? 'A lesson that may apply' : `${reading.lessons.length} lessons that may apply`}
      </p>
      {reading.lessons.map((l, i) => (
        <LessonRow key={`${l.commitmentId}-${i}`} l={l} />
      ))}
    </div>
  );
}
