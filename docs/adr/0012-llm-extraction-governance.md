# ADR-0012 — The first language-model job: reading notes, governed by Forge

**Context.** The first responsibility given to a model is extracting candidate
commitments from unstructured communication — meeting notes and transcripts first. The
point is to reduce administrative capture, not to manufacture enterprise truth.

**Decision.** An `ExtractionModel` port (`fabric/extraction.ts`) returns **raw
findings** only, in one schema (`EXTRACTION_SCHEMA`) under one set of instructions
(`extractionInstructions`) for every model. `governExtraction` — Forge's code, not the
model's — decides what may be offered: a quote must appear verbatim in the notes or the
finding is removed and listed; unknown classes are removed; DISCUSSION, REQUEST and
INTENTION are never proposed; a commitment nobody stands behind is not proposed; an
owner is matched only to a party Forge knows, else kept as words; a date counts only if
its words are in the quote, it parses, and it is not before the meeting. Everything that
survives is a candidate (ADR-0009).

Two models answer the port. `forge-reference-extractor@1` is deterministic and offline
(cue phrases, and says so). The **Claude extractor** (`server/extraction/claude.ts`)
runs on the server only: `claude-opus-5-5`, structured outputs with the extraction
schema, effort `high`, Anthropic's default refusal fallback. A refusal, a truncated
answer, malformed output, a refused key or an unreachable model are typed failures,
never an empty reading. `/api/extract` reports whether a model is available; the
console uses Claude when it is and the reference extractor otherwise, and governs either
answer the same way. `verify:boundaries` holds the SDK to `server/` and keeps it out of
the browser bundle.

**Consequences.** A model can only make a person's job shorter, never decide it. The
live call is opt-in (`FORGE_LIVE_LLM=1` and a key) because it costs money; without it,
the Claude path is proven with an injected client — the request Forge makes and every
failure mode — not against the model itself.

**Update, 2026-10-02 — measuring before deciding.** The controlled extraction test
(`server/eval/`) scores any extractor against hand-labelled SYNTHETIC meetings for the
failures that matter: false commitments, missed commitments, unsupported owners and dates,
hallucinated dependencies, classification errors, and disagreements with the reference
extractor. Its scorer is tested with a stand-in model that plants one of each
(`server/test/extractionEval.test.mjs`), so a live run measures the model, not the
instrument. Two things governance deliberately does *not* yet refuse are measured instead:
an owner who is neither the speaker nor named in the quote, and a dependency whose words
are not in the quote. Both reach the person as inference to confirm or correct. Whether
governance should refuse them is decided on the live result, not before it.
