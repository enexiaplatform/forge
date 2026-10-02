/**
 * The app's one connection to Forge: the DEMO Meridian story running in memory,
 * the person the console is being read as, and a version counter that moves
 * whenever the ledger does. Pages read through `useForgeQuery`; they act
 * through `act`, always as the current reader — so the interim authority
 * policy, not the UI, decides what each person may do.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { Result, Scope } from '@forge/kernel';
import type { DemoPerson, MeridianDemo, MomentKey, PersonKey } from '@forge/demo';

/** The story opens on the morning of 1 October: the release has slipped, and people need to act. */
export const OPENING_MOMENT: MomentKey = 'slip';

export type ForgeState = {
  readonly demo: MeridianDemo;
  readonly version: number;
  readonly reader: DemoPerson;
  readonly readerKey: PersonKey;
  setReader(key: PersonKey): void;
  readonly busy: boolean;
  advance(): Promise<void>;
  reset(): Promise<void>;
  /** Run a command as the current reader; the ledger refreshes after it, whatever it returned. */
  act<T>(fn: (scope: Scope, demo: MeridianDemo) => Promise<Result<T>>): Promise<Result<T>>;
};

export const ForgeCtx = createContext<ForgeState | null>(null);


export function useForge(): ForgeState {
  const v = useContext(ForgeCtx);
  if (!v) throw new Error('useForge outside ForgeProvider');
  return v;
}

/** Re-run an async read whenever the ledger moves or the reader changes. */
export function useForgeQuery<T>(read: (demo: MeridianDemo, scope: Scope) => Promise<T>, deps: readonly unknown[] = []): T | undefined {
  const { demo, version, reader } = useForge();
  const [data, setData] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void read(demo, reader.scope).then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, version, reader, ...deps]);
  return data;
}
