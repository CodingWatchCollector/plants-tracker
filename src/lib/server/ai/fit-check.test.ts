import { describe, expect, it } from 'vitest';
import type { HomeProfile, PlantSpecies } from '$lib/types';
import { applyFitCheckGuardrail, type AiFitCheckResponse } from './fit-check';

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

const response = (overrides: Partial<AiFitCheckResponse> = {}): AiFitCheckResponse => ({
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
      ['home has only kids', profile({ has_small_kids: true })],
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
