import { createClient, type Client } from '@libsql/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate';
import { getFitCheckCountByHomeAndDate, logFitCheck } from './fit-checks';

let db: Client;

const log = (homeId: number, overrides: Partial<Parameters<typeof logFitCheck>[0]> = {}) =>
  logFitCheck({
    db,
    homeId,
    candidateText: 'pothos',
    speciesId: null,
    verdict: 'good_fit',
    responseJson: '{}',
    model: 'test-model',
    promptVersion: 'v-test',
    inputTokens: 100,
    outputTokens: 20,
    latencyMs: 250,
    guardrailFired: false,
    ...overrides,
  });

// Backdates every row of a home so it falls on another day.
const backdate = (homeId: number, modifier: string) =>
  db.execute({
    sql: `UPDATE fit_checks SET created_at = datetime(created_at, ?) WHERE home_id = ?`,
    args: [modifier, homeId],
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
});

describe('logFitCheck', () => {
  it('stores a check for a catalog-less candidate (null species)', async () => {
    await log(1);
    const { rows } = await db.execute('SELECT * FROM fit_checks');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      home_id: 1,
      species_id: null,
      verdict: 'good_fit',
      guardrail_fired: 0,
      input_tokens: 100,
    });
  });

  it('stores unknown token counts as NULL, not 0', async () => {
    await log(1, { inputTokens: undefined, outputTokens: null });
    const { rows } = await db.execute('SELECT input_tokens, output_tokens FROM fit_checks');
    expect(rows[0]).toMatchObject({ input_tokens: null, output_tokens: null });
  });

  it('stores guardrail_fired as 1', async () => {
    await log(1, { guardrailFired: true });
    const { rows } = await db.execute('SELECT guardrail_fired FROM fit_checks');
    expect(rows[0].guardrail_fired).toBe(1);
  });

  it('returns null instead of throwing when the insert fails', async () => {
    expect(await log(999)).toBeNull(); // no such home: foreign key violation
  });
});

describe('getFitCheckCountByHomeAndDate', () => {
  it('is 0 for a home with no checks', async () => {
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1 })).toBe(0);
  });

  it("counts today's checks for the home only", async () => {
    await log(1);
    await log(1);
    await log(2);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1 })).toBe(2);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 2 })).toBe(1);
  });

  it("does not count yesterday's checks as today's", async () => {
    await log(1);
    await backdate(1, '-1 day');
    await log(1);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1 })).toBe(1);
  });

  it('counts a given day when a date is passed', async () => {
    await log(1);
    await log(1);
    await backdate(1, '-1 day');
    await log(1);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1, date: yesterday })).toBe(2);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1, date: new Date() })).toBe(1);
  });

  it('reaches the quota of 20 and not before', async () => {
    for (let i = 0; i < 20; i++) await log(1);
    expect(await getFitCheckCountByHomeAndDate({ db, homeId: 1 })).toBe(20);
  });
});
