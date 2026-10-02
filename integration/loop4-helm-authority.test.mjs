/**
 * Loop 4 — the acts that bind accountability rest on Helm's standing (ADR-0021; Helm ADR-0036).
 *
 * One Postgres carries Helm's migrations and Forge's. Helm's own trusted authority service — its real code, over its
 * real Postgres authority store, writing as the service role — attests whether a signed-in person may act for
 * another: themselves, or acting in a seat the other holds. Forge's runtime asks it through `createHelmAuthority`,
 * with the production gate on; Forge's database then checks every consequential event against the attestation it
 * names. A tampered client that skips the runtime meets the database, not the policy.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeRuntime, interimAuthority, sequentialIds } from '@forge/kernel';
import { createPostgresStore, createSqlTableClient } from '@forge/kernel/postgres';
import { createHelmAuthority, helmStandingAttestor } from '@forge/fabric';
import { ecosystemDatabase, runnerAs, seedOrganization } from './support/database.mjs';
import { postgrestClient } from './support/postgrest.mjs';
import { helmSkip } from './support/siblings.mjs';

const ORG = '10000000-0000-4000-8000-0000000000a4';
const GM = '30000000-0000-4000-8000-0000000000a1'; // Country GM (SYNTHETIC): the principal
const SCM = '30000000-0000-4000-8000-0000000000a2'; // Supply Chain Director (SYNTHETIC): the owner
const ACT = '30000000-0000-4000-8000-0000000000a3'; // acting Supply Chain Director while SCM is away
const OTHER = '30000000-0000-4000-8000-0000000000a5'; // a colleague
const ROLE = '50000000-0000-4000-8000-0000000000a1';
const clock = { now: () => new Date().toISOString() };

const party = (label, ref) => ({ kind: 'PERSON', label, ref });
const terms = (statement) => ({
  statement,
  intendedOutcome: 'Eight units are in HCMC (SYNTHETIC).',
  why: 'Management committed to it (SYNTHETIC).',
  owner: party('Supply Chain Director (SYNTHETIC)', SCM),
  principal: party('Country GM (SYNTHETIC)', GM),
  dueBy: '2026-12-31',
  evidence: [{ key: 'received', level: 'OUTPUT', description: 'The warehouse records the units received (SYNTHETIC)', required: true, matcher: { system: 'wms', eventType: 'receipt.posted', objectRef: 'wms:receipt:synthetic', where: {} } }],
  measures: [],
  value: [],
});
const origin = { kind: 'DIRECT', system: 'forge', ref: null, label: 'SYNTHETIC', fingerprint: null, snapshot: null };

describe('Loop 4 — acts that bind accountability rest on Helm’s standing, checked by Forge’s database', { skip: helmSkip }, () => {
  let db;
  let service; // Helm's trusted authority service
  const ids = sequentialIds();
  const scopeOf = (uid, actsAs = []) => ({ orgId: ORG, actor: { kind: 'PERSON', id: uid, label: uid }, role: 'member', actsAs });
  const storeAs = (uid) => createPostgresStore(createSqlTableClient(runnerAs(db, 'authenticated', uid)));
  /** Forge as `uid`, asking Helm — and refusing anything Helm's trusted authority did not allow. */
  const trustedAs = (uid) =>
    createForgeRuntime({
      store: storeAs(uid),
      clock,
      ids,
      authority: createHelmAuthority(helmStandingAttestor((body) => service.handle({ userId: uid }, body))),
      requireTrustedAuthority: true,
    });
  const proposed = async (statement) => {
    const r = await trustedAs(GM).propose(scopeOf(GM), { origin, terms: terms(statement) });
    assert.equal(r.ok, true, JSON.stringify(r.error));
    return r.value.record.id;
  };

  before(async () => {
    db = await ecosystemDatabase();
    await seedOrganization(db, {
      orgId: ORG,
      name: 'Meridian SYNTHETIC (loop 4)',
      members: [{ uid: GM, role: 'admin' }, { uid: SCM, role: 'member' }, { uid: ACT, role: 'member' }, { uid: OTHER, role: 'member' }],
    });
    // Helm's seats: SCM holds the role; ACT is acting in it.
    await db.query(
      `INSERT INTO public.helm_entities (id, org_id, entity_type_id, canonical_key, name, source_system) VALUES ($1, $2, 'et_role', 'helm:role:scm-vn-synthetic', 'Supply Chain Director Vietnam (SYNTHETIC)', 'helm')`,
      [ROLE, ORG],
    );
    for (const [uid, kind, label] of [[SCM, 'SUBSTANTIVE', 'Owner (SYNTHETIC)'], [ACT, 'ACTING', 'Acting owner (SYNTHETIC)']]) {
      await db.query(
        `INSERT INTO public.helm_role_occupancies (org_id, role_id, role_label, user_id, person_label, kind, valid_from, basis) VALUES ($1, $2, 'Supply Chain Director Vietnam', $3, $4, $5, now() - interval '30 days', 'Appointment (SYNTHETIC)')`,
        [ORG, ROLE, uid, label, kind],
      );
    }

    const { createTrustedAuthorityService } = await import('@helm/authority-runtime');
    const { createPostgresAuthorityStore } = await import('@helm/authority-runtime/postgres');
    const serviceClient = postgrestClient(runnerAs(db, 'service_role', null));
    const helmClock = { now: () => new Date() };
    service = createTrustedAuthorityService({
      // The standing operation reads seats and writes its record; the decision stack is not involved.
      runtime: null, decisions: null, scenarios: null, engine: null, registry: null, valueGraph: null,
      store: createPostgresAuthorityStore({ client: serviceClient, clock: helmClock }),
      clock: helmClock,
      host: 'integration:helm-authority',
      async membershipOf(userId, orgId) {
        const { rows } = await db.query('SELECT role FROM public.organization_memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
        return { ok: true, value: rows.length ? { orgRole: rows[0].role, memberUnitIds: [] } : null };
      },
      callerCanSeeDecision: async () => ({ ok: true, value: true }),
    });
  });

  test('the owner accepts: Helm attests who they are, and the event names the attestation', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — the owner accepts');
    const r = await trustedAs(SCM).accept(scopeOf(SCM), id);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const accepted = r.value.events.find((e) => e.type === 'ACCEPTED');
    assert.equal(accepted.authority.trusted, true);
    assert.equal(accepted.authority.policy, 'helm-standing@1');
    const { rows } = await db.query('SELECT caller_user_id, for_user_id, basis FROM public.helm_standing_attestations WHERE id = $1', [accepted.authority.attestation]);
    assert.equal(rows[0].for_user_id, SCM);
    assert.equal(rows[0].basis.kind, 'SELF');
  });

  test('someone acting in the owner’s seat may accept for them — Helm’s seat records say so, not the client', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — the acting owner accepts');
    const r = await trustedAs(ACT).accept(scopeOf(ACT), id);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const accepted = r.value.events.find((e) => e.type === 'ACCEPTED');
    const { rows } = await db.query('SELECT basis FROM public.helm_standing_attestations WHERE id = $1', [accepted.authority.attestation]);
    assert.equal(rows[0].basis.kind, 'ACTING_FOR');
    assert.match(accepted.authority.statement, /acting as Supply Chain Director Vietnam/);
  });

  test('a colleague who says they act for the owner is refused by Helm, and nothing is written', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — a colleague tries');
    const claimsToBeOwner = scopeOf(OTHER, [party('Supply Chain Director (SYNTHETIC)', SCM)]);
    const r = await trustedAs(OTHER).accept(claimsToBeOwner, id);
    assert.equal(r.ok, false);
    assert.match(r.error.message, /do not let you act for Supply Chain Director/);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.forge_commitment_events WHERE commitment_id = $1 AND event_type = 'ACCEPTED'`, [id]);
    assert.equal(rows[0].n, 0);
  });

  test('a tampered client cannot borrow trust: the database refuses another person’s attestation, and one for the wrong person', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — a tampered client');
    const owners = await service.handle({ userId: SCM }, { op: 'attest-standing', orgId: ORG, forUserId: SCM });
    const own = await service.handle({ userId: OTHER }, { op: 'attest-standing', orgId: ORG, forUserId: OTHER });
    const forge = (attestation) =>
      storeAs(OTHER).appendEvents(scopeOf(OTHER), [{
        id: ids.next('evt'), orgId: ORG, commitmentId: id, type: 'ACCEPTED', effectiveAt: clock.now(), actor: { kind: 'PERSON', id: OTHER, label: 'Colleague' },
        reason: null, authority: { policy: 'helm-standing@1', rule: 'owner-accepts', statement: 'forged', approvalRequestId: null, trusted: true, attestation },
        idempotencyKey: null, payload: { party: terms('x').owner, confirmed: [], evidence: null },
      }]);
    const borrowed = await forge(owners.body.attestation.id);
    assert.equal(borrowed.ok, false);
    assert.match(borrowed.error.message, /someone else/);
    const wrongPerson = await forge(own.body.attestation.id);
    assert.equal(wrongPerson.ok, false);
    assert.match(wrongPerson.error.message, /does not hold this act/);
    const none = await forge(undefined);
    assert.equal(none.ok, false);
    assert.match(none.error.message, /needs Helm/);
  });

  test('a change takes both: the owner’s request rests on their standing, the principal’s decision on theirs', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — a redate');
    assert.equal((await trustedAs(SCM).accept(scopeOf(SCM), id)).ok, true);
    const asked = await trustedAs(SCM).change(scopeOf(SCM), id, { kind: 'REDATE', dueBy: '2027-01-15' }, 'The release slipped (SYNTHETIC).');
    assert.equal(asked.ok, true, JSON.stringify(asked.error));
    assert.equal(asked.value.applied, false, 'the owner’s change waits for the principal');
    const decided = await trustedAs(GM).decideChange(scopeOf(GM), id, asked.value.requestId, 'APPROVED', null);
    assert.equal(decided.ok, true, JSON.stringify(decided.error));
    assert.equal(decided.value.terms.dueBy, '2027-01-15');
  });

  test('once the organization is TRUSTED, the interim policy can no longer decide an act — in the database', async () => {
    const id = await proposed('Transfer eight units (SYNTHETIC) — after the switch');
    await runnerAs(db, 'service_role', null)(`INSERT INTO public.forge_authority_modes (id, org_id, mode, reason) VALUES ('mode-loop4', $1, 'TRUSTED', 'Helm''s trusted authority answers Forge (SYNTHETIC deployment step).')`, [ORG]);
    const interim = createForgeRuntime({ store: storeAs(SCM), clock, ids, authority: interimAuthority });
    const refused = await interim.accept(scopeOf(SCM, [terms('x').owner]), id);
    assert.equal(refused.ok, false);
    assert.match(refused.error.message, /needs Helm/);
    assert.equal((await trustedAs(SCM).accept(scopeOf(SCM), id)).ok, true, 'Helm’s standing still lets the owner accept');
  });

  test('no client records a standing attestation or switches the mode: only Helm’s service, and the deployment', async () => {
    const asClient = runnerAs(db, 'authenticated', OTHER);
    await assert.rejects(() => asClient(`INSERT INTO public.helm_standing_attestations (org_id, caller_user_id, for_user_id, basis, evaluator, attested_at) VALUES ($1, $2, $3, '{"kind":"ACTING_FOR"}', '{"kind":"TRUSTED_SERVICE","host":"x"}', now())`, [ORG, OTHER, SCM]));
    await assert.rejects(() => asClient(`INSERT INTO public.forge_authority_modes (id, org_id, mode, reason) VALUES ('mode-x', $1, 'INTERIM', 'Switching back from a browser.')`, [ORG]));
  });
});
