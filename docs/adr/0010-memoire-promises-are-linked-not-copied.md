# ADR-0010 — Memoire's promises are linked, not copied

**Context.** Memoire owns commercial promises — what the enterprise and its customers
said they would do. Most are context. Some are real enterprise obligations: someone in
the enterprise owes them, by a date, with consequences.

**Decision.** Memoire owns the commercial promise; Forge owns the accountable
organizational commitment. Forge reads promises through Memoire's **Commercial API v1**
with Memoire's own SDK, as the promise's owner, following every cursor
(`fabric/memoireCommercial.ts`). The promotion rule `forge-memoire-promotion@1` proposes
a candidate only when the enterprise owes it (`self` or `internal`), it is open, a person
is named and it has a date; everything else stays context. The path is
*Memoire promise → candidate obligation → a person confirms → a Forge commitment whose
origin is `memoire:commitment:<id>`* — a link, never a duplicate. Memoire recording the
promise kept is evidence the commitment watches for; a cancelled promise is a context
change that asks the commitment's principal.

Change notifications arrive by Memoire's commercial webhooks v1
(`fabric/memoireWebhooks.ts`): Forge verifies the HMAC signature and the five-minute
window **before** parsing, deduplicates by notification id, then reads what changed
through the API — a notification carries no commercial truth. The receiver accepts
any well-formed subject kind (Memoire added `shared-workspace`; refusing it would only
make Memoire retry) and interprets only what API v1 can read, saying so for the rest.

**Consequences.** Memoire's record stays the record. Forge cannot see promises the
reader does not own (Memoire's RLS decides). Only promises are readable through API v1
today; opportunities and incidents announced by webhook are acknowledged and left
uninterpreted until Memoire exposes them.
