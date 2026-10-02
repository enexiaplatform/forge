import type { ButtonHTMLAttributes, ReactNode } from 'react';

// ------------------------------------------------------------------ Button

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'md' | 'sm' };

/** One primary button per view. */
export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-sans font-medium transition-colors ease-forge disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = size === 'sm' ? 'h-8 px-3 text-dense' : 'h-9 px-4 text-ui';
  const variants = {
    primary: 'bg-accent-800 text-white hover:bg-accent-900',
    secondary: 'border border-ink-300 bg-white text-ink-900 hover:border-ink-400 hover:bg-ink-50',
    quiet: 'text-accent-700 hover:bg-accent-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  }[variant];
  return <button type="button" className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

// --------------------------------------------------------------------- Tag

export type Tone = 'neutral' | 'accent' | 'emerald' | 'amber' | 'red' | 'violet' | 'sky' | 'outline';

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700',
  accent: 'bg-accent-50 text-accent-800',
  emerald: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-800',
  sky: 'bg-sky-50 text-sky-800',
  outline: 'border border-ink-300 text-ink-600',
};

/** A mono enum pill. */
export function Tag({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 font-mono text-tag uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

// ----------------------------------------------------------- page grammar

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="forge-label mb-3">{children}</p>;
}

/** Management pages open with a sentence that states the situation, not the page name. */
export function PageHeader({ kicker, headline, lede, size = 'display' }: { kicker: ReactNode; headline: ReactNode; lede?: ReactNode; size?: 'display' | 'title' | 'instrument' }) {
  const sizes = { display: 'text-display', title: 'text-title', instrument: 'text-instrument' };
  return (
    <header className="mb-10 max-w-headline">
      <Kicker>{kicker}</Kicker>
      <h1 className={`${sizes[size]} text-ink-950`}>{headline}</h1>
      {lede && <p className="mt-4 max-w-reading text-lede text-ink-600">{lede}</p>}
    </header>
  );
}

/** Serif title over a 2px rule. Rules group content; boxes do not. */
export function SectionHead({ title, aside, id, small }: { title: ReactNode; aside?: ReactNode; id?: string; small?: boolean }) {
  return (
    <div id={id} className="mb-1 flex scroll-mt-6 items-end justify-between gap-4 border-b-2 border-ink-950 pb-2">
      <h2 className={`${small ? 'text-section-sm' : 'text-section'} text-ink-950`}>{title}</h2>
      {aside && <div className="forge-meta pb-1">{aside}</div>}
    </div>
  );
}

export function Section({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`mb-12 ${className}`}>{children}</section>;
}

/** Label · value on a hairline. */
export function FactRow({ label, children, aside }: { label: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid grid-cols-[148px_1fr_auto] items-baseline gap-4 border-b border-ink-200 py-2.5 max-sm:grid-cols-1 max-sm:gap-1">
      <div className="forge-label">{label}</div>
      <div className="min-w-0 text-base text-ink-900">{children}</div>
      {aside && <div className="justify-self-end max-sm:justify-self-start">{aside}</div>}
    </div>
  );
}

/** Two columns on management pages: main and a 360px aside, wrapping below ~960px. */
export function TwoColumn({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-10">
      <div className="min-w-0 flex-[1_1_560px]">{main}</div>
      <aside className="w-full min-w-0 max-w-[360px] flex-[0_1_360px] max-[960px]:max-w-none">{aside}</aside>
    </div>
  );
}

export function Panel({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-panel">
      {title && <h3 className="mb-3 text-panel text-ink-950">{title}</h3>}
      {children}
    </div>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'red' | 'emerald'; children: ReactNode }) {
  const t = { neutral: 'border-ink-200 bg-ink-50 text-ink-700', red: 'border-red-200 bg-red-50 text-red-800', emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-dense ${t}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="forge-caveat py-4">{children}</p>;
}

/** Mono value: dates, ids, enums, fingerprints. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-meta text-ink-600 ${className}`}>{children}</span>;
}
