import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate';
import {
  findSpeciesByName,
  getOwnedPlantsWithSpecies,
  getSpeciesById,
  searchSpecies,
} from './catalog';

let db: Client;

const addSpecies = (
  scientific_name: string,
  common_name: string,
  aliases: string[] = [],
  toxic_to_cats = 0
) =>
  db.execute({
    sql: `INSERT INTO plant_species
      (scientific_name, common_name, aliases, watering_interval_days, drought_tolerance,
       care_level, light_needs, toxic_to_cats, toxic_to_dogs, growth_habit, leaf_size,
       leaf_shape, variegated, reviewed_at)
      VALUES (?, ?, ?, 7, 'medium', 'low', 'medium', ?, 0, 'upright', 'medium', 'oval', 0, '2026-01-01')`,
    args: [scientific_name, common_name, JSON.stringify(aliases), toxic_to_cats],
  });

const addPlant = (homeId: number, name: string) =>
  db.execute({
    sql: `INSERT INTO plants (home_id, name, watering_interval_days, next_watering_date)
          VALUES (?, ?, 7, '2026-12-01')`,
    args: [homeId, name],
  });

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  for (const id of [1, 2]) {
    await db.execute({
      sql: `INSERT INTO home (id, name, join_token) VALUES (?, ?, ?)`,
      args: [id, `home ${id}`, `token-${id}`],
    });
  }
  await addSpecies('Monstera deliciosa', 'Swiss cheese plant', ['monstera', 'split-leaf'], 1);
  await addSpecies('Epipremnum aureum', 'Pothos', ['devil’s ivy']);
  await addSpecies('Ficus lyrata', 'Fiddle leaf fig', ['fiddle-leaf']);
});

describe('findSpeciesByName', () => {
  it.each([
    ['scientific name', 'Monstera deliciosa'],
    ['common name', 'swiss cheese plant'],
    ['alias', 'MONSTERA'],
    ['name with surrounding spaces', '  Monstera deliciosa  '],
  ])('matches by %s, ignoring case', async (_label, text) => {
    const species = await findSpeciesByName(db, text);
    expect(species?.scientific_name).toBe('Monstera deliciosa');
  });

  it('maps the row: booleans, aliases array, all fields', async () => {
    const species = await findSpeciesByName(db, 'monstera');
    expect(species).toMatchObject({
      aliases: ['monstera', 'split-leaf'],
      toxic_to_cats: true,
      toxic_to_dogs: false,
      variegated: false,
      watering_interval_days: 7,
    });
  });

  it('returns null for an unknown plant or blank text', async () => {
    expect(await findSpeciesByName(db, 'unobtainium')).toBeNull();
    expect(await findSpeciesByName(db, '   ')).toBeNull();
  });

  it('does not treat part of a name as a match', async () => {
    expect(await findSpeciesByName(db, 'monstera deli')).toBeNull();
  });

  it('is not tripped by quotes or LIKE wildcards in the input', async () => {
    expect(await findSpeciesByName(db, `'; DROP TABLE plant_species; --`)).toBeNull();
    expect(await findSpeciesByName(db, '%')).toBeNull();
  });
});

describe('searchSpecies', () => {
  it('finds species by a part of the common name, scientific name or alias', async () => {
    expect((await searchSpecies(db, 'cheese')).map((s) => s.common_name)).toEqual([
      'Swiss cheese plant',
    ]);
    expect((await searchSpecies(db, 'aureum')).map((s) => s.common_name)).toEqual(['Pothos']);
    expect((await searchSpecies(db, 'fiddle-')).map((s) => s.common_name)).toEqual([
      'Fiddle leaf fig',
    ]);
  });

  it('is case-insensitive', async () => {
    expect(await searchSpecies(db, 'POTHOS')).toHaveLength(1);
  });

  it('puts names that start with the text before names that only contain it', async () => {
    // Alphabetically "Fiddle leaf fig" < "Fig test", so only the prefix rule puts Fig test first.
    await addSpecies('Figus testus', 'Fig test');
    const names = (await searchSpecies(db, 'fig')).map((s) => s.common_name);
    expect(names).toEqual(['Fig test', 'Fiddle leaf fig']);
  });

  it('respects the limit', async () => {
    expect(await searchSpecies(db, 'i', 2)).toHaveLength(2);
  });

  it('returns nothing for blank text', async () => {
    expect(await searchSpecies(db, '')).toEqual([]);
    expect(await searchSpecies(db, '   ')).toEqual([]);
  });

  it('matches LIKE wildcards literally', async () => {
    expect(await searchSpecies(db, '%')).toEqual([]);
    expect(await searchSpecies(db, '_')).toEqual([]);
  });
});

describe('getOwnedPlantsWithSpecies', () => {
  it('returns each plant with its catalog row, or null when unmatched', async () => {
    await addPlant(1, 'monstera');
    await addPlant(1, 'Pothos');
    await addPlant(1, 'Grandma’s mystery cactus');
    const owned = await getOwnedPlantsWithSpecies(db, 1);
    expect(owned.map((o) => [o.name, o.species?.scientific_name ?? null])).toEqual([
      ['monstera', 'Monstera deliciosa'],
      ['Pothos', 'Epipremnum aureum'],
      ['Grandma’s mystery cactus', null],
    ]);
    expect(owned[0].species?.toxic_to_cats).toBe(true);
  });

  it('returns only the given home’s plants', async () => {
    await addPlant(1, 'Pothos');
    await addPlant(2, 'monstera');
    expect((await getOwnedPlantsWithSpecies(db, 1)).map((o) => o.name)).toEqual(['Pothos']);
  });

  it('returns an empty list for a home without plants', async () => {
    expect(await getOwnedPlantsWithSpecies(db, 1)).toEqual([]);
  });

  it('does not duplicate a plant when several species rows match its name', async () => {
    await addSpecies('Monstera adansonii', 'Swiss cheese vine', ['monstera']);
    await addPlant(1, 'monstera');
    const owned = await getOwnedPlantsWithSpecies(db, 1);
    expect(owned).toHaveLength(1);
    expect(owned[0].species?.scientific_name).toBe('Monstera deliciosa'); // lowest id wins
  });
});

describe('getSpeciesById', () => {
  it('returns the species with that id', async () => {
    const pothos = await findSpeciesByName(db, 'pothos');
    const species = await getSpeciesById(db, pothos!.id);
    expect(species).toMatchObject({
      id: pothos!.id,
      common_name: 'Pothos',
      scientific_name: 'Epipremnum aureum',
      watering_interval_days: 7,
    });
  });

  it('returns null for an id that does not exist', async () => {
    expect(await getSpeciesById(db, 9999)).toBeNull();
  });
});
