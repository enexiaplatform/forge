# ADR-0013 — A trusted-authority gate, and how the tables reach production

**Context.** Forge's interim authority policy (ADR-0005) is enforced in the runtime,
not the database. The shared Supabase project is production for Helm. Forge must not
block on Helm's Decision & Authority Runtime, but it must not reach production
without it.

**Decision.** Every authority verdict says whether it is **trusted**. The interim
policy's verdicts are not. Consequential acts — accept, decide a change, change
(including cancel and close), reopen — are refused with `authority.untrusted` when the
runtime is built with `requireTrustedAuthority`, unless the verdict came from a trusted
authority answering the same port. Development, the demo and tests run without the
gate; the production deployment turns it on, so the interim policy can never decide a
consequential act there.

The tables move **Local → Staging (an isolated Supabase branch) → Helm authority
integration → shared production**. Local is PGlite with Helm's real migrations and
Forge's (ADR-0016). Staging uses the same migrations on a branch, read through
supabase-js (`createSupabaseTableClient`). Production follows only when Helm's runtime
answers Forge's authority port as a trusted authority.

**Consequences.** Development continues without waiting; production cannot quietly run
on the interim policy. A Supabase branch costs money and is created only on the
product owner's say-so. Until Helm's runtime exists, the database enforces tenancy,
visibility (ADR-0015), append-only history and who wrote what — not who may approve.
