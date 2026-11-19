import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '$lib/server/migrate';
import { GET } from './+server';

// The handler gets its DB from getDb(platform); here it is an in-memory database.
const dbHolder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('$lib/server/db', () => ({ getDb: () => dbHolder.db }));

let db: Client;

type Level = 'low' | 'medium' | 'high';
type Light = 'low' | 'medium' | 'bright';

const addSpecies = (
  scientific: string,
  common: string,
  care: Level,
  light: Light,
  aliases: string[] = []
) =>
  db.execute({
    sql: `INSERT INTO plant_species
      (scientific_name, common_name, aliases, watering_interval_days, drought_tolerance,
       care_level, light_needs, toxic_to_cats, toxic_to_dogs, growth_habit, leaf_size,
       leaf_shape, variegated, reviewed_at)
      VALUES (?, ?, ?, 7, 'medium', ?, ?, 0, 0, 'upright', 'medium', 'oval', 0, '2026-01-01')`,
    args: [scientific, common, JSON.stringify(aliases), care, light],
  });

const addPlant = (homeId: number, name: string) =>
  db.execute({
    sql: `INSERT INTO plants (home_id, name, watering_interval_days, next_watering_date)
          VALUES (?, ?, 7, '2026-12-01')`,
    args: [homeId, name],
  });

const suggest = async (homeId: number | null = 1) => {
  const res = await GET({
    locals: { home: homeId === null ? undefined : { id: homeId, name: `home ${homeId}` } },
    platform: undefined,
  } as unknown as Parameters<typeof GET>[0]);
  return res.json();
};

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  dbHolder.db = db;
  await runMigrations(db);
  for (const id of [1, 2]) {
    await db.execute({
      sql: `INSERT INTO home (id, name, join_token) VALUES (?, ?, ?)`,
      args: [id, `home ${id}`, `token-${id}`],
    });
  }
  await addSpecies('Dracaena trifasciata', 'Snake plant', 'low', 'low', ['sansevieria']);
  await addSpecies('Epipremnum aureum', 'Pothos', 'low', 'low', ["devil's ivy"]);
  await addSpecies('Monstera deliciosa', 'Swiss cheese plant', 'low', 'medium', ['monstera']);
  await addSpecies('Calathea orbifolia', 'Calathea', 'high', 'medium');
  await addSpecies('Echeveria elegans', 'Echeveria', 'low', 'bright');
  await addSpecies('Nephrolepis exaltata', 'Boston fern', 'high', 'medium');
});

describe('GET /api/home/profile/suggest', () => {
  it('suggests low care when every matched plant is low care', async () => {
    await addPlant(1, 'Snake plant');
    await addPlant(1, 'Pothos');
    await addPlant(1, 'Monstera deliciosa');
    expect(await suggest()).toMatchObject({ care_commitment: 'low' });
  });

  it('suggests nothing for a home with no matched plants', async () => {
    await addPlant(1, 'Mystery plant');
    expect(await suggest()).toEqual({
      care_commitment: null,
      typical_light: null,
      matched_plants: [],
    });
  });

  it('suggests nothing for a home with no plants at all', async () => {
    expect(await suggest()).toMatchObject({ care_commitment: null, matched_plants: [] });
  });

  it('uses the median care level', async () => {
    await addPlant(1, 'Snake plant'); // low
    await addPlant(1, 'Calathea'); // high
    await addPlant(1, 'Boston fern'); // high
    expect(await suggest()).toMatchObject({ care_commitment: 'high' });
  });

  it('rounds the median of an even number of plants up', async () => {
    await addPlant(1, 'Snake plant'); // low
    await addPlant(1, 'Calathea'); // high: (1 + 3) / 2 = 2
    expect(await suggest()).toMatchObject({ care_commitment: 'medium' });
  });

  it('suggests the most common light level', async () => {
    await addPlant(1, 'Snake plant'); // low
    await addPlant(1, 'Pothos'); // low
    await addPlant(1, 'Echeveria'); // bright
    expect(await suggest()).toMatchObject({ typical_light: 'low' });
  });

  it('matches by scientific name, common name and alias, ignoring case', async () => {
    await addPlant(1, 'DRACAENA TRIFASCIATA');
    await addPlant(1, 'pothos');
    await addPlant(1, "Devil's Ivy"); // alias of Pothos: the same species, listed once per name
    const result = await suggest();
    expect(result.matched_plants.map((p: { common_name: string }) => p.common_name).sort()).toEqual(
      ['Pothos', 'Pothos', 'Snake plant']
    );
  });

  it('lists each matched plant with its catalog care and light, and skips unmatched ones', async () => {
    await addPlant(1, 'Calathea');
    await addPlant(1, 'Mystery plant');
    expect((await suggest()).matched_plants).toEqual([
      {
        plant_name: 'Calathea',
        common_name: 'Calathea',
        care_level: 'high',
        light_needs: 'medium',
      },
    ]);
  });

  it('ignores the plants of other homes', async () => {
    await addPlant(1, 'Snake plant');
    await addPlant(2, 'Calathea');
    await addPlant(2, 'Boston fern');
    const result = await suggest(1);
    expect(result).toMatchObject({ care_commitment: 'low' });
    expect(result.matched_plants).toHaveLength(1);
  });

  it('returns 401 without a home', async () => {
    await expect(suggest(null)).rejects.toMatchObject({ status: 401 });
  });
});
