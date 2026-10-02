/**
 * Precedents — what the enterprise already lived through that looks like this (§18, §20 "finding relevant historical
 * precedents", §30 "LEARNING → BETTER FUTURE DECISIONS").
 *
 * A lesson recorded when a commitment ended is only worth keeping if it comes back when something like it begins.
 * For a commitment — or a draft not yet proposed — Forge finds the concluded commitments that share something
 * concrete with it, says exactly what they share, and brings back how they ended and what people said explains it
 * and should be done differently. It also finds lessons whose stated scope ("applies to …") names what this promise
 * is about.
 *
 * Every match is an INFERENCE under a named rule, and says why it matched; the lessons themselves are what people
 * wrote, attributed. Nothing is ranked by likeness or by how things ended: precedents come most recent first, and a
 * handful of cases says it is a handful. A match that only shares an owner is not a precedent — that is the owner's
 * execution record, not a resemblance; nor is a shared customer alone, since everything done for a key account
 * shares it.
 */

import { sameParty } from './primitives.ts';
import type { CommitmentView } from './derive.ts';
import type { ContextField, Dependency, Resolution, Terms } from './types.ts';
import { varianceOf } from './variance.ts';

export const PRECEDENT_RULES = 'forge-precedent-rules@1';

/** What is matched: a commitment on the ledger, or a draft (intake) that has no id yet. */
export type PrecedentSubject = {
  readonly id: string | null;
  /** The decision, objective or obligation it answers to; precedents come from elsewhere. */
  readonly originRef: string | null;
  readonly terms: Terms;
  readonly context: readonly ContextField[];
  readonly dependencies: readonly Dependency[];
  readonly links: readonly { readonly system: string; readonly ref: string }[];
};

export const subjectOf = (v: CommitmentView): PrecedentSubject => ({
  id: v.record.id,
  originRef: v.record.origin.ref,
  terms: v.terms,
  context: v.record.context,
  dependencies: v.dependencies.map((d) => d.dependency),
  links: v.links.map((l) => ({ system: l.link.system, ref: l.link.ref })),
});

export type PrecedentTie = {
  readonly kind: 'SAME_ENTITY' | 'SAME_OBJECT' | 'SIMILAR_PROMISE' | 'SAME_OWNER';
  readonly statement: string;
};

export type Said = { readonly statement: string; readonly author: string; readonly appliesTo: string | null; readonly withheld: boolean };

export type Precedent = {
  readonly commitmentId: string;
  readonly statement: string;
  readonly owner: string;
  readonly resolution: Resolution;
  readonly closedAt: string;
  /** Days the ending fell after (positive) or before the date first promised. */
  readonly daysAgainstOriginal: number | null;
  readonly redates: number;
  /** Why Forge thinks it resembles this one — every tie stated. */
  readonly ties: readonly PrecedentTie[];
  /** What people said explains it, and what to do differently — on it, or on what it was part of. */
  readonly explanations: readonly Said[];
  readonly lessons: readonly Said[];
};

export type ApplicableLesson = Said & {
  readonly commitmentId: string;
  readonly commitmentStatement: string;
  readonly at: string;
  /** Why Forge thinks it may apply here. */
  readonly why: string;
};

export type PrecedentReading = {
  readonly rule: typeof PRECEDENT_RULES;
  /** The matching is Forge's inference; what the precedents hold is the record. */
  readonly epistemic: 'INFERENCE';
  readonly precedents: readonly Precedent[];
  readonly lessons: readonly ApplicableLesson[];
  /** A computed sentence: the answer, not a label. */
  readonly headline: string;
  readonly caveat: string | null;
};

// ------------------------------------------------------------------ words

const STOP = new Set(
  'about above after again against also among another back been before being below between both cannot could does doing down during each even every from further have having here into itself just more most must once only other over same should since some such than that their them then there these they this those through under until upon very were what when where which while will with within without would your'.split(
    ' ',
  ),
);
/** Words too common in promises to tell two of them apart. */
const GENERIC = new Set(['stock', 'order', 'unit', 'item', 'work', 'customer', 'team', 'plan', 'date', 'week', 'month', 'quarter', 'need', 'make', 'confirm', 'update']);

const stem = (w: string): string => w.replace(/ies$/, 'y').replace(/(?<=[a-z]{4})(es|s)$/, '');

/** The distinctive words of a text, stemmed: four letters or more, neither a stop word nor a generic one. */
export function distinctiveWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    const w = stem(raw);
    if (!GENERIC.has(w)) out.add(w);
  }
  return out;
}

/** Below this many shared distinctive words, two promises are not said to resemble each other. */
export const SIMILAR_PROMISE_WORDS = 3;

const shared = (a: Set<string>, b: Set<string>): string[] => [...a].filter((w) => b.has(w)).sort();
const nodeOf = (ref: string): string => ref.split('@')[0];

// ------------------------------------------------------------------ ties

function objectsOf(s: PrecedentSubject): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.terms.measures) if (m.source.ref) out.set(nodeOf(m.source.ref), m.label);
  for (const r of s.terms.evidence) if (r.matcher?.objectRef) out.set(nodeOf(r.matcher.objectRef), r.description);
  for (const d of s.dependencies) if (d.on.kind === 'EXTERNAL' && d.on.source.ref) out.set(nodeOf(d.on.source.ref), d.description);
  for (const l of s.links) out.set(`${l.system}:${l.ref}`, l.ref);
  return out;
}

/** "the same Memoire opportunity: Rohto Q4 tender" — the kind from the shared reference, the name from what was seen. */
function entityWords(ref: string, value: string): string {
  const [system = '', kind = 'entity'] = ref.split(':');
  const name = value.split(' · ')[0].replace(/^.*? — /, '').replace(/^[“"]|[”"]$/g, '');
  const short = name.length > 80 ? `${name.slice(0, 79)}…` : name;
  return `the same ${system.charAt(0).toUpperCase()}${system.slice(1)} ${kind}: ${short}`;
}

function tiesBetween(s: PrecedentSubject, v: CommitmentView): PrecedentTie[] {
  const ties: PrecedentTie[] = [];
  const mine = new Map(s.context.filter((c) => c.entityRef).map((c) => [c.entityRef as string, c.value]));
  const seen = new Set<string>();
  for (const c of v.record.context) {
    const theirs = c.entityRef ? mine.get(c.entityRef) : undefined;
    if (!c.entityRef || theirs === undefined || seen.has(c.entityRef)) continue;
    seen.add(c.entityRef);
    // Name it by whichever side saw it more plainly.
    const plain = [theirs, c.value].sort((a, b) => a.length - b.length)[0];
    ties.push({ kind: 'SAME_ENTITY', statement: `Both are about ${entityWords(c.entityRef, plain)}.` });
  }
  const objects = objectsOf(s);
  for (const [key, label] of objectsOf(subjectOf(v))) {
    if (objects.has(key)) ties.push({ kind: 'SAME_OBJECT', statement: `Both rest on the same record: ${label}.` });
  }
  const words = shared(distinctiveWords(s.terms.statement), distinctiveWords(v.terms.statement));
  if (words.length >= SIMILAR_PROMISE_WORDS) ties.push({ kind: 'SIMILAR_PROMISE', statement: `The promises share ${words.map((w) => `“${w}”`).join(', ')}.` });
  if (ties.length > 0 && sameParty(s.terms.owner, v.terms.owner)) ties.push({ kind: 'SAME_OWNER', statement: `The same owner: ${v.terms.owner.label}.` });
  return ties;
}

// --------------------------------------------------------------- reading

function lineage(v: CommitmentView, byId: ReadonlyMap<string, CommitmentView>): CommitmentView[] {
  const out: CommitmentView[] = [];
  for (let at: CommitmentView | undefined = v; at && out.length < 50; at = at.record.parentId ? byId.get(at.record.parentId) : undefined) out.push(at);
  return out;
}

function saidOn(v: CommitmentView, kind: 'EXPLANATION' | 'LESSON'): Said[] {
  return v.learnings
    .filter((l) => l.learning.kind === kind)
    .map((l) => ({
      statement: l.learning.statement,
      author: l.actor.label,
      appliesTo: l.learning.appliesTo,
      withheld: (v.events.find((e) => e.id === l.eventId)?.textWithheld?.length ?? 0) > 0,
    }));
}

const ENDING: Record<Resolution, string> = {
  FULFILLED: 'fulfilled',
  PARTIALLY_FULFILLED: 'partly fulfilled',
  MISSED: 'missed',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
  INVALIDATED: 'invalidated by changed context',
  ABANDONED: 'abandoned',
};

const timesWord = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** Precedents and lessons for a commitment or a draft, among everything else the reader can see. */
export function precedentsFor(subject: PrecedentSubject, views: readonly CommitmentView[]): PrecedentReading {
  const byId = new Map(views.map((v) => [v.record.id, v]));
  const elsewhere = (v: CommitmentView) => v.record.id !== subject.id && (subject.originRef === null || v.record.origin.ref !== subject.originRef);

  const precedents: Precedent[] = [];
  for (const v of views) {
    if (!elsewhere(v) || v.phase !== 'CLOSED' || v.resolution === null) continue;
    const ties = tiesBetween(subject, v);
    // A shared customer or account alone is not a resemblance — everything done for a key account shares it — nor is a
    // shared owner: it takes a promise that reads alike, the same record, or a shared entity and a second tie.
    const strong = ties.some((t) => t.kind === 'SIMILAR_PROMISE' || t.kind === 'SAME_OBJECT');
    if (!strong && !(ties.some((t) => t.kind === 'SAME_ENTITY') && ties.length >= 2)) continue;
    const line = lineage(v, byId);
    precedents.push({
      commitmentId: v.record.id,
      statement: v.terms.statement,
      owner: v.terms.owner.label,
      resolution: v.resolution.resolution,
      closedAt: v.resolution.at,
      daysAgainstOriginal: varianceOf(v).time.daysAgainstOriginal,
      redates: v.redates.length,
      ties,
      explanations: line.flatMap((x) => saidOn(x, 'EXPLANATION')),
      lessons: line.flatMap((x) => saidOn(x, 'LESSON')),
    });
  }
  // Most recent first: time, never likeness or how it ended.
  precedents.sort((a, b) => (a.closedAt < b.closedAt ? 1 : a.closedAt > b.closedAt ? -1 : 0));

  const promise = distinctiveWords(subject.terms.statement);
  const lessons: ApplicableLesson[] = [];
  const precedentIds = new Set(precedents.map((p) => p.commitmentId));
  for (const v of views) {
    if (!elsewhere(v)) continue;
    for (const l of v.learnings.filter((x) => x.learning.kind === 'LESSON')) {
      const withheld = (v.events.find((e) => e.id === l.eventId)?.textWithheld?.length ?? 0) > 0;
      const named = l.learning.appliesTo && !withheld ? shared(distinctiveWords(l.learning.appliesTo), promise) : [];
      const viaPrecedent = views.some((p) => precedentIds.has(p.record.id) && lineage(p, byId).some((x) => x.record.id === v.record.id));
      if (named.length === 0 && !viaPrecedent) continue;
      lessons.push({
        statement: l.learning.statement,
        author: l.actor.label,
        appliesTo: l.learning.appliesTo,
        withheld,
        commitmentId: v.record.id,
        commitmentStatement: v.terms.statement,
        at: l.at,
        why:
          named.length > 0
            ? `It says it applies to “${l.learning.appliesTo}”, and this promise is about ${named.map((w) => `“${w}”`).join(', ')}.`
            : 'It was learned on a precedent of this commitment.',
      });
    }
  }
  lessons.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const n = precedents.length;
  const endings = [...new Set(precedents.map((p) => ENDING[p.resolution]))];
  const late = precedents.filter((p) => (p.daysAgainstOriginal ?? 0) > 0).length;
  const lessonWords = lessons.length === 0 ? '' : ` ${lessons.length === 1 ? 'One lesson' : `${lessons.length} lessons`} recorded then may apply.`;
  const headline =
    n === 0
      ? lessons.length === 0
        ? 'Nothing like this has ended on the ledger yet.'
        : `Nothing like this has ended on the ledger yet, but ${lessons.length === 1 ? 'one lesson names' : `${lessons.length} lessons name`} what it is about.`
      : `Forge has seen something like this ${timesWord(n)} before: ${endings.join(', ')}${late > 0 ? `, ${late === n ? (n === 1 ? 'after' : 'all after') : late === 1 ? 'one of them after' : `${late} of them after`} the date first promised` : ''}.${lessonWords}`;

  return {
    rule: PRECEDENT_RULES,
    epistemic: 'INFERENCE',
    precedents,
    lessons,
    headline,
    caveat: n > 0 && n < 5 ? `${n === 1 ? 'One case' : `${n} cases`} — a story to read, not a pattern to rely on.` : null,
  };
}
