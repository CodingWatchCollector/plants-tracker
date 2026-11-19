import type { OpenRouter } from '@openrouter/sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FitCheckOutcome } from '../../src/lib/server/ai/fit-check';
import type { Alternative } from '../../src/lib/server/queries/alternatives';
import type { FitCheckResponse, PlantSpecies } from '../../src/lib/types';
import {
  addAlternativesToResults,
  buildHomeProfile,
  buildResultsFile,
  evaluateAlternatives,
  executeAlternatives,
  executeCases,
  failingCases,
  formatAlternativesReport,
  formatReport,
  hardFilterViolations,
  parseCases,
  parseEvalArgs,
  percentile,
  runCost,
  runPool,
  scoreRun,
  summarize,
  summarizeAlternatives,
  type AlternativesRun,
  type EvalCase,
  type PreparedAlternatives,
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
      alternatives: false,
    });
  });

  it('reads the three flags', () => {
    expect(parseEvalArgs(['--model', 'x/y', '--runs', '5', '--case', 'a-case'], 'd')).toEqual({
      model: 'x/y',
      runs: 5,
      caseId: 'a-case',
      alternatives: false,
    });
  });

  it('reads --alternatives as a switch', () => {
    expect(parseEvalArgs(['--alternatives'], 'd').alternatives).toBe(true);
  });

  it('rejects a bad --runs and unknown flags', () => {
    expect(() => parseEvalArgs(['--runs', '0'], 'd')).toThrow(/positive integer/);
    expect(() => parseEvalArgs(['--runs', 'abc'], 'd')).toThrow(/positive integer/);
    expect(() => parseEvalArgs(['--bogus'], 'd')).toThrow();
  });
});

describe('alternatives comparison', () => {
  const plant = (id: number, overrides: Partial<PlantSpecies> = {}): PlantSpecies => ({
    id,
    scientific_name: `Plantus ${id}`,
    common_name: `Plant ${id}`,
    aliases: [],
    watering_interval_days: 7,
    drought_tolerance: 'medium',
    care_level: 'low',
    light_needs: 'low',
    toxic_to_cats: false,
    toxic_to_dogs: false,
    toxicity_notes: null,
    growth_habit: 'climbing',
    leaf_size: 'large',
    leaf_shape: 'lobed',
    variegated: false,
    care_tips: null,
    source: 'seed',
    source_url: null,
    reviewed_at: '2026-01-01',
    ...overrides,
  });
  const alt = (id: number, overrides: Partial<PlantSpecies> = {}, similarity = 7): Alternative => ({
    species: plant(id, overrides),
    similarity,
    explanation: `Templated ${id}.`,
  });
  const shortlistOf = (n: number) => Array.from({ length: n }, (_, i) => alt(i + 1));

  const candidate = plant(100);
  const profile = evalCase().profile; // a cat home, medium care, medium light
  const item = (shortlist: Alternative[], owned: PlantSpecies[] = []): PreparedAlternatives => {
    const c = evalCase();
    return {
      prepared: {
        case: c,
        homeProfile: buildHomeProfile(c),
        ownedPlants: owned.map((species) => ({ name: species.common_name, species })),
        candidate,
      },
      shortlist,
    };
  };

  const pickResult = (...ids: number[]) => ({
    choices: [
      {
        index: 0,
        finishReason: 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            picks: ids.map((species_id) => ({ species_id, reason: `Reason ${species_id}.` })),
          }),
          refusal: null,
        },
      },
    ],
    usage: { promptTokens: 900, completionTokens: 80 },
  });
  const fakeClient = (send: ReturnType<typeof vi.fn>) =>
    ({ chat: { send } }) as unknown as OpenRouter;
  const evaluate = (send: ReturnType<typeof vi.fn>, it: PreparedAlternatives) =>
    evaluateAlternatives({
      client: fakeClient(send),
      model: 'some/model',
      item: it,
      prices: PRICES,
    });

  describe('hardFilterViolations', () => {
    const check = (overrides: Partial<PlantSpecies>, p = profile, owned: number[] = []) =>
      hardFilterViolations(p, candidate, owned, alt(1, overrides));

    it('allows a safe plant that suits the home', () => {
      expect(check({})).toEqual([]);
    });

    it('flags the candidate and an owned plant', () => {
      expect(hardFilterViolations(profile, candidate, [], alt(100))).toEqual(['is the candidate']);
      expect(check({}, profile, [1])).toEqual(['already owned']);
    });

    it('flags toxicity for the pets the home has, and for small kids', () => {
      expect(check({ toxic_to_cats: true })).toEqual(['toxic to cats']);
      expect(check({ toxic_to_dogs: true })).toEqual([]); // a cat home only
      expect(check({ toxic_to_dogs: true }, { ...profile, has_dogs: true })).toEqual([
        'toxic to dogs',
      ]);
      expect(
        check({ toxic_to_dogs: true }, { ...profile, has_cats: false, has_small_kids: true })
      ).toEqual(['toxic (small kids)']);
    });

    it('flags care and light above what the home offers', () => {
      expect(check({ care_level: 'high' })).toEqual(['care level above commitment']);
      expect(check({ light_needs: 'bright' })).toEqual(['light needs above home light']);
      expect(check({ care_level: 'medium', light_needs: 'medium' })).toEqual([]);
    });

    it('flags low drought tolerance only for a home that travels', () => {
      expect(check({ drought_tolerance: 'low' })).toEqual([]);
      expect(check({ drought_tolerance: 'low' }, { ...profile, travels_often: true })).toEqual([
        'low drought tolerance for a home that travels',
      ]);
    });

    it('flags a similarity below the minimum', () => {
      expect(hardFilterViolations(profile, candidate, [], alt(1, {}, 2))).toEqual([
        'similarity below minimum',
      ]);
    });
  });

  describe('evaluateAlternatives', () => {
    it('compares the SQL top 3 with the model picks, using the same fallback rules', async () => {
      const send = vi.fn().mockResolvedValue(pickResult(4, 2));
      const run = await evaluate(send, item(shortlistOf(5)));
      expect(run.a).toMatchObject({ species_ids: [1, 2, 3], similarities: [7, 7, 7] });
      expect(run.b).toMatchObject({
        species_ids: [4, 2],
        rerank_called: true,
        fallback: false,
        failure: null,
        valid_picks: 2,
        invalid_picks: 0,
        input_tokens: 900,
        output_tokens: 80,
        violations: [],
      });
      expect(run.b.cost).toBeCloseTo(0.0013);
      expect(run.b.latency_ms).not.toBeNull();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('counts picks outside the shortlist as invalid', async () => {
      const run = await evaluate(
        vi.fn().mockResolvedValue(pickResult(99, 2, 3)),
        item(shortlistOf(5))
      );
      expect(run.b).toMatchObject({ species_ids: [2, 3], invalid_picks: 1, fallback: false });
    });

    it('falls back to the SQL top 3 when fewer than 2 picks are valid', async () => {
      const run = await evaluate(vi.fn().mockResolvedValue(pickResult(4)), item(shortlistOf(5)));
      expect(run.b).toMatchObject({ species_ids: [1, 2, 3], fallback: true, valid_picks: 1 });
    });

    it('falls back and records the failure when the re-rank call fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const run = await evaluate(
        vi.fn().mockRejectedValue(new Error('network down')),
        item(shortlistOf(5))
      );
      errorSpy.mockRestore();
      expect(run.b).toMatchObject({
        species_ids: [1, 2, 3],
        fallback: true,
        failure: 'provider_error',
        input_tokens: null,
        cost: null,
      });
    });

    it('makes no model call for a shortlist of 3 or fewer, and that is not a fallback', async () => {
      const send = vi.fn();
      const run = await evaluate(send, item(shortlistOf(3)));
      expect(send).not.toHaveBeenCalled();
      expect(run.b).toMatchObject({
        species_ids: [1, 2, 3],
        rerank_called: false,
        fallback: false,
        cost: null,
      });
    });

    it('records hard-filter violations in either stage', async () => {
      const list = [alt(1, { toxic_to_cats: true }), ...shortlistOf(5).slice(1)];
      const run = await evaluate(vi.fn().mockResolvedValue(pickResult(1, 2)), item(list));
      expect(run.a.violations).toEqual(['1: toxic to cats']);
      expect(run.b.violations).toEqual(['1: toxic to cats']);
    });

    it('flags a plant the home already owns', async () => {
      const run = await evaluate(
        vi.fn().mockResolvedValue(pickResult(2, 3)),
        item(shortlistOf(5), [plant(2)])
      );
      expect(run.b.violations).toEqual(['2: already owned']);
    });
  });

  describe('executeAlternatives', () => {
    it('runs each case the requested number of times and groups the runs', async () => {
      const send = vi.fn().mockResolvedValue(pickResult(4, 2));
      const results = await executeAlternatives({
        client: fakeClient(send),
        model: 'some/model',
        items: [item(shortlistOf(5)), item(shortlistOf(3))],
        runs: 3,
        concurrency: 4,
        prices: PRICES,
      });
      expect(results.map((r) => [r.id, r.shortlist_size, r.runs.length])).toEqual([
        ['a-case', 5, 3],
        ['a-case', 3, 3],
      ]);
      expect(send).toHaveBeenCalledTimes(3); // the short shortlist makes no call
    });
  });

  describe('summarizeAlternatives', () => {
    const modeRun = (ids: number[], similarity = 7, violations: string[] = []) => ({
      species_ids: ids,
      similarities: ids.map(() => similarity),
      violations,
    });
    const altRun = (
      b: Partial<AlternativesRun['b']> = {},
      a = modeRun([1, 2, 3])
    ): AlternativesRun => ({
      a,
      b: {
        ...modeRun([4, 2]),
        rerank_called: true,
        fallback: false,
        failure: null,
        valid_picks: 2,
        invalid_picks: 0,
        input_tokens: 1000,
        output_tokens: 100,
        latency_ms: 400,
        cost: 0.0015,
        ...b,
      },
    });

    it('reports per-mode counts, similarity and violations', () => {
      const s = summarizeAlternatives([
        altRun({}, modeRun([1, 2, 3], 6)),
        altRun({ ...modeRun([4, 2, 5], 8, ['4: toxic to cats']), valid_picks: 3 }),
      ]);
      expect(s.runs).toBe(2);
      expect(s.a).toEqual({ avg_alternatives: 3, mean_similarity: 6.5, hard_filter_violations: 0 });
      expect(s.b.avg_alternatives).toBe(2.5);
      expect(s.b.mean_similarity).toBeCloseTo(7.6);
      expect(s.b.hard_filter_violations).toBe(1);
    });

    it('reports invalid-pick, fallback and failure rates over the re-rank calls', () => {
      const s = summarizeAlternatives([
        altRun({ valid_picks: 2, invalid_picks: 1 }),
        altRun({ fallback: true, valid_picks: 1, invalid_picks: 1, ...modeRun([1, 2, 3]) }),
        altRun({ fallback: true, failure: 'refused', valid_picks: 0, ...modeRun([1, 2, 3]) }),
        altRun({
          rerank_called: false,
          input_tokens: null,
          output_tokens: null,
          latency_ms: null,
          cost: null,
        }),
      ]);
      expect(s.b.rerank_calls).toBe(3);
      expect(s.b.no_rerank_needed).toBe(1);
      expect(s.b.invalid_pick_rate).toBeCloseTo(2 / 5); // answered calls: 3 + 2 picks returned
      expect(s.b.fallback_rate).toBeCloseTo(2 / 3);
      expect(s.b.failures).toEqual({ refused: 1 });
    });

    it('averages the extra cost per call and per check, skipped checks counting as 0', () => {
      const s = summarizeAlternatives([
        altRun(),
        altRun({ input_tokens: 3000, output_tokens: 300, latency_ms: 800, cost: 0.0045 }),
        altRun({
          rerank_called: false,
          input_tokens: null,
          output_tokens: null,
          latency_ms: null,
          cost: null,
        }),
        altRun({
          rerank_called: false,
          input_tokens: null,
          output_tokens: null,
          latency_ms: null,
          cost: null,
        }),
      ]);
      expect(s.b.per_rerank_call).toEqual({
        input_tokens: 2000,
        output_tokens: 200,
        cost: 0.003,
        latency_ms: 600,
      });
      expect(s.b.per_check.input_tokens).toBe(1000);
      expect(s.b.per_check.output_tokens).toBe(100);
      expect(s.b.per_check.cost).toBeCloseTo(0.0015);
      expect(s.b.per_check.latency_ms).toBe(300);
    });

    it('has no cost when a called model has no price, and no rates when nothing was called', () => {
      const unpriced = summarizeAlternatives([altRun({ cost: null })]);
      expect(unpriced.b.per_check.cost).toBeNull();
      const none = summarizeAlternatives([
        altRun({
          rerank_called: false,
          input_tokens: null,
          output_tokens: null,
          latency_ms: null,
          cost: null,
        }),
      ]);
      expect(none.b.invalid_pick_rate).toBeNull();
      expect(none.b.fallback_rate).toBeNull();
      expect(none.b.per_check.cost).toBe(0);
      expect(none.b.per_rerank_call.cost).toBeNull();
    });
  });

  describe('formatAlternativesReport', () => {
    it('shows both modes, the B extras and the cases that were not compared', () => {
      const run: AlternativesRun = {
        a: { species_ids: [1, 2, 3], similarities: [7, 7, 7], violations: [] },
        b: {
          species_ids: [4, 2],
          similarities: [7, 7],
          violations: [],
          rerank_called: true,
          fallback: false,
          failure: null,
          valid_picks: 2,
          invalid_picks: 0,
          input_tokens: 1000,
          output_tokens: 100,
          latency_ms: 400,
          cost: 0.0015,
        },
      };
      const text = formatAlternativesReport('x/y', summarizeAlternatives([run]), ['injection-x']);
      expect(text).toContain('A (SQL top 3)');
      expect(text).toContain('B (re-rank)');
      expect(text).toMatch(/hard-filter violations\s+0\s+0/);
      expect(text).toContain('invalid-pick rate 0.0%, fallback rate 0.0%');
      expect(text).toContain('per check: 1000 in / 100 out tokens, $0.00150, 400 ms');
      expect(text).toContain('Not compared (candidate not in the catalog): injection-x');
    });
  });
});

describe('results file', () => {
  const summary = summarize([score(evalCase(), okOutcome())]);
  const cases = [{ id: 'a-case', runs: [score(evalCase(), okOutcome())] }];
  const fresh = { model: 'x/y', prompt_version: 'fit-check-v2', runs: 3, summary, cases };
  const alternatives = { runs: 3, summary: { runs: 48 }, cases: [], skipped_cases: [] };

  describe('buildResultsFile', () => {
    it('writes just the fit-check part when there is no earlier file', () => {
      const file = buildResultsFile(fresh, null);
      expect(Object.keys(file)).toEqual(['model', 'prompt_version', 'runs', 'summary', 'cases']);
    });

    it('keeps the alternatives comparison and its prompt version from the file it replaces', () => {
      const file = buildResultsFile(fresh, {
        prompt_version: 'fit-check-v1',
        rerank_prompt_version: 'rerank-v1',
        alternatives,
      });
      expect(file.prompt_version).toBe('fit-check-v2');
      expect(file.rerank_prompt_version).toBe('rerank-v1');
      expect(file.alternatives).toBe(alternatives);
      expect(Object.keys(file)).toEqual([
        'model',
        'prompt_version',
        'rerank_prompt_version',
        'runs',
        'summary',
        'cases',
        'alternatives',
      ]);
    });

    it('takes the fit-check numbers from the new run, not the old file', () => {
      const file = buildResultsFile(fresh, {
        runs: 99,
        summary: { ...summary, runs: 99 },
        cases: [],
        alternatives,
      });
      expect(file.runs).toBe(3);
      expect(file.summary).toBe(summary);
      expect(file.cases).toBe(cases);
    });

    it('does not invent an alternatives section the old file did not have', () => {
      const file = buildResultsFile(fresh, { prompt_version: 'fit-check-v1', runs: 3 });
      expect(file).not.toHaveProperty('alternatives');
      expect(file).not.toHaveProperty('rerank_prompt_version');
    });
  });

  describe('addAlternativesToResults', () => {
    const existing = { model: 'x/y', prompt_version: 'fit-check-v2', runs: 3, summary, cases };

    it('adds the comparison and the re-rank prompt version next to prompt_version', () => {
      const file = addAlternativesToResults(existing, 'rerank-v1', alternatives);
      expect(Object.keys(file)).toEqual([
        'model',
        'prompt_version',
        'rerank_prompt_version',
        'runs',
        'summary',
        'cases',
        'alternatives',
      ]);
      expect(file.alternatives).toBe(alternatives);
    });

    it('leaves the fit-check part exactly as it was', () => {
      const file = addAlternativesToResults(existing, 'rerank-v1', alternatives);
      expect(file).toMatchObject({ model: 'x/y', prompt_version: 'fit-check-v2', runs: 3 });
      expect(file.summary).toBe(summary);
      expect(file.cases).toBe(cases);
    });

    it('replaces an earlier comparison instead of stacking a second one', () => {
      const once = addAlternativesToResults(existing, 'rerank-v1', { old: true });
      const twice = addAlternativesToResults(once, 'rerank-v2', alternatives);
      expect(twice.alternatives).toBe(alternatives);
      expect(twice.rerank_prompt_version).toBe('rerank-v2');
      expect(Object.keys(twice).filter((k) => k === 'alternatives')).toHaveLength(1);
    });
  });
});
