/**
 * Sensitivity — a fact keeps its protection wherever it goes (ADR-0017).
 *
 * The ecosystem's model is Helm's (Helm ADR-0025), adopted rather than copied in
 * spirit:
 *
 *   1. SENSITIVITY LIVES ON THE VALUE. A Helm value carries the class of its
 *      metric, or a stricter one its node declares. Forge does not classify;
 *      it carries the class the source gave.
 *   2. A DERIVED FACT IS AT LEAST AS PROTECTED AS WHAT IT DERIVES FROM. Evidence
 *      built from a protected observation, an outcome that states a protected
 *      actual, a publication or an episode that carries one — each carries the
 *      union of its sources' classes. Nothing becomes less protected by crossing
 *      an application boundary.
 *   3. CLASSES ARE COMPARTMENTS, NOT LEVELS. GENERAL_MANAGEMENT needs no
 *      clearance; every other class needs its own.
 *
 * Enforcement is redaction, not omission: a reader without clearance still sees
 * that the evidence exists, which requirement it proves and how the commitment
 * ended — only the protected values and the narrative stated with them are
 * WITHHELD, and the record says so ("never a silent absence"). Status is
 * therefore the same for every reader; content is not.
 *
 * `sealEvent` splits an event into what anyone who may see the commitment may
 * read and the SEALED values; the stores keep the sealed part where only cleared
 * readers reach it (in Postgres, `forge_sealed_values` under Helm's own clearance
 * check) and `unsealEvent` puts it back for them.
 */

import type { CommitmentEvent, EvidenceItem, ObservedOutcome } from './types.ts';

export const sensitivityClasses = ['GENERAL_MANAGEMENT', 'FINANCIAL_SENSITIVE', 'COMMERCIAL_CONFIDENTIAL', 'HR_RESTRICTED', 'STRATEGIC_RESTRICTED'] as const;
export type SensitivityClass = (typeof sensitivityClasses)[number];

/** The restricted classes a fact carries, in Helm's order. Empty means general management: no clearance needed. */
export type Protection = readonly SensitivityClass[];

/** What a reader is cleared for: a list of classes, or every class (an organization admin, a connector's service). */
export type Clearance = readonly SensitivityClass[] | 'ALL';

const RESTRICTED = sensitivityClasses.filter((c) => c !== 'GENERAL_MANAGEMENT');

/** Normalize anything that claims to be a set of classes: unknown names are refused by omission, GENERAL dropped, order fixed. */
export function protectionOf(...classes: readonly (string | null | undefined | readonly (string | null | undefined)[])[]): Protection {
  const flat = new Set(classes.flat().filter((c): c is string => typeof c === 'string'));
  return RESTRICTED.filter((c) => flat.has(c));
}

/** The union: a fact derived from several is protected by all of their classes. */
export const joinProtection = (...ps: readonly (Protection | null | undefined)[]): Protection => protectionOf(...ps.map((p) => p ?? []));

export const isProtected = (p: Protection | null | undefined): boolean => (p ?? []).length > 0;

/** Rule 3: cleared for every class the fact carries. */
export function isCleared(clearance: Clearance | undefined, p: Protection | null | undefined): boolean {
  if (!isProtected(p)) return true;
  if (clearance === 'ALL') return true;
  return (p ?? []).every((c) => (clearance ?? []).includes(c));
}

const WORDS: Record<SensitivityClass, string> = {
  GENERAL_MANAGEMENT: 'general management',
  FINANCIAL_SENSITIVE: 'financially sensitive',
  COMMERCIAL_CONFIDENTIAL: 'commercially confidential',
  HR_RESTRICTED: 'HR-restricted',
  STRATEGIC_RESTRICTED: 'strategically restricted',
};

export const describeProtection = (p: Protection): string => (p.length === 0 ? 'general management' : p.map((c) => WORDS[c]).join(' and '));

/** What a reader without clearance reads in place of a withheld statement. */
export const withheldStatement = (p: Protection, what: string): string =>
  `Withheld: ${what} carries ${describeProtection(p)} values, shown only to people cleared for them.`;

// ------------------------------------------------------------------- events

type MeasureResult = { readonly key: string; readonly actual: string | null; readonly note: string | null; readonly protection?: Protection; readonly withheld?: boolean };
type PublishedLike = {
  readonly outcome: string;
  readonly measures: readonly (MeasureResult & { readonly difference?: string | null; readonly met?: boolean | null })[];
  readonly realizedValue: readonly unknown[];
  readonly protection?: Protection;
  readonly withheld?: Protection;
};

const measuresProtection = (ms: readonly MeasureResult[]): Protection => joinProtection(...ms.filter((m) => m.actual !== null || m.note !== null).map((m) => m.protection));

/** An event seen only by its type and payload — enough to seal it, whichever store holds it. */
type Sealable = { readonly type: string; readonly payload: unknown };
type EvidencePayload = { readonly evidence: EvidenceItem };
type OutcomePayload = { readonly outcome: ObservedOutcome };
type PublicationPayload = { readonly publication: PublishedLike };

/** The classes an event carries — derived from its payload, so every store reaches the same answer. */
export function eventProtection(e: Sealable): Protection {
  // Payloads are read defensively: a malformed event is refused by validation and the database, not here.
  switch (e.type) {
    case 'EVIDENCE_RECORDED':
      return protectionOf((e.payload as Partial<EvidencePayload> | null)?.evidence?.protection ?? []);
    case 'OUTCOME_OBSERVED': {
      const o = (e.payload as Partial<OutcomePayload> | null)?.outcome;
      return joinProtection(measuresProtection(o?.measures ?? []), o?.protection);
    }
    case 'OUTCOME_PUBLISHED':
      return protectionOf((e.payload as Partial<PublicationPayload> | null)?.publication?.protection ?? []);
    default:
      return [];
  }
}

/** The part of an event only a cleared reader may read. Its shape is the store's business; only `unsealEvent` reads it. */
export type Sealed = Readonly<Record<string, unknown>>;

/**
 * Split an event: the open payload (protected values removed and marked withheld, the narrative stated with them
 * replaced by a sentence saying so) and the sealed values. An unprotected event is returned whole, with nothing sealed.
 */
export function sealEvent<E extends Sealable>(e: E): { open: E; sealed: Sealed | null; protection: Protection } {
  const p = eventProtection(e);
  if (!isProtected(p)) return { open: e, sealed: null, protection: p };
  const withPayload = (payload: unknown): E => ({ ...e, payload }) as E;
  switch (e.type) {
    case 'EVIDENCE_RECORDED': {
      const item = (e.payload as EvidencePayload).evidence;
      const open: EvidenceItem = { ...item, statement: withheldStatement(p, 'this evidence'), withheld: p };
      return { open: withPayload({ ...(e.payload as object), evidence: open }), sealed: { statement: item.statement }, protection: p };
    }
    case 'OUTCOME_OBSERVED': {
      const o = (e.payload as OutcomePayload).outcome;
      const measures = o.measures.map((m) => (isProtected(m.protection) ? { ...m, actual: null, note: null, withheld: true } : m));
      const open: ObservedOutcome = { ...o, statement: withheldStatement(p, 'this outcome'), measures, realizedValue: [], withheld: p };
      return {
        open: withPayload({ ...(e.payload as object), outcome: open }),
        sealed: { statement: o.statement, realizedValue: o.realizedValue, measures: o.measures.filter((m) => isProtected(m.protection)).map((m) => ({ key: m.key, actual: m.actual, note: m.note })) },
        protection: p,
      };
    }
    case 'OUTCOME_PUBLISHED': {
      const pub = (e.payload as PublicationPayload).publication;
      const measures = pub.measures.map((m) => (isProtected(m.protection) ? { ...m, actual: null, note: null, difference: null, met: null, withheld: true } : m));
      const open = { ...pub, outcome: withheldStatement(p, 'this outcome'), measures, realizedValue: [], withheld: p };
      return {
        open: withPayload({ ...(e.payload as object), publication: open }),
        sealed: {
          outcome: pub.outcome,
          realizedValue: pub.realizedValue,
          measures: pub.measures.filter((m) => isProtected(m.protection)).map((m) => ({ key: m.key, actual: m.actual, note: m.note, difference: m.difference ?? null, met: m.met ?? null })),
        },
        protection: p,
      };
    }
    default:
      return { open: e, sealed: null, protection: p };
  }
}

type SealedMeasure = { key: string; actual: string | null; note: string | null; difference?: string | null; met?: boolean | null };

const restore = <M extends MeasureResult>(ms: readonly M[], sealed: readonly SealedMeasure[]): M[] =>
  ms.map((m) => {
    if (!m.withheld) return m;
    const s = sealed.find((x) => x.key === m.key);
    if (!s) return m;
    const rest: Record<string, unknown> = { ...m };
    delete rest.withheld;
    return { ...rest, ...s } as unknown as M;
  });

const without = <T extends object>(o: T, key: string): T => {
  const copy = { ...o } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
};

/** Put the sealed values back, for a reader cleared to read them. */
export function unsealEvent<E extends Sealable>(open: E, sealed: Sealed | null): E {
  if (sealed === null) return open;
  const withPayload = (payload: unknown): E => ({ ...open, payload }) as E;
  switch (open.type) {
    case 'EVIDENCE_RECORDED': {
      const item = without((open.payload as EvidencePayload).evidence, 'withheld');
      return withPayload({ ...(open.payload as object), evidence: { ...item, statement: String(sealed.statement) } });
    }
    case 'OUTCOME_OBSERVED': {
      const o = without((open.payload as OutcomePayload).outcome, 'withheld');
      const outcome = { ...o, statement: String(sealed.statement), realizedValue: sealed.realizedValue as ObservedOutcome['realizedValue'], measures: restore(o.measures, sealed.measures as SealedMeasure[]) };
      return withPayload({ ...(open.payload as object), outcome });
    }
    case 'OUTCOME_PUBLISHED': {
      const pub = without((open.payload as PublicationPayload).publication, 'withheld');
      const publication = { ...pub, outcome: String(sealed.outcome), realizedValue: sealed.realizedValue as readonly unknown[], measures: restore(pub.measures, sealed.measures as SealedMeasure[]) };
      return withPayload({ ...(open.payload as object), publication });
    }
    default:
      return open;
  }
}

/** What a reader with this clearance reads of an event held whole (the in-memory store; tests). */
export function readAs<E extends CommitmentEvent>(e: E, clearance: Clearance | undefined): E {
  const s = sealEvent(e);
  return isCleared(clearance, s.protection) ? e : s.open;
}
