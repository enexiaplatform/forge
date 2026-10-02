#!/usr/bin/env node
/**
 * The controlled extraction test (ADR-0012): the model inside Forge's governance,
 * on SYNTHETIC notes, against a hand-labelled gold set — once.
 *
 *   meeting notes → extraction → source grounding → classification
 *   → governance → candidate → a person's Confirm / Edit / Dismiss
 *
 * It runs the deterministic reference extractor always, and Claude only when
 * asked and keyed (`--live`, FORGE_LIVE_LLM=1, ANTHROPIC_API_KEY on this
 * machine — the key never leaves the server process). Then it plays the human
 * step through Forge's own runtime and reports, per extractor:
 *
 *   correct candidates · false commitments · missed commitments ·
 *   unsupported owner inference · unsupported dates · hallucinated dependencies ·
 *   classification errors · disagreements with the deterministic extractor
 *
 * The report is written to docs/evals/. Nothing it reads is real.
 *
 *   node server/eval/extraction-eval.mjs            # reference extractor only
 *   FORGE_LIVE_LLM=1 node server/eval/extraction-eval.mjs --live
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClaudeExtractor } from '../extraction/claude.ts';
import { MEETINGS } from './goldMeetings.mjs';
import { evaluate, renderReport } from './evaluate.mjs';

const live = process.argv.includes('--live');
if (live && !(process.env.FORGE_LIVE_LLM === '1' && process.env.ANTHROPIC_API_KEY)) {
  console.error('A live run needs FORGE_LIVE_LLM=1 and ANTHROPIC_API_KEY in this process’s environment. Nothing was sent.');
  process.exit(2);
}

const evaluation = await evaluate(MEETINGS, live ? [createClaudeExtractor()] : []);
const report = renderReport(evaluation, new Date().toISOString());
mkdirSync(new URL('../../docs/evals/', import.meta.url), { recursive: true });
const file = new URL(`../../docs/evals/extraction-${live ? 'live' : 'reference'}.md`, import.meta.url);
writeFileSync(file, report);
console.log(report.split('\n').slice(0, 18).join('\n'));
console.log(`\nWritten: ${file.pathname}`);
