import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HomeProfile, PlantSpecies } from '$lib/types';
import { runMigrations } from '../migrate';
import { findSpeciesByName } from './catalog';
import { getAlternatives, SIMILARITY_WEIGHTS } from './alternatives';

let db: Client;

type Row = Partial<
  Pick<
    PlantSpecies,
    | 'care_level'
    | 'light_needs'
    | 'drought_tolerance'
    | 'growth_habit'
    | 'leaf_size'
    | 'leaf_shape'
    | 'variegated'
    | 'toxic_to_cats'
    | 'toxic_to_dogs'
  >
>;

// Defaults describe a plant that passes every filter and shares nothing with CANDIDATE_LOOK.
const addSpecies = async (name: string, row: Row = {}) => {
  const r = {
    care_level: 'low',
    light_needs: 'low',
    drought_tolerance: 'high',
    growth_habit: 'rosette',
    leaf_size: 'small',
    leaf_shape: 'needle',
    variegated: false,
    toxic_to_cats: false,
    toxic_to_dogs: false,
    ...row,
  };
  await db.execute({
    sql: `INSERT INTO plant_species
      (scientific_name, common_name, aliases, watering_interval_days, drought_tolerance,
       care_level, light_needs, toxic_to_cats, toxic_to_dogs, growth_habit, leaf_size,
       leaf_shape, variegated, reviewed_at)
      VALUES (?, ?, '[]', 7, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')`,
    args: [
      `${name} sp.`,
      name,
      r.drought_tolerance,
      r.care_level,
      r.light_needs,
      r.toxic_to_cats ? 1 : 0,
      r.toxic_to_dogs ? 1 : 0,
      r.growth_habit,
      r.leaf_size,
      r.leaf_shape,
      r.variegated ? 1 : 0,
    ],
  });
  return (await findSpeciesByName(db, name))!;
};

const home = (overrides: Partial<HomeProfile> = {}) => ({
  has_cats: false,
  has_dogs: false,
  care_commitment: 'high' as const,
  typical_light: 'bright' as const,
  travels_often: false,
  ...overrides,
});

const names = (alternatives: { species: PlantSpecies }[]) =>
  alternatives.map((a) => a.species.common_name);

let candidate: PlantSpecies;

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  candidate = await addSpecies('Candidate', {
    growth_habit: 'trailing',
    leaf_size: 'large',
    leaf_shape: 'heart',
    variegated: true,
    toxic_to_cats: true,
    toxic_to_dogs: true,
    care_level: 'high',
    light_needs: 'bright',
  });
});

describe('getAlternatives: hard filters', () => {
  it('never returns the candidate itself, nor species the home already owns', async () => {
    const owned = await addSpecies('Owned');
    await addSpecies('Free');
    const result = await getAlternatives({
      db,
      homeProfile: home(),
      candidate,
      excludeSpeciesIds: [owned.id],
    });
    expect(names(result)).toEqual(['Free']);
  });

  it.each([
    ['cats', { has_cats: true }, 'Toxic to cats'],
    ['dogs', { has_dogs: true }, 'Toxic to dogs'],
  ])('excludes plants toxic to the home’s %s', async (_pet, profile, toxicName) => {
    await addSpecies('Toxic to cats', { toxic_to_cats: true });
    await addSpecies('Toxic to dogs', { toxic_to_dogs: true });
    await addSpecies('Safe');
    const result = names(await getAlternatives({ db, homeProfile: home(profile), candidate }));
    expect(result).toContain('Safe');
    expect(result).not.toContain(toxicName);
    expect(result).toHaveLength(2); // Safe + the plant that is toxic only to the other pet
  });

  it('excludes anything toxic to either pet when the home has both', async () => {
    await addSpecies('Toxic to cats', { toxic_to_cats: true });
    await addSpecies('Toxic to dogs', { toxic_to_dogs: true });
    await addSpecies('Safe');
    const result = await getAlternatives({
      db,
      homeProfile: home({ has_cats: true, has_dogs: true }),
      candidate,
    });
    expect(names(result)).toEqual(['Safe']);
  });

  it('allows toxic plants when the home has no pets', async () => {
    await addSpecies('Toxic to cats', { toxic_to_cats: true });
    const result = await getAlternatives({ db, homeProfile: home(), candidate });
    expect(names(result)).toEqual(['Toxic to cats']);
  });

  it.each([
    ['low', ['Low care']],
    ['medium', ['Low care', 'Medium care']],
    ['high', ['High care', 'Low care', 'Medium care']],
  ] as const)(
    'care_commitment %s allows only plants needing that care or less',
    async (level, expected) => {
      await addSpecies('Low care', { care_level: 'low' });
      await addSpecies('Medium care', { care_level: 'medium' });
      await addSpecies('High care', { care_level: 'high' });
      const result = await getAlternatives({
        db,
        homeProfile: home({ care_commitment: level }),
        candidate,
      });
      expect(names(result).sort()).toEqual(expected);
    }
  );

  it.each([
    ['low', ['Low light']],
    ['medium', ['Low light', 'Medium light']],
    ['bright', ['Bright light', 'Low light', 'Medium light']],
  ] as const)(
    'typical_light %s allows only plants needing that light or less',
    async (light, expected) => {
      await addSpecies('Low light', { light_needs: 'low' });
      await addSpecies('Medium light', { light_needs: 'medium' });
      await addSpecies('Bright light', { light_needs: 'bright' });
      const result = await getAlternatives({
        db,
        homeProfile: home({ typical_light: light }),
        candidate,
      });
      expect(names(result).sort()).toEqual(expected);
    }
  );

  it('excludes low drought tolerance plants when the home travels often', async () => {
    await addSpecies('Thirsty', { drought_tolerance: 'low' });
    await addSpecies('Medium drought', { drought_tolerance: 'medium' });
    await addSpecies('Hardy', { drought_tolerance: 'high' });
    const travelling = await getAlternatives({
      db,
      homeProfile: home({ travels_often: true }),
      candidate,
    });
    expect(names(travelling).sort()).toEqual(['Hardy', 'Medium drought']);
    const home_ = await getAlternatives({ db, homeProfile: home(), candidate });
    expect(names(home_)).toContain('Thirsty');
  });

  // Acceptance criterion: alternatives never include a plant that fails the hard filters.
  it('never returns a plant failing any hard filter, for every home profile', async () => {
    const traits = ['low', 'medium', 'high'] as const;
    const light = ['low', 'medium', 'bright'] as const;
    let n = 0;
    for (const care_level of traits)
      for (const light_needs of light)
        for (const drought_tolerance of traits)
          for (const toxic_to_cats of [false, true])
            for (const toxic_to_dogs of [false, true])
              await addSpecies(`Plant ${n++}`, {
                care_level,
                light_needs,
                drought_tolerance,
                toxic_to_cats,
                toxic_to_dogs,
                // varying looks so similarity cannot be what keeps results safe
                growth_habit: n % 2 ? 'trailing' : 'upright',
                leaf_size: n % 3 ? 'large' : 'small',
              });

    let checked = 0;
    for (const has_cats of [false, true])
      for (const has_dogs of [false, true])
        for (const care_commitment of traits)
          for (const typical_light of light)
            for (const travels_often of [false, true]) {
              const profile = home({
                has_cats,
                has_dogs,
                care_commitment,
                typical_light,
                travels_often,
              });
              const result = await getAlternatives({
                db,
                homeProfile: profile,
                candidate,
                limit: 200,
              });
              for (const { species } of result) {
                checked++;
                expect(species.id).not.toBe(candidate.id);
                if (has_cats) expect(species.toxic_to_cats).toBe(false);
                if (has_dogs) expect(species.toxic_to_dogs).toBe(false);
                expect(traits.indexOf(species.care_level)).toBeLessThanOrEqual(
                  traits.indexOf(care_commitment)
                );
                expect(light.indexOf(species.light_needs)).toBeLessThanOrEqual(
                  light.indexOf(typical_light)
                );
                if (travels_often) expect(species.drought_tolerance).not.toBe('low');
              }
            }
    expect(checked).toBeGreaterThan(1000); // the loop really exercised many results
  });

  it('returns an empty list when nothing passes', async () => {
    await addSpecies('Needs care', { care_level: 'high' });
    const result = await getAlternatives({
      db,
      homeProfile: home({ care_commitment: 'low' }),
      candidate,
    });
    expect(result).toEqual([]);
  });
});

describe('getAlternatives: similarity and order', () => {
  it('weighs habit 3, leaf size 2, leaf shape 2, variegation 1 against the candidate', async () => {
    await addSpecies('None', {});
    await addSpecies('Habit', { growth_habit: 'trailing' });
    await addSpecies('Size', { leaf_size: 'large' });
    await addSpecies('Shape', { leaf_shape: 'HEART' }); // case-insensitive
    await addSpecies('Variegated', { variegated: true });
    await addSpecies('All', {
      growth_habit: 'trailing',
      leaf_size: 'large',
      leaf_shape: 'heart',
      variegated: true,
    });
    const result = await getAlternatives({ db, homeProfile: home(), candidate, limit: 10 });
    const score = Object.fromEntries(result.map((a) => [a.species.common_name, a.similarity]));
    expect(score).toEqual({
      None: 0,
      Habit: SIMILARITY_WEIGHTS.growth_habit,
      Size: SIMILARITY_WEIGHTS.leaf_size,
      Shape: SIMILARITY_WEIGHTS.leaf_shape,
      Variegated: SIMILARITY_WEIGHTS.variegated,
      All: 8,
    });
  });

  it('orders by similarity, then alphabetically', async () => {
    await addSpecies('Zebra', { growth_habit: 'trailing' }); // 3
    await addSpecies('Apple', { growth_habit: 'trailing' }); // 3
    await addSpecies('Mid', { leaf_size: 'large', leaf_shape: 'heart' }); // 4
    await addSpecies('Low', { variegated: true }); // 1
    const result = await getAlternatives({ db, homeProfile: home(), candidate, limit: 10 });
    expect(names(result)).toEqual(['Mid', 'Apple', 'Zebra', 'Low']);
  });

  it('returns the top 3 by default and honours a custom limit', async () => {
    for (let i = 0; i < 12; i++) await addSpecies(`Plant ${String(i).padStart(2, '0')}`);
    expect(await getAlternatives({ db, homeProfile: home(), candidate })).toHaveLength(3);
    expect(await getAlternatives({ db, homeProfile: home(), candidate, limit: 10 })).toHaveLength(
      10
    );
  });
});

describe('getAlternatives: explanation', () => {
  it('names what it shares with the candidate, pet safety and care level', async () => {
    await addSpecies('Twin', {
      growth_habit: 'trailing',
      leaf_shape: 'heart',
      variegated: true,
      care_level: 'low',
    });
    const [alt] = await getAlternatives({
      db,
      homeProfile: home({ has_cats: true, has_dogs: true }),
      candidate,
    });
    expect(alt.explanation).toBe(
      'Similar look to Candidate: trailing habit, heart leaf shape, variegated leaves. Non-toxic to cats and dogs. Low care.'
    );
  });

  it('says so when it shares nothing, and omits pet safety for a pet-free home', async () => {
    await addSpecies('Different');
    const [alt] = await getAlternatives({ db, homeProfile: home(), candidate });
    expect(alt.explanation).toBe('Looks different from Candidate, but suits your home. Low care.');
  });

  it('mentions only the pets the home has', async () => {
    await addSpecies('Safe');
    const [alt] = await getAlternatives({ db, homeProfile: home({ has_dogs: true }), candidate });
    expect(alt.explanation).toContain('Non-toxic to dogs.');
    expect(alt.explanation).not.toContain('cats');
  });
});
