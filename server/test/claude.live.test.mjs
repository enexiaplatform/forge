/**
 * One live reading by Claude — opt in only, because it calls the API and costs money:
 *
 *   FORGE_LIVE_LLM=1 ANTHROPIC_API_KEY=… node --test server/test/claude.live.test.mjs
 *
 * It checks the contract, not the model's taste: the answer parses, every
 * candidate rests on words that are in the notes, and the request, the
 * intention and the discussion are not proposed as promises.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '@forge/fabric';
import { QC_REVIEW_NOTES } from '@forge/demo';
import { createClaudeExtractor } from '../extraction/claude.ts';

const live = process.env.FORGE_LIVE_LLM === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

test('Claude reads the QC review notes within Forge’s rules', { skip: live ? false : 'live LLM test: set FORGE_LIVE_LLM=1 and ANTHROPIC_API_KEY to run it; skipped, not passed', timeout: 300_000 }, async () => {
  const read = await extractCandidates(createClaudeExtractor(), QC_REVIEW_NOTES);
  assert.ok(read.ok, read.ok ? '' : `${read.error.code}: ${read.error.message}`);
  const { candidates, findings } = read.value;
  assert.ok(candidates.some((c) => /SOP/.test(c.proposal.statement)), 'the SOP revision is proposed');
  for (const c of candidates) assert.ok(QC_REVIEW_NOTES.text.includes(c.source.quote), `“${c.source.quote}” is in the notes`);
  const proposedQuotes = candidates.map((c) => c.source.quote ?? '');
  assert.ok(!proposedQuotes.some((q) => /Could you check|I might ask|We should look/.test(q)), 'request, intention and discussion are not promises');
  console.log(findings.map((f) => `${f.class.padEnd(11)} ${f.candidate ? '→ candidate' : `   (${f.notConverted})`}  “${f.quote}”`).join('\n'));
});
