#!/usr/bin/env node
/**
 * verify:loop — the success condition of the source of truth (§28), lived once.
 *
 *   WHY → DECISION → COMMITMENTS → OWNERSHIP → EXECUTION → EVIDENCE → OUTCOME → LEARNING → MEMORY
 *
 * Runs the Meridian story end to end and checks each link of the chain on the
 * record it produced. It prints the chain as it goes; any broken link fails it.
 * The three integration loops are checked as the demo lives them: Helm's decision
 * in, Memoire's reality observed, and the verified outcome published back.
 */
import { lensAt, unwrap, varianceOf } from '@forge/kernel';
import { outboundEvents } from '@forge/fabric';
import { createMeridianDemo, MOMENTS } from '@forge/demo';

const demo = createMeridianDemo();
const gm = demo.people.gm.scope;
const broken = [];
const check = (link, ok, detail) => {
  console.log(`  ${ok ? '✓' : '✖'} ${link.padEnd(12)} ${detail}`);
  if (!ok) broken.push(link);
};

let slipLens = null;
for (const m of MOMENTS) {
  await demo.advanceTo(m.key);
  if (m.key === 'slip') slipLens = lensAt(demo.clock.now());
}
const views = unwrap(await demo.runtime.list(gm));
const root = views.find((v) => v.record.parentId === null && v.record.origin.ref === 'helm:decision-commitment:dcm-rohto-q4');
const tree = views.filter((v) => v.record.origin.ref === root.record.origin.ref);
const candidates = unwrap(await demo.runtime.listCandidates(gm));
const ship = views.find((v) => v.record.id === demo.refs.ship);
const variance = varianceOf(root);
const evidence = views.flatMap((v) => v.evidence);
const fromSystems = evidence.filter((e) => e.item.channel === 'SYSTEM_EVENT').length;

console.log('verify:loop — Meridian, from Helm’s Rohto decision to the lesson it left\n');
check('WHY', views.every((v) => v.terms.why.length > 0), 'every commitment carries why it exists');
check('DECISION', tree.length === 5 && tree.every((v) => v.record.origin.fingerprint === 'dfp_demo7d2e91a04c5b3f18'), 'five answer to one fingerprinted Helm commitment');
check('COMMITMENTS', tree.filter((v) => v.record.parentId === root.record.id).length === 4, 'an outcome commitment and four beneath it, three drafted from Helm’s action intents');
check('OWNERSHIP', views.every((v) => v.acceptance !== null), 'each owner accepted; none was merely assigned');
check('EXECUTION', ship.links.some((l) => l.activity?.done === 14) && unwrap(await demo.runtime.view(gm, demo.refs.transfer)).links.length > 0, 'work observed where it happened — tracker, SCM — never moved into Forge');
check('EVIDENCE', fromSystems >= 8 && demo.log.every((l) => l.result === 'DONE'), `${fromSystems} of ${evidence.length} pieces of evidence came from systems; no status report was asked for`);
check(
  'OUTCOME',
  root.resolution?.resolution === 'PARTIALLY_FULFILLED' && variance.measures.find((x) => x.key === 'GrossMarginPct')?.difference === '-0.9668',
  'partly fulfilled; margin −0.9668 pts against Helm’s committed future, exactly',
);
check('LEARNING', root.learnings.length === 2 && unwrap(await demo.runtime.episode(gm, root.record.id)).complete, 'an explanation and a lesson, in a complete episode Helm’s genome can wrap');
check('MEMORY', root.publications.length === 1 && outboundEvents(views).some((e) => e.eventType === 'outcome.published'), 'the verified outcome published once, by the principal, for Helm’s enterprise memory');

console.log('');
const trigger = outboundEvents(views).find((e) => e.eventType === 'review_trigger.observed');
check('TO HELM', trigger?.payload.triggerKey === 'distributor-release-slips', 'Helm heard its own review trigger fire, from Forge');
const plan = views.find((v) => v.record.id === demo.refs.plan);
check(
  'FROM MEMOIRE',
  plan?.record.origin.kind === 'OBLIGATION' && plan.requirements.some((r) => r.requirement.key === 'memoire-promise-kept' && r.basis === 'SYSTEM'),
  'a Memoire promise became an obligation by a person’s confirmation, and Memoire’s own record proved it kept',
);
check(
  'NOT INVENTED',
  candidates.every((c) => c.record.epistemic === 'INFERENCE') && candidates.filter((c) => c.state === 'CONFIRMED').every((c) => c.disposition.actor.kind === 'PERSON'),
  `${candidates.length} candidates read from Memoire and meeting notes; every one that became a commitment, a person confirmed`,
);
const then = unwrap(await demo.runtime.view(gm, demo.refs.transfer, slipLens));
check('TIME', then.phase === 'ACTIVE' && then.terms.dueBy === '2026-10-02', 'reading at 1 October reproduces what was known then');

if (broken.length > 0) {
  console.error(`\nverify:loop — broken: ${broken.join(', ')}`);
  process.exit(1);
}
console.log('\nverify:loop — the chain holds, end to end.');
