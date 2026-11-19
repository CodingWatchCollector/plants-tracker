import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '$lib/server/migrate';
import { GET, PUT } from './+server';

// The handlers get their DB from getDb(platform); here it is an in-memory database.
const dbHolder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('$lib/server/db', () => ({ getDb: () => dbHolder.db }));

let db: Client;

const asHome = (id: number | null) => (id === null ? undefined : { id, name: `home ${id}` });

const put = (body: unknown, homeId: number | null = 1) =>
  PUT({
    request: new Request('http://localhost/api/home/profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    locals: { home: asHome(homeId) },
    platform: undefined,
  } as unknown as Parameters<typeof PUT>[0]);

const get = async (homeId: number | null = 1) => {
  const res = await GET({
    locals: { home: asHome(homeId) },
    platform: undefined,
  } as unknown as Parameters<typeof GET>[0]);
  return res.json();
};

beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  dbHolder.db = db;
  await runMigrations(db);
  await db.execute(`INSERT INTO home (id, name, join_token) VALUES (1, 'home 1', 'token-1')`);
});

describe('PUT /api/home/profile', () => {
  it('saves a full profile and GET returns it', async () => {
    const res = await put({
      has_cats: true,
      has_dogs: false,
      has_small_kids: true,
      care_commitment: 'low',
      typical_light: 'bright',
      travels_often: true,
      notes: 'North-facing flat',
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(await get()).toMatchObject({
      home_id: 1,
      has_cats: true,
      has_dogs: false,
      has_small_kids: true,
      care_commitment: 'low',
      typical_light: 'bright',
      travels_often: true,
      notes: 'North-facing flat',
    });
  });

  it('leaves the fields it was not sent alone', async () => {
    await put({ has_cats: true, care_commitment: 'high', notes: 'keep me' });
    await put({ typical_light: 'low' });
    expect(await get()).toMatchObject({
      has_cats: true,
      care_commitment: 'high',
      typical_light: 'low',
      notes: 'keep me',
    });
  });

  it('accepts notes of exactly 500 characters', async () => {
    const notes = 'n'.repeat(500);
    await put({ notes });
    expect((await get()).notes).toBe(notes);
  });

  it.each([
    ['an unknown care_commitment', { care_commitment: 'extreme' }],
    ['a typical_light that is not an option', { typical_light: 'dark' }],
    ['a care_commitment on the light scale', { care_commitment: 'bright' }],
    ['a typical_light on the care scale', { typical_light: 'high' }],
    ['a string for has_cats', { has_cats: 'yes' }],
    ['a number for has_dogs', { has_dogs: 1 }],
    ['null for has_small_kids', { has_small_kids: null }],
    ['a string for travels_often', { travels_often: 'true' }],
    ['notes that are not a string', { notes: 123 }],
    ['notes over 500 characters', { notes: 'n'.repeat(501) }],
  ])('returns 400 for %s', async (_name, body) => {
    await expect(put(body)).rejects.toMatchObject({ status: 400 });
  });

  it('writes nothing when any field is invalid', async () => {
    await expect(put({ has_cats: true, care_commitment: 'extreme' })).rejects.toMatchObject({
      status: 400,
    });
    expect(await get()).toMatchObject({ has_cats: false, care_commitment: 'medium' });
    const { rows } = await db.execute('SELECT COUNT(*) AS n FROM home_profile');
    expect(Number(rows[0].n)).toBe(0);
  });

  it('returns 401 without a home', async () => {
    await expect(put({ has_cats: true }, null)).rejects.toMatchObject({ status: 401 });
  });
});

describe('GET /api/home/profile', () => {
  it('returns the defaults for a home with no profile yet', async () => {
    expect(await get()).toMatchObject({
      home_id: 1,
      has_cats: false,
      has_dogs: false,
      has_small_kids: false,
      care_commitment: 'medium',
      typical_light: 'medium',
      travels_often: false,
      notes: '',
      updated_at: null,
    });
  });

  it('returns 401 without a home', async () => {
    await expect(get(null)).rejects.toMatchObject({ status: 401 });
  });
});
