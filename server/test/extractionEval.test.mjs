/**
 * The extraction test's instrument, measured before a live run measures a model. A stand-in for Claude — the real
 * Claude extractor over an injected client, so the request, the parsing and Forge's governance are the ones a live
 * run uses — answers the two SYNTHETIC meetings with exactly one of each failure the report counts. The instrument
 * must find each one, once, and nothing else; and no commitment may exist before the person's review.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { referenceExtractor } from '@forge/fabric';
import { createClaudeExtractor } from '../extraction/claude.ts';
import { MEETINGS } from '../eval/goldMeetings.mjs';
import { evaluate, renderReport, total } from '../eval/evaluate.mjs';

const finding = (quote, over = {}) => ({
  quote, class: 'COMMITMENT', speaker: null, statement: quote, proposedOutcome: null, owner: null,
  dueText: null, dueDate: null, dependencies: [], entities: [], confidence: 0.8, rationale: 'Stand-in.', ...over,
});

/** What the stand-in "reads" in each meeting: right where noted, wrong exactly once per failure kind. */
const PLANTED = {
  'QC review (SYNTHETIC)': [
    finding('Two units of SKU-X failed seal inspection', { class: 'DISCUSSION', speaker: 'Quang' }),
    // correct
    finding('I will revise the transfer SOP to add a QC re-release step by 30 October', { speaker: 'Minh', owner: 'Minh', dueText: 'by 30 October', dueDate: '2026-10-30' }),
    // unsupported owner (Quang said it; Minh is proposed) and a dependency the sentence does not contain
    finding('I will re-inspect the two held units and release them by 23 October', { speaker: 'Quang', owner: 'Minh', dueText: 'by 23 October', dueDate: '2026-10-23', dependencies: ['warehouse audit signed off'] }),
    // a false commitment, and so a classification error: tentative language read as a promise
    finding('I might ask Distributor D for their storage logs', { speaker: 'Minh', owner: 'Minh' }),
    // an invented sentence: governance removes it
    finding('Minh: I will close the warehouse by Friday', { speaker: 'Minh', owner: 'Minh' }),
    // the decision "no further transfers … Owner: Minh" is not read at all: a missed commitment
  ],
  'Commercial sync (SYNTHETIC)': [
    // an unsupported date: Wednesday after 19 October 2026 is the 21st, not the 22nd
    finding("Thu, I'll send you the PO numbers by Wednesday", { speaker: 'Hoa', owner: 'Hoa', dueText: 'by Wednesday', dueDate: '2026-10-22' }),
    // a decision nobody stands behind: governance does not invent an owner
    finding('we hold the current price until the end of the quarter', { class: 'DECISION', speaker: 'Thu' }),
    // correct
    finding('I commit to sending Customer R the installation plan by 24 October', { speaker: 'Hoa', owner: 'Hoa', dueText: 'by 24 October', dueDate: '2026-10-24' }),
  ],
};

function standInClient() {
  return {
    beta: {
      messages: {
        stream(params) {
          const meeting = MEETINGS.find((m) => params.messages[0].content.includes(m.input.text));
          const findings = PLANTED[meeting.input.source.label];
          return {
            finalMessage: async () => ({
              id: 'msg_stand_in', type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn', stop_details: null,
              content: [{ type: 'text', text: JSON.stringify({ findings }) }], usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    },
  };
}

describe('the extraction test measures what it says it measures', () => {
  let evaluation;
  const CLAUDE = 'forge-claude-extractor@1';
  const sum = (key) => total(evaluation, CLAUDE, key);

  before(async () => {
    evaluation = await evaluate(MEETINGS, [createClaudeExtractor({ client: standInClient() })]);
  });

  test('the stand-in runs through the real extractor, and the reference runs beside it', () => {
    assert.deepEqual(evaluation.extractors.map((x) => x.name), [referenceExtractor.name, CLAUDE]);
    for (const r of evaluation.results) assert.equal(r.by[CLAUDE].error, undefined, r.by[CLAUDE].error);
  });

  test('each planted failure is found once — and only those', () => {
    assert.equal(sum('correct'), 4, 'two exact, one with the wrong owner, one with the wrong date: all four are the right sentences');
    assert.equal(sum('falseCommitments'), 1);
    assert.equal(sum('missed'), 1);
    assert.equal(sum('unsupportedOwner'), 1);
    assert.equal(sum('unsupportedDate'), 1);
    assert.equal(sum('missedDate'), 0);
    assert.equal(sum('hallucinatedDependencies'), 1);
    assert.equal(sum('classificationErrors'), 1);
    assert.equal(sum('removedByGovernance'), 1);
    const qc = evaluation.results[0].by[CLAUDE].score;
    assert.match(qc.falseCommitments[0].quote, /I might ask Distributor D/);
    assert.match(qc.missed[0], /no further transfers/);
    assert.equal(qc.unsupportedOwner[0].gold, 'Logistics Manager (SYNTHETIC)');
    assert.equal(qc.hallucinatedDependencies[0].dependency, 'warehouse audit signed off');
    assert.deepEqual(evaluation.results[1].by[CLAUDE].score.unsupportedDate[0], { quote: "Thu, I'll send you the PO numbers by Wednesday", proposed: '2026-10-22', gold: '2026-10-21' });
  });

  test('a decision nobody stands behind is read, and not offered', () => {
    const price = evaluation.results[1].by[CLAUDE].findings.find((f) => /current price/.test(f.quote));
    assert.equal(price.candidate, false);
    assert.equal(price.notConverted, 'Nobody in the notes stands behind it.');
  });

  test('nothing is a commitment before the person reviews it; the person confirms, edits and dismisses through Forge', () => {
    const people = evaluation.results.map((r) => r.by[CLAUDE].person);
    assert.deepEqual(people.map((p) => p.commitmentsBeforeReview), [0, 0]);
    const t = (k) => people.reduce((n, p) => n + p[k], 0);
    assert.deepEqual({ confirmed: t('confirmed'), edited: t('edited'), dismissed: t('dismissed'), after: t('commitmentsAfterReview') }, { confirmed: 2, edited: 2, dismissed: 1, after: 4 });
  });

  test('disagreements with the deterministic extractor name the sentences read differently', () => {
    const quotes = evaluation.results.flatMap((r) => r.disagreements[CLAUDE].map((d) => d.quote));
    assert.ok(quotes.includes('I might ask Distributor D'), 'intention vs. promise');
    assert.ok(quotes.includes('no further transfers from Distributor D'), 'read by one, missed by the other');
    assert.ok(!quotes.includes('I will revise the transfer SOP'), 'agreement is not listed');
  });

  test('the report carries every metric, both extractors, and says nothing is real', () => {
    const md = renderReport(evaluation, '2026-10-02T00:00:00.000Z');
    assert.match(md, /SYNTHETIC/);
    assert.match(md, /\| False commitments \| 0 \| 1 \|/);
    assert.match(md, /\| Hallucinated dependencies \| 0 \| 1 \|/);
    assert.match(md, /\| Findings removed by governance \(quote not in notes\) \| 0 \| 1 \|/);
  });

  test('a model that fails is reported as a failed run, never as an empty reading', async () => {
    const broken = { beta: { messages: { stream: () => ({ finalMessage: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { status: undefined }); } }) } } };
    const e = await evaluate(MEETINGS.slice(0, 1), [createClaudeExtractor({ client: broken })]);
    assert.match(e.results[0].by[CLAUDE].error, /^extraction\./);
    assert.match(renderReport(e, 'now'), /\| Runs that failed \| 0 \| 1 \|/);
  });
});
