import type { Clearance } from './sensitivity.ts';

/**
 * Kernel primitives — Result, Scope, Clock, IdGen, fingerprints, exact decimals.
 *
 * They follow Helm's kernel conventions (packages/shared in the Helm repository)
 * so the two systems read alike, but Forge does not import Helm code: the two
 * products meet through data contracts, never through a shared module. See
 * docs/adr/0002-separate-repository-shared-database.md.
 *
 * Pure by contract: no I/O, no ambient clock, no randomness. Time and identity
 * arrive through the `Clock` and `IdGen` ports.
 */

// ------------------------------------------------------------------ Result

export type ForgeError = {
  /** Stable, greppable, namespaced: 'commitment.not_found'. */
  readonly code: string;
  /** Manager-readable. Ends up in a UI, so it explains rather than blames. */
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export type Result<T, E = ForgeError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const fail = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Result<never, ForgeError> => ({ ok: false, error: { code, message, details } });

/** Unwraps or throws — for tests, demo scripts and genuinely unreachable failures only. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() on an error Result: ${JSON.stringify(r.error)}`);
}

// ------------------------------------------------------------------- ports

export type Clock = { now(): string };
export type IdGen = { next(prefix: string): string };

/** A clock that can be moved by hand — tests and the demo's moments. */
export function manualClock(start: string): Clock & { set(iso: string): void } {
  let current = new Date(start).toISOString();
  return {
    now: () => current,
    set(iso: string) {
      current = new Date(iso).toISOString();
    },
  };
}

/** Deterministic ids for tests and the demo: `cmt_0001`, `evt_0002`… */
export function sequentialIds(): IdGen {
  const counters = new Map<string, number>();
  return {
    next(prefix: string) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${String(n).padStart(4, '0')}`;
    },
  };
}

// ------------------------------------------------------------------- scope

/** Helm's ranked organization roles, shared through one database. */
export const orgRoles = ['admin', 'manager', 'member', 'viewer'] as const;
export type OrgRole = (typeof orgRoles)[number];

export const orgRoleRank: Readonly<Record<OrgRole, number>> = { admin: 4, manager: 3, member: 2, viewer: 1 };

export const hasRole = (role: OrgRole, min: OrgRole): boolean => orgRoleRank[role] >= orgRoleRank[min];

/**
 * A party a commitment can name: the person, role or organizational unit that
 * promises, or the one the promise is made to. `ref` identifies the party in
 * shared enterprise reality (a user id, an org-unit id, a role key); a label
 * alone is allowed while the enterprise model is still thin.
 */
export type Party = {
  readonly kind: 'PERSON' | 'ROLE' | 'UNIT';
  readonly label: string;
  readonly ref: string | null;
};

/**
 * Who performed an act. A person acts in their own name; an AGENT is an AI
 * working inside Forge; a SYSTEM is a connector reporting what a source system
 * recorded. Authority treats the three differently (authority.ts).
 */
export type Actor = {
  readonly kind: 'PERSON' | 'AGENT' | 'SYSTEM';
  readonly id: string | null;
  readonly label: string;
};

/**
 * Who is asking, and as whom they may act. There is no ambient tenant: every
 * kernel call takes a Scope. `actsAs` lists the parties the actor stands for —
 * the role they hold, the unit they lead — resolved once per session from
 * shared enterprise reality.
 */
export type Scope = {
  readonly orgId: string;
  readonly actor: Actor;
  readonly role: OrgRole;
  readonly actsAs: readonly Party[];
  /**
   * The sensitivity classes this reader is cleared for (ADR-0017). The in-memory store withholds by it; in Postgres
   * Helm's own clearance decides and this is ignored. Absent: general management only.
   */
  readonly clearances?: Clearance;
};

const norm = (s: string): string => s.trim().toLowerCase();

/** Two parties are the same if their refs agree, or — when either lacks one — their kind and label do. */
export function sameParty(a: Party, b: Party): boolean {
  if (a.ref !== null && b.ref !== null) return a.ref === b.ref;
  return a.kind === b.kind && norm(a.label) === norm(b.label);
}

export const actsFor = (scope: Scope, party: Party): boolean => scope.actsAs.some((p) => sameParty(p, party));

// ------------------------------------------------------------ fingerprints

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64 over UTF-16 code units — the same function Helm fingerprints with. Not a security boundary. */
export function fnv1a64(text: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return hash.toString(16).padStart(16, '0');
}

/** JSON with sorted keys, so equal content always serializes — and fingerprints — identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export const fingerprint = (prefix: string, value: unknown): string => `${prefix}_${fnv1a64(canonicalJson(value))}`;

// ---------------------------------------------------------- exact decimals

/**
 * Measures are compared exactly. Decimals travel as text ('32.3878') and are
 * subtracted through scaled BigInt, so a margin variance never reads
 * -0.9877999999999999.
 */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const isDecimal = (s: string | null | undefined): s is string => typeof s === 'string' && DECIMAL.test(s.trim());

function scaled(s: string, scale: number): bigint {
  const t = s.trim();
  const negative = t.startsWith('-');
  const [whole, frac = ''] = (negative ? t.slice(1) : t).split('.');
  const digits = BigInt(whole + frac.padEnd(scale, '0').slice(0, scale));
  return negative ? -digits : digits;
}

function scaleOf(...values: string[]): number {
  return Math.max(0, ...values.map((v) => (v.includes('.') ? v.trim().split('.')[1].length : 0)));
}

function render(n: bigint, scale: number): string {
  const negative = n < 0n;
  const abs = (negative ? -n : n).toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? abs : abs.slice(0, abs.length - scale);
  let frac = scale === 0 ? '' : abs.slice(abs.length - scale).replace(/0+$/, '');
  if (frac.length > 0) frac = `.${frac}`;
  const out = `${whole}${frac}`;
  return negative && out !== '0' ? `-${out}` : out;
}

/** a − b, exactly. */
export function decimalSub(a: string, b: string): string {
  const s = scaleOf(a, b);
  return render(scaled(a, s) - scaled(b, s), s);
}

/** −1, 0 or 1. */
export function decimalCompare(a: string, b: string): number {
  const s = scaleOf(a, b);
  const d = scaled(a, s) - scaled(b, s);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

// -------------------------------------------------------------------- time

const DAY = 86_400_000;

/** Whole calendar days from `from` to `to` (dates or instants, UTC). Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...ymd(from));
  const b = Date.UTC(...ymd(to));
  return Math.round((b - a) / DAY);
}

function ymd(iso: string): [number, number, number] {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

export const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-06' → '6 Oct 2026' — for sentences the kernel writes for people. Read in UTC, the kernel's calendar. */
export function humanDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A sentence fragment without its closing full stop, for embedding in another sentence. */
export const clause = (text: string): string => text.trim().replace(/[.。]+$/, '');

/** '-1735500000', 'VND' → '−1 735 500 000 VND'; '32.3878', '%' → '32.3878%'. True minus, thin-space groups. */
export function amount(value: string, unit: string | null): string {
  const t = value.trim();
  const negative = t.startsWith('-');
  const [whole, frac] = t.replace(/^[-+]/, '').split('.');
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : whole;
  const body = `${negative ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
  return unit === '%' ? `${body}%` : unit ? `${body} ${unit}` : body;
}

/** A person's words, quoted after the sentence that introduces them: no doubled full stops. */
export const quoted = (text: string | null | undefined): string => (text && text.trim() ? ` “${text.trim()}”` : '');

/** The calendar date (UTC) an instant falls on. */
export const dateOf = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
