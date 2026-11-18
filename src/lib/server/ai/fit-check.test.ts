import type { OpenRouter } from '@openrouter/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FitCheckResponse, HomeProfile, PlantSpecies } from '$lib/types';
import { applyFitCheckGuardrail, evaluateFitCheck } from './fit-check';

const species = (overrides: Partial<PlantSpecies> = {}): PlantSpecies => ({
  id: 1,
  scientific_name: 'Epipremnum aureum',
  common_name: 'Pothos',
  aliases: [],
  watering_interval_days: 7,
  drought_tolerance: 'medium',
  care_level: 'low',
  light_needs: 'medium',
  toxic_to_cats: false,
  toxic_to_dogs: false,
  toxicity_notes: null,
  growth_habit: 'trailing',
  leaf_size: 'medium',
  leaf_shape: 'heart',
  variegated: false,
  care_tips: null,
  source: 'seed',
  source_url: null,
  reviewed_at: '2026-01-01',
  ...overrides,
});

const profile = (overrides: Partial<HomeProfile> = {}): HomeProfile => ({
  home_id: 1,
  has_cats: false,
  has_dogs: false,
  has_small_kids: false,
  care_commitment: 'medium',
  typical_light: 'medium',
  travels_often: false,
  notes: '',
  updated_at: null,
  ...overrides,
});

const response = (overrides: Partial<FitCheckResponse> = {}): FitCheckResponse => ({
  verdict: 'good_fit',
  summary: 'Looks fine.',
  reasons: [{ factor: 'care', detail: 'low maintenance' }],
  warnings: [],
  identified_as: null,
  ...overrides,
});

describe('applyFitCheckGuardrail', () => {
  it('leaves a non-catalog (string) candidate alone', () => {
    const r = response();
    const result = applyFitCheckGuardrail({
      response: r,
      candidate: 'mystery plant',
      homeProfile: profile({ has_cats: true }),
    });
    expect(result.response).toBe(r);
    expect(result.guardrailFired).toBe(false);
  });

  describe('plant toxic to a pet the home has', () => {
    const toxicToCats = species({ toxic_to_cats: true });
    const catHome = profile({ has_cats: true });

    it.each(['good_fit', 'caution', 'poor_fit'] as const)(
      'never ends in good_fit and always carries a toxicity warning (model said %s, no warning)',
      (verdict) => {
        const { response: out } = applyFitCheckGuardrail({
          response: response({ verdict }),
          candidate: toxicToCats,
          homeProfile: catHome,
        });
        expect(out.verdict).not.toBe('good_fit');
        expect(out.warnings.some((w) => /toxic/i.test(w) && /cats/i.test(w))).toBe(true);
      }
    );

    it('forces good_fit to poor_fit and adds the warning', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'good_fit' }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response.verdict).toBe('poor_fit');
      expect(result.response.warnings).toEqual(['Toxic to cats if ingested.']);
      expect(result.guardrailFired).toBe(true);
    });

    it('fires when only the verdict is wrong (warning already present)', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'good_fit', warnings: ['Toxic to cats if ingested'] }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response.verdict).toBe('poor_fit');
      expect(result.response.warnings).toEqual(['Toxic to cats if ingested']);
      expect(result.guardrailFired).toBe(true);
    });

    it('fires when only the warning is missing (verdict already caution)', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution' }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response.verdict).toBe('caution');
      expect(result.response.warnings).toEqual(['Toxic to cats if ingested.']);
      expect(result.guardrailFired).toBe(true);
    });

    it('does not fire when the model already got it right', () => {
      const r = response({ verdict: 'poor_fit', warnings: ['Toxic to cats'] });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });

    it('accepts a generic "pets" warning for either pet', () => {
      const r = response({ verdict: 'caution', warnings: ['Toxic to pets if chewed'] });
      expect(
        applyFitCheckGuardrail({ response: r, candidate: toxicToCats, homeProfile: catHome })
          .guardrailFired
      ).toBe(false);
      expect(
        applyFitCheckGuardrail({
          response: r,
          candidate: species({ toxic_to_dogs: true }),
          homeProfile: profile({ has_dogs: true }),
        }).guardrailFired
      ).toBe(false);
    });

    it('does not accept a negated warning as a toxicity warning', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: ['Not toxic to cats'] }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response.warnings).toEqual(['Not toxic to cats', 'Toxic to cats if ingested.']);
      expect(result.guardrailFired).toBe(true);
    });

    it('counts "Not safe for cats: toxic if ingested" as a cat warning', () => {
      const r = response({
        verdict: 'poor_fit',
        warnings: ['Not safe for cats: toxic if ingested'],
      });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });

    it.each(['Non-toxic to cats', 'Nontoxic to cats'])('does not count "%s"', (warning) => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: [warning] }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.guardrailFired).toBe(true);
    });

    it('does not accept a warning about the wrong pet', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: ['Toxic to dogs'] }),
        candidate: toxicToCats,
        homeProfile: catHome,
      });
      expect(result.response.warnings).toEqual(['Toxic to dogs', 'Toxic to cats if ingested.']);
    });

    it('adds a warning only for the pet that is missing one (cats and dogs)', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: ['Toxic to dogs'] }),
        candidate: species({ toxic_to_cats: true, toxic_to_dogs: true }),
        homeProfile: profile({ has_cats: true, has_dogs: true }),
      });
      expect(result.response.warnings).toEqual(['Toxic to dogs', 'Toxic to cats if ingested.']);
    });
  });

  describe('plant toxicity that does not concern this home', () => {
    it.each([
      ['home has no pets', profile()],
      ['home has only dogs, plant is toxic to cats only', profile({ has_dogs: true })],
    ])('does nothing when %s', (_name, homeProfile) => {
      const r = response({ verdict: 'good_fit' });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: species({ toxic_to_cats: true }),
        homeProfile,
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });

    it('does nothing for a non-toxic catalog plant in a home with pets', () => {
      const r = response({ verdict: 'good_fit' });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: species(),
        homeProfile: profile({ has_cats: true, has_dogs: true }),
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });
  });

  describe('small kids', () => {
    const kidsHome = profile({ has_small_kids: true });

    it('appends a children warning for a cat-toxic plant, without forcing the verdict', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'good_fit' }),
        candidate: species({ toxic_to_cats: true }),
        homeProfile: kidsHome,
      });
      expect(result.response.verdict).toBe('good_fit');
      expect(result.response.warnings).toEqual([
        'Toxic if eaten; keep out of reach of small children.',
      ]);
      expect(result.guardrailFired).toBe(true);
    });

    it('also applies to a dog-toxic plant', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution' }),
        candidate: species({ toxic_to_dogs: true }),
        homeProfile: kidsHome,
      });
      expect(result.response.warnings).toHaveLength(1);
      expect(result.guardrailFired).toBe(true);
    });

    it('leaves a warning that already names children alone', () => {
      const r = response({
        verdict: 'caution',
        warnings: ['Toxic to children and pets if eaten'],
      });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: species({ toxic_to_cats: true }),
        homeProfile: kidsHome,
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });

    it('does not accept a toxicity warning that never mentions children', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: ['Toxic to cats'] }),
        candidate: species({ toxic_to_cats: true }),
        homeProfile: kidsHome,
      });
      expect(result.response.warnings).toHaveLength(2);
      expect(result.guardrailFired).toBe(true);
    });

    it('does not accept a negated children warning', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution', warnings: ['Not toxic to children'] }),
        candidate: species({ toxic_to_cats: true }),
        homeProfile: kidsHome,
      });
      expect(result.guardrailFired).toBe(true);
    });

    it('does nothing for a non-toxic catalog plant', () => {
      const r = response({ verdict: 'good_fit' });
      const result = applyFitCheckGuardrail({
        response: r,
        candidate: species(),
        homeProfile: kidsHome,
      });
      expect(result.response).toBe(r);
      expect(result.guardrailFired).toBe(false);
    });

    it('adds both the pet and the children warning when the home has both', () => {
      const result = applyFitCheckGuardrail({
        response: response({ verdict: 'caution' }),
        candidate: species({ toxic_to_cats: true }),
        homeProfile: profile({ has_cats: true, has_small_kids: true }),
      });
      expect(result.response.warnings).toEqual([
        'Toxic to cats if ingested.',
        'Toxic if eaten; keep out of reach of small children.',
      ]);
    });
  });

  it('does not mutate its input', () => {
    const r = response({ verdict: 'good_fit', warnings: [] });
    const frozen = Object.freeze({
      ...r,
      warnings: Object.freeze([...r.warnings]) as string[],
    });
    const result = applyFitCheckGuardrail({
      response: frozen,
      candidate: species({ toxic_to_cats: true }),
      homeProfile: profile({ has_cats: true }),
    });
    expect(result.guardrailFired).toBe(true);
    expect(frozen.verdict).toBe('good_fit');
    expect(frozen.warnings).toEqual([]);
  });
});

describe('evaluateFitCheck', () => {
  const chatResult = (content: unknown, finishReason = 'stop', refusal: string | null = null) => ({
    choices: [
      {
        index: 0,
        finishReason,
        message: {
          role: 'assistant',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          refusal,
        },
      },
    ],
    usage: { promptTokens: 120, completionTokens: 30 },
  });
  const fakeClient = (send: ReturnType<typeof vi.fn>) =>
    ({ chat: { send } }) as unknown as OpenRouter;
  const evaluate = (send: ReturnType<typeof vi.fn>, candidate: PlantSpecies | string = 'x') =>
    evaluateFitCheck({
      client: fakeClient(send),
      model: 'some/model',
      homeProfile: profile(),
      ownedPlants: [],
      candidate,
    });

  it('sends the model slug it was given', async () => {
    const send = vi.fn().mockResolvedValue(chatResult(response()));
    await evaluate(send);
    expect(send.mock.calls[0][0].chatRequest.model).toBe('some/model');
  });

  it('keeps the raw answer next to the guarded one (cat home, cat-toxic candidate)', async () => {
    const send = vi.fn().mockResolvedValue(chatResult(response({ verdict: 'good_fit' })));
    const outcome = await evaluateFitCheck({
      client: fakeClient(send),
      model: 'm',
      homeProfile: profile({ has_cats: true }),
      ownedPlants: [],
      candidate: species({ toxic_to_cats: true }),
    });
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.rawResponse.verdict).toBe('good_fit');
    expect(outcome.rawResponse.warnings).toEqual([]);
    expect(outcome.response.verdict).toBe('poor_fit');
    expect(outcome.guardrailFired).toBe(true);
    expect(outcome.usage).toMatchObject({ inputTokens: 120, outputTokens: 30 });
  });

  it('puts the home notes from the profile into the message, escaped', async () => {
    const send = vi.fn().mockResolvedValue(chatResult(response()));
    await evaluateFitCheck({
      client: fakeClient(send),
      model: 'm',
      homeProfile: profile({ notes: 'a <b> c' }),
      ownedPlants: [],
      candidate: 'x',
    });
    const message = send.mock.calls[0][0].chatRequest.messages[1].content;
    expect(message).toContain('a &lt;b&gt; c');
  });

  it('reports a refusal with the token counts', async () => {
    const outcome = await evaluate(vi.fn().mockResolvedValue(chatResult('', 'stop', 'no')));
    expect(outcome).toMatchObject({
      ok: false,
      failure: 'refused',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('reports invalid content with the token counts and the content in the detail', async () => {
    const outcome = await evaluate(vi.fn().mockResolvedValue(chatResult('not json at all')));
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.failure).toBe('invalid_response');
    expect(outcome.detail).toContain('not json at all');
    expect(outcome.usage).toMatchObject({ inputTokens: 120, outputTokens: 30 });
  });

  it('caps the content in the detail at 1000 characters', async () => {
    const outcome = await evaluate(vi.fn().mockResolvedValue(chatResult('z'.repeat(5000))));
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.detail).toContain('z'.repeat(1000));
    expect(outcome.detail).not.toContain('z'.repeat(1001));
  });

  it('reports a truncated answer as invalid_response', async () => {
    const outcome = await evaluate(
      vi.fn().mockResolvedValue(chatResult('{"verdict":"g', 'length'))
    );
    expect(outcome).toMatchObject({ ok: false, failure: 'invalid_response' });
  });

  it('reports a failed request as provider_error with no usage', async () => {
    const outcome = await evaluate(vi.fn().mockRejectedValue(new Error('429 rate limited')));
    expect(outcome).toEqual({
      ok: false,
      failure: 'provider_error',
      detail: '429 rate limited',
      usage: null,
    });
  });
});
