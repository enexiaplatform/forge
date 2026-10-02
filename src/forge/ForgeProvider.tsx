/** The provider: boots the DEMO story at its opening moment and holds the reader. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createMeridianDemo, type MeridianDemo, PEOPLE, type PersonKey } from '@forge/demo';
import { ForgeCtx, type ForgeState, OPENING_MOMENT } from './ForgeContext';

const READER_KEY = 'forge.reader';

function initialReader(): PersonKey {
  try {
    const stored = window.localStorage.getItem(READER_KEY);
    if (stored && stored in PEOPLE) return stored as PersonKey;
  } catch {
    /* storage unavailable — fall back to the Country GM */
  }
  return 'gm';
}

export function ForgeProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState<MeridianDemo | null>(null);
  const [version, setVersion] = useState(0);
  const [readerKey, setReaderKey] = useState<PersonKey>(initialReader);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const boot = useCallback(async () => {
    setBusy(true);
    const d = createMeridianDemo();
    await d.advanceTo(OPENING_MOMENT);
    setDemo(d);
    setVersion((v) => v + 1);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void boot();
  }, [boot]);

  const setReader = useCallback((key: PersonKey) => {
    setReaderKey(key);
    try {
      window.localStorage.setItem(READER_KEY, key);
    } catch {
      /* not remembered — harmless */
    }
  }, []);

  const value = useMemo<ForgeState | null>(() => {
    if (!demo) return null;
    const reader = PEOPLE[readerKey];
    return {
      demo,
      version,
      reader,
      readerKey,
      setReader,
      busy,
      async advance() {
        const next = demo.next();
        if (!next) return;
        setBusy(true);
        await demo.advanceTo(next.key);
        setVersion((v) => v + 1);
        setBusy(false);
      },
      reset: boot,
      async act(fn) {
        const r = await fn(reader.scope, demo);
        setVersion((v) => v + 1);
        return r;
      },
    };
  }, [demo, version, readerKey, setReader, busy, boot]);

  if (!value) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="forge-caveat">Opening the Meridian ledger…</p>
      </div>
    );
  }
  return <ForgeCtx.Provider value={value}>{children}</ForgeCtx.Provider>;
}

