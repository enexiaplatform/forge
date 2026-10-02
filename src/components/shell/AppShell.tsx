import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { asksFor } from '@forge/kernel';
import { MOMENTS, PEOPLE, type PersonKey, pendingIntakeCount } from '../../forge/queries';
import { useForge, useForgeQuery } from '../../forge/ForgeContext';
import { ForgeLockup } from '../brand/ForgeLogo';
import { fmtDay } from '../../lib/format';

function NavItem({ to, children, count, ember }: { to: string; children: ReactNode; count?: number; ember?: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `group relative flex items-center justify-between rounded-lg px-3 py-2 text-ui no-underline transition-colors ease-forge hover:no-underline ${
          isActive ? 'bg-chrome-active text-white' : 'text-chrome-fg hover:bg-chrome-hover hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-ember-500" aria-hidden="true" />}
          <span>{children}</span>
          {count !== undefined && count > 0 && (
            <span className={`rounded-md px-1.5 font-mono text-tag ${ember ? 'bg-ember-500 text-iron' : 'bg-chrome-line text-chrome-fg'}`}>{count}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function DemoPanel() {
  const { demo, busy, advance, reset, readerKey, setReader } = useForge();
  const current = demo.current();
  const next = demo.next();
  const index = current ? MOMENTS.findIndex((m) => m.key === current.key) + 1 : 0;
  return (
    <div className="border-t border-chrome-line px-5 py-5 text-chrome-fg">
      <label className="block">
        <span className="mb-1.5 block font-sans text-label font-medium uppercase text-chrome-muted">Reading as</span>
        <select
          value={readerKey}
          onChange={(e) => setReader(e.target.value as PersonKey)}
          className="h-9 w-full rounded-lg border border-chrome-line bg-iron px-2 text-dense text-white focus:outline-none focus:shadow-focus"
        >
          {(Object.keys(PEOPLE) as PersonKey[]).map((k) => (
            <option key={k} value={k}>
              {PEOPLE[k].name} — {PEOPLE[k].title}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-5">
        <p className="font-sans text-label font-medium uppercase text-chrome-muted">Demo clock · Meridian Vietnam</p>
        <p className="mt-1 font-mono text-meta text-white">{fmtDay(demo.clock.now())}</p>
        {current && (
          <p className="mt-2 text-dense leading-5 text-chrome-fg">
            <span className="font-mono text-tag text-chrome-muted">
              {index}/{MOMENTS.length}
            </span>{' '}
            {current.title}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!next || busy}
            onClick={() => void advance()}
            className="h-8 flex-1 rounded-lg border border-chrome-line px-2 text-left text-dense text-white transition-colors ease-forge hover:bg-chrome-hover disabled:opacity-40"
            title={next ? next.description : 'The story is complete'}
          >
            {busy ? 'Moving the clock…' : next ? `Next: ${next.title}` : 'Story complete'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void reset()}
            className="h-8 rounded-lg px-2 text-dense text-chrome-muted transition-colors ease-forge hover:bg-chrome-hover hover:text-white"
            title="Start the story again from 1 October"
          >
            Reset
          </button>
        </div>
        <p className="mt-3 text-meta leading-4 text-chrome-muted">Every object is DEMO data, held in memory. Nothing is written anywhere.</p>
      </div>
    </div>
  );
}

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { reader } = useForge();
  const counts = useForgeQuery(async (demo, scope) => {
    const conditions = await demo.runtime.conditions(scope);
    const mine = conditions.ok ? asksFor(conditions.value, reader.scope.actsAs).length : 0;
    return { mine, intake: await pendingIntakeCount(demo, scope) };
  });
  return (
    <div className="flex min-h-screen bg-paper">
      <nav className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col bg-iron max-md:hidden" aria-label="Forge">
        <div className="px-5 pb-6 pt-6">
          <ForgeLockup />
          <p className="mt-2 font-sans text-meta text-chrome-muted">Commitment &amp; outcome execution</p>
        </div>
        <div className="flex flex-col gap-0.5 px-3">
          <NavItem to="/" count={counts?.mine} ember>
            Asks
          </NavItem>
          <NavItem to="/commitments">Commitments</NavItem>
          <NavItem to="/decisions" count={counts?.intake}>
            Decisions
          </NavItem>
          <NavItem to="/memory">Memory</NavItem>
          <NavItem to="/surfaces">Surfaces</NavItem>
        </div>
        <div className="mt-auto">
          <DemoPanel />
        </div>
      </nav>
      <main className="min-w-0 flex-1">
        <MobileBar />
        <div className={`${wide ? '' : 'mx-auto max-w-management'} px-page-x py-page-y max-md:px-4`}>{children}</div>
      </main>
    </div>
  );
}

/** Below the sidebar breakpoint: the mark, the five destinations, and the clock. */
function MobileBar() {
  const { demo, advance, busy } = useForge();
  const next = demo.next();
  return (
    <div className="hidden bg-iron px-4 py-3 max-md:block">
      <div className="flex items-center justify-between">
        <ForgeLockup />
        <button type="button" className="font-mono text-meta text-chrome-fg" disabled={!next || busy} onClick={() => void advance()}>
          {fmtDay(demo.clock.now())} {next ? '→' : ''}
        </button>
      </div>
      <div className="mt-2 flex gap-3 overflow-x-auto text-dense">
        {[
          ['/', 'Asks'],
          ['/commitments', 'Commitments'],
          ['/decisions', 'Decisions'],
          ['/memory', 'Memory'],
          ['/surfaces', 'Surfaces'],
        ].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `whitespace-nowrap no-underline ${isActive ? 'text-white' : 'text-chrome-muted'}`}>
            {label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
