import { createInMemoryCandidateStore, createInMemoryStore, manualClock } from '../src/index.ts';
import { candidateConformance, storeConformance } from './conformance.mjs';

const scope = (orgId, id, clearances = []) => ({ orgId, actor: { kind: 'PERSON', id, label: id }, role: 'member', actsAs: [], clearances });

const setup = async () => {
  const clock = manualClock('2026-09-25T09:00:00.000Z');
  return {
    store: createInMemoryStore(clock),
    candidates: createInMemoryCandidateStore(clock),
    a: scope('org-a', 'user-a', ['FINANCIAL_SENSITIVE']),
    a2: scope('org-a', 'user-a2'),
    b: scope('org-b', 'user-b'),
  };
};

storeConformance('in-memory', setup);
candidateConformance('in-memory', setup);
