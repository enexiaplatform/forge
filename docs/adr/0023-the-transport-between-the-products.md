# ADR-0023 — The transport between the products: Forge sends as a person, Helm's host receives as Helm

**Completes** [ADR-0018](0018-submitting-outcomes-through-helms-governed-intake.md) and
[ADR-0010](0010-memoire-promises-are-linked-not-copied.md) · **With** Helm ADR-0037 (the execution intake host)

**Context.** Forge's verified outcomes reached Helm's governed intake, and Memoire's notifications reached Forge's
verified receiver — but only inside the integration suite, which composed both sides in one process. Nothing hosted
either end. The plan (2.2) asked for transport that adds no new truth: the same contracts, carried.

**Decision.**

- **Helm hosts its intake.** Helm's `helm-execution-intake` edge function runs Helm's intake as the caller, under
  Helm's row-level security, with no service role (Helm ADR-0037). It takes an organization and a submission, nothing
  else; a duplicate answers with the receipt Helm already holds.
- **Forge sends as the person, and stores nothing about it.** `deliverOutcomes` (fabric) derives what is pending — a
  commitment's latest publication whose fingerprint Helm holds no receipt for, read from Helm's receipts by reference
  under Helm's rules — and sends each once with the sender's own session. A refusal comes back in Helm's words for the
  person to read; a connection that fails leaves the rest pending; a sender that lost an answer sends again and Helm
  answers with the receipt. There is no outbox table: what is pending is derived, and Helm's uniqueness makes resending
  safe.
- **Forge hosts its Memoire receiver.** `handleMemoireWebhook` (server) is the receiving end of Memoire's webhooks v1 as
  one request and one status: verify, parse, deduplicate, read through Commercial API v1 as the owner, ingest as the
  connector. 401 for a body that will never verify, 400 for a malformed envelope, 200 for received or already received,
  503 for "could not record it now — retry". Ingestion is idempotent, so a receiver that forgets what it has seen re-reads
  safely.

**Consequences.** Integration loop 1 now delivers the Rohto outcome through Forge's transport into Helm's host code,
proves nothing is left pending once Helm holds the receipt, that a resend is answered with the same receipt, and that a
body naming its own sender is refused. Loop 2 runs Memoire's own webhook worker against Forge's host. Forge writes
nothing of Helm's or Memoire's: `verify:boundaries` still holds.

**Not built, and why.** The Memoire receiver has no deployed wrapper yet: it reads through Memoire's own SDK, which is
not installable from Forge's server today, and re-implementing Commercial API v1 in Forge would be the copy ADR-0010
forbids. The console does not yet show "published, not received by Helm" — the demo has no Helm to receive it; the
derivation (`pendingDeliveries`) is ready for when a session does.
