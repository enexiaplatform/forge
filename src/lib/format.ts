/** Presentation helpers. Dates are read in UTC, the kernel's calendar. True minus, thin-space groups, sentence case. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (iso: string): Date => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

/** 2 Oct 2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 2 Oct */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Thu 1 Oct 2026 */
export function fmtDay(iso: string): string {
  const d = parse(iso);
  return `${DAYS[d.getUTCDay()]} ${fmtDate(iso)}`;
}

/** 2 Oct, 11:00 */
export function fmtMoment(iso: string): string {
  const d = parse(iso);
  return `${fmtShort(iso)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** PARTIALLY_FULFILLED → Partially fulfilled */
export function humanize(e: string): string {
  const s = e.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MINUS = '−';

/** -1735500000 → −1 735 500 000 ; 32.3878 → 32.3878 */
export function fmtNumber(v: string): string {
  const neg = v.trim().startsWith('-');
  const [whole, frac] = v.trim().replace(/^-/, '').split('.');
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : whole;
  return `${neg ? MINUS : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function fmtQuantity(v: string | null, unit: string | null): string {
  if (v === null) return '—';
  if (unit === '%') return `${fmtNumber(v)}%`;
  return unit ? `${fmtNumber(v)} ${unit}` : fmtNumber(v);
}

/** −0.9668 · +4 · 0 */
export function fmtSigned(v: string | number | null, unit: string | null = null): string {
  if (v === null) return '—';
  const s = String(v);
  const n = Number(s);
  const body = fmtQuantity(s.replace(/^-/, ''), unit === '%' ? null : unit);
  const suffix = unit === '%' ? ' pts' : '';
  if (n === 0) return `0${suffix}`;
  return `${n < 0 ? MINUS : '+'}${body}${suffix}`;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/** 2 → Two (for headlines) */
export const word = (n: number): string => WORDS[n] ?? String(n);
export const wordLower = (n: number): string => (WORDS[n] ?? String(n)).toLowerCase();

export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/** "4 days late", "on the day", "2 days early" */
export function relativeDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'on the day';
  return days > 0 ? `${days} ${plural(days, 'day')} late` : `${-days} ${plural(-days, 'day')} early`;
}
