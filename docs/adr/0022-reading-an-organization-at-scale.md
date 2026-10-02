# ADR-0022 — Reading an organization at scale: pages, slices, a warm ledger, remembered derivations

**Context.** Every Forge reading — the asks, the conditions, a trace — derives from an organization's whole ledger, and
nothing derived is stored (ADR-0003). The development plan (2.4) asked what that costs at ten thousand commitments and
two hundred thousand events. Measuring it found a correctness bug, a transfer problem, and some waste.

- **Silent truncation.** Supabase's PostgREST answers at most `max_rows` (1 000 by default) per request and says nothing
  when it cuts. Forge's supabase-js client asked once — a ledger past a thousand events would have been derived from a
  fraction of itself. It also read events with one `in` list of every commitment id: at ten thousand ids no URL holds it.
- **Transfer.** On PGlite under RLS, reading 10 000 commitments and 187 000 events whole took about 8.5 s per reading;
  the database's work under RLS was a fifth of that, the rest was moving rows. Over a network it is worse, every time.
- **Waste.** The in-memory store deep-copied every event on every read; grouping events by commitment copied arrays
  quadratically; unchanged commitments were derived again on every call.

**Decision.**

- **Never trust one response.** The supabase-js client reads page by page with `range` until a page comes back empty,
  so a server cap of any size cannot truncate a reading. Lookups by key ask once, with a limit. Every large read is
  ordered to a unique key, so pages are stable.
- **Slices, not lists.** Id filters go in slices of 150 — short enough for a URL, far below Postgres's parameter limit.
- **A reader's warm ledger** (`createLedgerCache`). A store wrapper keeps, per reader (organization, person,
  clearances), what it has read, and each reading asks the store only for what was recorded since (`recordedAfter`, a
  new optional port method). Record time is stamped when a transaction begins and seen when it commits, so each
  catch-up re-reads an overlap window (five minutes) behind the newest record time it holds — as ids only, reading whole
  only what it lacks. A listing and the events read right after it share one catch-up, so one reading sees one moment.
  It keeps a copy of reads, never state: nothing derived, nothing written; dropping it changes no answer. It passes the
  same conformance suite as the stores it wraps, in memory and on Postgres.
- **Remembered derivations.** The runtime remembers each reader's derived view of a commitment for the reading of
  everything recorded, keyed by the record and the last event it saw; a reading at an earlier lens is derived afresh.
- **Freeze once.** The in-memory store copies on the way in, freezes all the way down, and hands out what it holds.

**Consequences.** `npm run bench:reads` (SYNTHETIC; numbers in the development plan): at 10 000 commitments and
187 000 events, a warm reading on PGlite under RLS through the ledger cache takes about 50 ms, against 8.5 s read whole.
The first reading by each reader still reads whole (about 19 s on PGlite) and is the remaining cost. A fake PostgREST
with a 400-row cap and a 200-id URL limit proves the client reads a 1 050-commitment, 3 150-event ledger whole; the same
test fails on the old client. Wiring the cache into production belongs to the browser's Supabase session, which does not
exist yet.

**Residual, named.** A transaction that stays open longer than the overlap window could be missed by a warm reader
until it forgets; Forge writes one statement per transaction. The first reading of a large organization is still a full
read; if that matters, the next step is a reading served close to the database — still not stored state.
