/** Reads the pages share. Everything is derived from the ledger at the demo's present. */
import type { CommitmentView, Condition, Scope } from '@forge/kernel';
import { helmCommitmentRef, type HelmCommittedDecision, pendingIntake } from '@forge/fabric';
import type { MeridianDemo } from '@forge/demo';

export { MOMENTS, PEOPLE, type PersonKey } from '@forge/demo';

export type Ledger = {
  readonly views: CommitmentView[];
  readonly conditions: Condition[];
  readonly byId: Map<string, CommitmentView>;
};

export async function loadLedger(demo: MeridianDemo, scope: Scope): Promise<Ledger> {
  const views = await demo.runtime.list(scope);
  const conditions = await demo.runtime.conditions(scope);
  const v = views.ok ? views.value : [];
  return { views: v, conditions: conditions.ok ? conditions.value : [], byId: new Map(v.map((x) => [x.record.id, x])) };
}

export async function pendingIntakeCount(demo: MeridianDemo, scope: Scope): Promise<number> {
  const r = await pendingIntake(demo.runtime, scope, demo.helm);
  return r.ok ? r.value.length : 0;
}

export type DecisionEntry = {
  readonly decision: HelmCommittedDecision;
  readonly ref: string;
  readonly commitments: CommitmentView[];
};

/** Every Helm decision Forge can see, with the commitments that answer to it. */
export async function loadDecisions(demo: MeridianDemo, scope: Scope): Promise<DecisionEntry[]> {
  const committed = await demo.helm.committedSince(scope, null);
  const views = await demo.runtime.list(scope);
  if (!committed.ok || !views.ok) return [];
  return committed.value.map((decision) => {
    const ref = helmCommitmentRef(decision.commitment.id);
    return { decision, ref, commitments: views.value.filter((v) => v.record.origin.ref === ref) };
  });
}

/** Where the evidence on the ledger came from — the reporting burden Forge did not put on people. */
export function evidenceSourcing(views: readonly CommitmentView[]) {
  let system = 0;
  let person = 0;
  let inference = 0;
  let activity = 0;
  for (const v of views) {
    for (const e of v.evidence) {
      if (e.item.channel === 'SYSTEM_EVENT' || e.item.channel === 'API') system += 1;
      else if (e.item.epistemic === 'INFERENCE') inference += 1;
      else person += 1;
    }
    activity += v.events.filter((e) => e.type === 'ACTIVITY_OBSERVED').length;
  }
  return { system, person, inference, activity };
}

/** Root commitments first, each followed by its descendants, depth-first. */
export function asTree(views: readonly CommitmentView[]): { view: CommitmentView; depth: number }[] {
  const ids = new Set(views.map((v) => v.record.id));
  const children = (id: string | null) => views.filter((v) => (id === null ? v.record.parentId === null || !ids.has(v.record.parentId) : v.record.parentId === id));
  const out: { view: CommitmentView; depth: number }[] = [];
  const walk = (id: string | null, depth: number) => {
    for (const v of children(id)) {
      if (out.some((o) => o.view.record.id === v.record.id)) continue;
      out.push({ view: v, depth });
      walk(v.record.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
