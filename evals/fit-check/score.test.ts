import type { OpenRouter } from '@openrouter/sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FitCheckOutcome } from '../../src/lib/server/ai/fit-check';
import type { FitCheckResponse, PlantSpecies } from '../../src/lib/types';
import {
  buildHomeProfile,
  executeCases,
  failingCases,
  formatReport,
  parseCases,
  parseEvalArgs,
  percentile,
  runCost,
  runPool,
  scoreRun,
  summarize,
  type EvalCase,
  type PreparedCase,
  type Prices,
  type RunScore,
} from './score';

const PRICES: Prices = { 'some/model': { input: 1, output: 5 } };

const evalCase = (overrides: Partial<EvalCase> = {}): EvalCase => ({
  id: 'a-case',
  description: 'a case',
  profile: {
    has_cats: true,
    has_dogs: false,
    has_small_kids: false,
    care_commitment: 'medium',
    typical_light: 'medium',
    travels_often: false,
    notes: '',
  },
  owned: [],
  candidate: 'Pothos',
  expected_verdict: 'poor_fit',
  required_warnings: ['cats'],
  expected_data_source: 'catalog',
  ...overrides,
});

const response = (overrides: Partial<FitCheckResponse> = {}): FitCheckResponse => ({
  verdict: 'poor_fit',
  summary: 'ok',
  reasons: [],
  warnings: ['Toxic to cats if eaten.'],
  identified_as: null,
  ...overrides,
});

const usage = { inputTokens: 2000, outputTokens: 500, latencyMs: 800 };

const okOutcome = (
  final: Partial<FitCheckResponse> = {},
  raw: Partial<FitCheckResponse> = final,
  guardrailFired = false
): FitCheckOutcome => ({
  ok: true,
  response: response(final),
  rawResponse: response(raw),
  guardrailFired,
  usage,
});

const score = (c: EvalCase, outcome: FitCheckOutcome) => scoreRun(c, outcome, 'some/model', PRICES);

describe('parseCases', () => {
  it('accepts the committed cases file', () => {
    const json = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
    expect(parseCases(json)).toHaveLength(20);
  });

  it('rejects a repeated id', () => {
    expect(() => parseCases([evalCase(), evalCase()])).toThrow(/duplicate case id: a-case/);
  });

  it('rejects an unknown key, so a typo does not pass silently', () => {
    expect(() => parseCases([{ ...evalCase(), expected_verdits: 'good_fit' }])).toThrow();
  });

  it('rejects an empty verdict list and an unknown warning', () => {
    expect(() => parseCases([evalCase({ expected_verdict: [] })])).toThrow();
    expect(() =>
      parseCases([evalCase({ required_warnings: ['pets' as unknown as 'cats'] })])
    ).toThrow();
  });
});

describe('buildHomeProfile', () => {
  it('uses home_id 0 and no updated_at', () => {
    expect(buildHomeProfile(evalCase())).toMatchObject({
      home_id: 0,
      updated_at: null,
      has_cats: true,
      notes: '',
    });
  });
});

describe('runCost', () => {
  it('prices tokens per million', () => {
    expect(runCost(PRICES, 'some/model', 3000, 600)).toBeCloseTo(0.006);
  });

  it('is null for an unknown model or missing token counts', () => {
    expect(runCost(PRICES, 'other/model', 3000, 600)).toBeNull();
    expect(runCost(PRICES, 'some/model', null, 600)).toBeNull();
  });
});

describe('scoreRun', () => {
  it('passes a correct answer', () => {
    const run = score(evalCase(), okOutcome());
    expect(run).toMatchObject({
      schema_ok: true,
      failure: null,
      verdict: 'poor_fit',
      verdict_ok: true,
      warnings_ok_final: true,
      warnings_ok_raw: true,
      guardrail_fired: false,
      input_tokens: 2000,
      output_tokens: 500,
      latency_ms: 800,
    });
    expect(run.cost).toBeCloseTo(0.0045);
  });

  it('accepts any verdict in an expected list', () => {
    const c = evalCase({ expected_verdict: ['caution', 'poor_fit'] });
    expect(score(c, okOutcome({ verdict: 'caution' })).verdict_ok).toBe(true);
    expect(score(c, okOutcome({ verdict: 'good_fit' })).verdict_ok).toBe(false);
  });

  it('scores the guarded verdict and keeps the raw one', () => {
    // The model said good_fit with no warning; the guardrail forced poor_fit and added one.
    const run = score(
      evalCase(),
      okOutcome(
        { verdict: 'poor_fit', warnings: ['Toxic to cats if ingested.'] },
        { verdict: 'good_fit', warnings: [] },
        true
      )
    );
    expect(run.verdict).toBe('poor_fit');
    expect(run.raw_verdict).toBe('good_fit');
    expect(run.verdict_ok).toBe(true);
    expect(run.warnings_ok_final).toBe(true);
    expect(run.warnings_ok_raw).toBe(false);
    expect(run.guardrail_fired).toBe(true);
  });

  it('uses the guardrail matcher: a negated warning does not count', () => {
    const run = score(evalCase(), okOutcome({ warnings: ['Non-toxic to cats.'] }));
    expect(run.warnings_ok_final).toBe(false);
  });

  it('needs every required warning', () => {
    const c = evalCase({ required_warnings: ['cats', 'dogs'] });
    expect(score(c, okOutcome({ warnings: ['Toxic to cats.'] })).warnings_ok_final).toBe(false);
    expect(
      score(c, okOutcome({ warnings: ['Toxic to cats.', 'Poisonous to dogs.'] })).warnings_ok_final
    ).toBe(true);
  });

  it('passes the warning checks when none are required', () => {
    const run = score(evalCase({ required_warnings: [] }), okOutcome({ warnings: [] }));
    expect(run.warnings_ok_final).toBe(true);
    expect(run.warnings_ok_raw).toBe(true);
  });

  it('fails every check for a failed run but keeps failure, tokens and latency', () => {
    const run = score(evalCase({ required_warnings: [] }), {
      ok: false,
      failure: 'invalid_response',
      detail: 'schema mismatch',
      usage,
    });
    expect(run).toMatchObject({
      schema_ok: false,
      failure: 'invalid_response',
      detail: 'schema mismatch',
      verdict_ok: false,
      warnings_ok_final: false,
      warnings_ok_raw: false,
      input_tokens: 2000,
      latency_ms: 800,
    });
  });

  it('has no tokens or latency when the provider never answered', () => {
    const run = score(evalCase(), {
      ok: false,
      failure: 'provider_error',
      detail: 'network',
      usage: null,
    });
    expect(run).toMatchObject({ input_tokens: null, latency_ms: null, cost: null });
  });
});

describe('percentile', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('uses nearest rank', () => {
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
  });

  it('does not depend on input order', () => {
    expect(percentile([...values].reverse(), 50)).toBe(50);
  });

  it('is null without values', () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summarize', () => {
  const run = (overrides: Partial<RunScore> = {}): RunScore => ({
    ...score(evalCase(), okOutcome()),
    ...overrides,
  });

  it('uses all runs as the denominator, failed runs included', () => {
    const failed = score(evalCase(), {
      ok: false,
      failure: 'refused',
      detail: 'no',
      usage: null,
    });
    const s = summarize([run(), run(), run({ verdict_ok: false }), failed]);
    expect(s.runs).toBe(4);
    expect(s.schema_pass_rate).toBe(0.75);
    expect(s.verdict_pass_rate).toBe(0.5);
    expect(s.warnings_final_pass_rate).toBe(0.75);
    expect(s.failures).toEqual({ refused: 1 });
  });

  it('computes the guardrail fire rate, averages and percentiles over what is known', () => {
    const s = summarize([
      run({ guardrail_fired: true, latency_ms: 100, input_tokens: 1000, output_tokens: 200 }),
      run({ latency_ms: 300, input_tokens: 3000, output_tokens: 400 }),
    ]);
    expect(s.guardrail_fire_rate).toBe(0.5);
    expect(s.avg_input_tokens).toBe(2000);
    expect(s.avg_output_tokens).toBe(300);
    expect(s.latency_p50_ms).toBe(100);
    expect(s.latency_p95_ms).toBe(300);
  });

  it('reports n/a-able nulls when nothing has a cost or latency', () => {
    const s = summarize([run({ cost: null, latency_ms: null })]);
    expect(s.avg_cost).toBeNull();
    expect(s.latency_p50_ms).toBeNull();
  });
});

describe('failingCases and formatReport', () => {
  const c = evalCase();
  const good = score(c, okOutcome());
  const wrong = score(c, okOutcome({ verdict: 'good_fit' }));

  it('lists a case when any run fails, with expected and actual verdicts', () => {
    const failing = failingCases(
      [c, evalCase({ id: 'other' })],
      [
        { id: 'a-case', runs: [good, wrong, good] },
        { id: 'other', runs: [good, good, good] },
      ]
    );
    expect(failing).toEqual([
      {
        id: 'a-case',
        expected: ['poor_fit'],
        required_warnings: ['cats'],
        got: ['poor_fit', 'good_fit', 'poor_fit'],
        failed_runs: 1,
        runs: 3,
      },
    ]);
  });

  it('does not list a case whose only miss is a raw warning', () => {
    const guarded = score(c, okOutcome({}, { warnings: [] }, true));
    expect(failingCases([c], [{ id: 'a-case', runs: [guarded] }])).toEqual([]);
  });

  it('prints n/a for an unknown cost and names the failing case', () => {
    const s = summarize([{ ...wrong, cost: null }]);
    const text = formatReport('x/y', s, failingCases([c], [{ id: 'a-case', runs: [wrong] }]));
    expect(text).toMatch(/avg cost per check\s+n\/a/);
    expect(text).toContain('a-case: expected poor_fit');
  });
});

describe('runPool', () => {
  it('keeps order and never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 * (8 - n)));
      inFlight--;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await runPool([], 4, async (n) => n)).toEqual([]);
  });
});

describe('executeCases', () => {
  const catToxic: PlantSpecies = {
    id: 1,
    scientific_name: 'Epipremnum aureum',
    common_name: 'Pothos',
    aliases: [],
    watering_interval_days: 7,
    drought_tolerance: 'high',
    care_level: 'low',
    light_needs: 'low',
    toxic_to_cats: true,
    toxic_to_dogs: true,
    toxicity_notes: null,
    growth_habit: 'trailing',
    leaf_size: 'medium',
    leaf_shape: 'heart',
    variegated: false,
    care_tips: null,
    source: 'seed',
    source_url: null,
    reviewed_at: '2026-01-01',
  };

  const prepared = (id: string, candidate: PlantSpecies | string): PreparedCase => {
    const c = evalCase({ id });
    return { case: c, homeProfile: buildHomeProfile(c), ownedPlants: [], candidate };
  };

  const chatResult = (content: FitCheckResponse) => ({
    choices: [
      {
        index: 0,
        finishReason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(content), refusal: null },
      },
    ],
    usage: { promptTokens: 2000, completionTokens: 500 },
  });
  const fakeClient = (send: ReturnType<typeof vi.fn>) =>
    ({ chat: { send } }) as unknown as OpenRouter;

  it('runs every case the requested number of times and groups the scores per case', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(chatResult(response({ verdict: 'good_fit', warnings: [] })));
    const results = await executeCases({
      client: fakeClient(send),
      model: 'some/model',
      cases: [prepared('first', catToxic), prepared('second', catToxic)],
      runs: 3,
      concurrency: 4,
      prices: PRICES,
    });
    expect(send).toHaveBeenCalledTimes(6);
    expect(send.mock.calls[0][0].chatRequest.model).toBe('some/model');
    expect(results.map((r) => [r.id, r.runs.length])).toEqual([
      ['first', 3],
      ['second', 3],
    ]);
    // The guardrail turns the model's good_fit into poor_fit for a cat home; the raw answer stays.
    for (const run of results.flatMap((r) => r.runs)) {
      expect(run).toMatchObject({
        verdict: 'poor_fit',
        raw_verdict: 'good_fit',
        verdict_ok: true,
        warnings_ok_final: true,
        warnings_ok_raw: false,
        guardrail_fired: true,
      });
    }
  });

  it('scores a provider error as a failed run instead of throwing', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const results = await executeCases({
      client: fakeClient(send),
      model: 'some/model',
      cases: [prepared('only', 'Mystery plant')],
      runs: 2,
      concurrency: 4,
      prices: PRICES,
    });
    errorSpy.mockRestore();
    expect(results[0].runs).toHaveLength(2);
    expect(results[0].runs[0]).toMatchObject({
      schema_ok: false,
      failure: 'provider_error',
      cost: null,
    });
  });
});

describe('parseEvalArgs', () => {
  it('has defaults', () => {
    expect(parseEvalArgs([], 'default/model')).toEqual({
      model: 'default/model',
      runs: 3,
      caseId: null,
    });
  });

  it('reads the three flags', () => {
    expect(parseEvalArgs(['--model', 'x/y', '--runs', '5', '--case', 'a-case'], 'd')).toEqual({
      model: 'x/y',
      runs: 5,
      caseId: 'a-case',
    });
  });

  it('rejects a bad --runs and unknown flags (--alternatives waits for step 19)', () => {
    expect(() => parseEvalArgs(['--runs', '0'], 'd')).toThrow(/positive integer/);
    expect(() => parseEvalArgs(['--runs', 'abc'], 'd')).toThrow(/positive integer/);
    expect(() => parseEvalArgs(['--alternatives'], 'd')).toThrow();
  });
});
