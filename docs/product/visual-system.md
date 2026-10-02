# Visual system — Forge "Foundry"

Forge reads as a sibling of Helm's "Chart room": the same warm paper, ink, type families,
type scale and Prussian interaction colour, so a manager moving between Helm and Forge is
in one infrastructure. Forge's own marks are its **iron** chrome and an **ember** node.

| What | Where |
| --- | --- |
| Every token | [`tailwind.config.js`](../../tailwind.config.js) — the only place a colour is defined |
| Fonts and base styles | [`src/index.css`](../../src/index.css); files in `public/fonts` (shared with Helm) |
| The mark | [`ForgeLogo.tsx`](../../src/components/brand/ForgeLogo.tsx), [`public/favicon.svg`](../../public/favicon.svg) |
| Primitives | [`src/components/ui/`](../../src/components/ui) — Button, Tag, PageHeader, SectionHead, FactRow, Panel, Modal, Field |

## The mark

An intent stroke and an execution stroke meet the outcome line; the ember node where
they join is the commitment. Paper strokes on iron; ember for the node only. The
wordmark is drawn, not typed.

## Signature: the chain strip

Every commitment page opens with the §28 chain — Why · Decision · Commitment · Ownership
· Execution · Evidence · Outcome · Learning — eight cells, each with one fact. A cell's
top rule is ink when the link holds, amber when it is open, red when it is broken, and
grey when it does not apply. It is a reading aid, never a score: nothing is summed
across the cells.

## Registers

- **Management** (Asks, Commitments, a commitment, Decisions, trace, intake, Memory):
  1240px, kicker "Management · …", a computed serif headline, main column plus a 360px
  aside that wraps below ~960px.
- **Instrument** (Surfaces): full width, a 28px title naming the object, raw enums,
  system names and idempotency keys visible.

## Classes and capture, always visible

Statement classes — FACT (ink), INFERENCE (violet), ASSUMPTION (amber), DECISION
(Prussian), RECOMMENDATION and PREDICTION (sky) — appear as mono tags wherever a
statement is shown. Capture modes — inherited (emerald), inferred (violet), confirmed
(ink), typed (amber), missing (red) — appear on every term of a commitment and every
field of a draft.
