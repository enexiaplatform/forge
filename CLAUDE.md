# FORGE — rules for Claude Code

Read [docs/product/source-of-truth.md](docs/product/source-of-truth.md) (the north star)
and [docs/architecture/forge-architecture.md](docs/architecture/forge-architecture.md)
(the system) before changing anything. `npm run check` must stay green.

## What Forge is not

Not a project-management tool. Never add a task, board, sprint, milestone, a
percent-complete or progress field, a health score, or a rating of a person. Work stays
in the systems that do it and reaches Forge as execution links, activity and evidence.

## Architecture rules

- **One central object: the commitment.** Identity record written once; everything after
  is an append-only event with actor, effective time, record time, reason and authority
  verdict. Phase, terms, requirement status, conditions, variance, episodes are derived
  at a lens — never stored (`verify:schema` forbids state columns).
- **Layers point one way:** kernel ← fabric ← demo ← app (`verify:boundaries`). The kernel
  is pure: no `Date.now()`, `new Date()` without an instant, randomness, network or
  storage; time and ids come through `Clock` and `IdGen`. `postgres.ts` is its one I/O
  boundary.
- **Never write Helm or Memoire.** Read them by reference + immutable snapshot; publish
  execution reality as outbound events. Migrations are additive and `forge_*` only.
- **Authority goes through the port** (`kernel/authority.ts`). Agents propose and infer;
  they never accept, approve, close or speak for a person. Connectors only report.
- **Epistemics are never dropped.** Every statement shown carries its class. An inference
  never satisfies a requirement; a person's confirmation does, and says so.
- **Ask by exception.** A new condition must name one party and the acts that answer it;
  never ask for status or for a field the ecosystem already knows.
- **Capture once.** Anything Helm or Memoire knows is INHERITED; Forge's guesses are
  INFERRED for the owner to confirm; only MISSING terms become inputs.
- **Nothing read becomes a commitment by itself.** What Forge reads in notes or Memoire is a
  candidate (INFERENCE); only a person confirms, edits or dismisses it (ADR-0009).
- **A model lives under `server/` only** and returns raw findings; Forge's own
  `governExtraction` decides what is offered (ADR-0012). Live model calls are opt-in.
- **Helm decides who sees a decision, in Forge too** (ADR-0015). Never widen a `forge_*`
  read policy past Helm's `can_see_decision`; `verify:schema` checks it.
- **Sensitivity never lowers** (ADR-0017): a fact carries its source's classes into everything derived from it; protected values
  are sealed and read only under Helm's clearance. Never add a path that carries a Helm value without its classes.
- **Forge never writes Helm.** Outcomes go to Helm's governed intake as contextual facts (ADR-0018).
- **Records, not scores** (ADR-0014): no score, rank, rating, league table or percentile.
- **The shared Supabase project is production.** Do not apply migrations to it; staging is
  an isolated branch, created only with the product owner's say-so (ADR-0013).
- Domain failures are `Result` values with a manager-readable message, never throws.
- Every store change passes `kernel/test/conformance.mjs` in memory **and** on PGlite, and
  `npm run test:integration` against Helm's and Memoire's own code (ADR-0016). Never run
  `npm install` in, or edit, the Helm or Memoire repositories from here.

## UI rules — "Foundry", a sibling of Helm's "Chart room"

Stack: React 19 + Vite + TypeScript + Tailwind 3. Tokens live only in
`tailwind.config.js`; fonts in `src/index.css` (self-hosted, shared with Helm). No other
CSS, no inline hex, no arbitrary colours. Details: [visual system](docs/product/visual-system.md).

- Page `bg-paper`; sidebar `bg-iron`; panels white with `border-ink-200`, `rounded-xl`.
- **Ember (`ember-500`) appears in exactly three places:** the logo node, the active-nav
  marker, the asks count. Nowhere else.
- Prussian `accent-800` for the one primary button per view; `accent-700` for links.
- `font-serif` (Newsreader) for the management voice — headlines, commitment statements,
  section heads, quoted reasons (italic). `font-sans` (Be Vietnam Pro) for the interface.
  `font-mono` (IBM Plex Mono) for every value, date, id, enum and fingerprint.
- Use the named type scale (`text-display` … `text-tag`), never Tailwind's defaults.
- **Headlines answer, not label:** management pages open with a computed sentence.
- **Rules, not boxes:** `SectionHead` (serif over a 2px ink rule) and hairline rows. White
  panels only in the aside.
- **Severity decides treatment;** nothing is ranked, scored or totalled. Endings are set in
  ink — Forge does not colour an outcome good or bad.
- Sentence case. True minus (−). Percent differences in "pts". Dates "2 Oct 2026".
  No emoji, no exclamation marks, no marketing adjectives.
- Motion: 160ms `ease-forge` on colour only.
- Every DEMO object says DEMO.

## Run

```bash
npm run dev       # :5193
npm run check
```
