# ADR-0021 — Acts that bind accountability rest on Helm's standing, and the database checks it

**Answers** [ADR-0013](0013-trusted-authority-gate-and-deployment-progression.md) (the trusted authority production waits on) ·
**With** Helm ADR-0036 (standing attestations)

**Context.** Who may accept a promise, decide a change to it, close or reopen it was decided by the interim policy
(ADR-0005), in the browser, from the parties a client said it acts as. ADR-0013 kept production closed until Helm's
trusted authority answered the port. Two questions hide in "may this person accept?": which party holds the act —
Forge's rule, read from the commitment (the owner accepts, the principal decides) — and whether the person calling may
act for that party. Only Helm knows the second: its people, and its seats, including who is acting while someone is away.

**Decision.** Split the question where the knowledge lives, and check both where a client cannot reach.

- **Helm attests standing** (Helm ADR-0036). Its trusted service answers `attest-standing`: may the verified caller act
  for this Helm person, now — SELF, or ACTING_FOR in a seat that person holds — and records each attestation,
  service-only.
- **Forge's adapter asks only for the party that holds the act.** `createHelmAuthority` (fabric) ignores whom the client
  says it acts as. For each act that binds accountability (accept, decline, change, decide a change, reopen) it asks Helm
  to attest standing for the holder — the principal before the owner for a change, so an owner's change becomes a
  request — and lets Forge's rule decide with that attested party alone. The verdict is trusted and carries the
  attestation id. Helm unreachable is a refusal that says so; nothing that binds accountability is recorded on a guess.
- **Forge's database binds the attestation to the act** (`forge_events_standing`). An event that claims a trusted verdict
  must name a Helm attestation in the same organization, made in the last ten minutes, by the person writing the event,
  for a person who holds that act on that commitment — computed in SQL from Forge's own record: the owner after any
  handover, the principal, the approver of the request a decision answers. Helm never reads Forge; Forge never takes the
  client's word for whom it acts.
- **An organization moves to TRUSTED authority once, on the record.** `forge_authority_modes` is append-only and written
  only by the service role, with a reason. From then on every consequential event needs the attestation; the interim
  policy can no longer decide one, even from a client that skips the runtime.
- **The port awaits.** `AuthorityPort.evaluate` may answer asynchronously; the interim policy still answers at once, and
  the console still asks it what a reader may do.

**Consequences.** Integration loop 4 runs Helm's real trusted service over its real Postgres store in the same database
as Forge: the owner accepts on their own standing; someone acting in their seat may accept for them; a colleague who
claims to act for the owner is refused by Helm and nothing is written; a tampered client that borrows another person's
attestation, uses one for the wrong person or names none is refused by the database; a redate rests on the owner's
standing and its approval on the principal's; once the organization is TRUSTED the interim policy is refused there too.
The staging suite gains "acts bound to Helm's standing" and fails by name without the trigger.

What standing does not decide, by design: thresholds and approvals on execution acts (whether cancelling a decision's
outcome commitment needs a higher signature). That would be an evaluation in Helm's authority engine, asked for when the
product owner wants it. The ten-minute window is a judgement: long enough for a person to finish an act, short enough
that a change of seat is felt within it.
