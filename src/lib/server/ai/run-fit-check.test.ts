import { createClient, type Client } from '@libsql/client';
import type { OpenRouter } from '@openrouter/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../migrate';
import type { AiFitCheckResponse } from './fit-check';
import {
  DAILY_FIT_CHECK_LIMIT,
  MAX_CANDIDATE_LENGTH,
  normalizeCandidate,
  runFitCheck,
} from './run-fit-check';

// Lets one test make the alternatives lookup fail while everything else stays real.
const alternativesControl = vi.hoisted(() => ({ fail: false }));
vi.mock('../queries/alternatives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queries/alternatives')>();
  return {
    ...actual,
    getAlternatives: (...args: Parameters<typeof actual.getAlternatives>) => {
      if (alternativesControl.fail) throw new Error('alternatives down');
      return actual.getAlternatives(...args);
    },
  };
});

let db: Client;

const modelAnswer = (overrides: Partial<AiFitCheckResponse> = {}): AiFitCheckResponse => ({
  verdict: 'good_fit',
  summary: 'Looks fine.',
  reasons: [{ factor: 'care', detail: 'low maintenance' }],
  warnings: [],
  identified_as: null,
  ...overrides,
});

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

const clientReturning = (result: unknown) => fakeClient(vi.fn().mockResolvedValue(result));

const sentUserMessage = (send: ReturnType<typeof vi.fn>): string =>
  send.mock.calls[0][0].chatRequest.messages.find((m: { role: string }) => m.role === 'user')
    .content;

const fitCheckRows = async () => (await db.execute('SELECT * FROM fit_checks')).rows;

const addSpecies = (name: string, toxicToCats = 0) =>
  db.execute({
    sql: `INSERT INTO plant_species
      (scientific_name, common_name, aliases, watering_interval_days, drought_tolerance,
       care_level, light_needs, toxic_to_cats, toxic_to_dogs, growth_habit, leaf_size,
       leaf_shape, variegated, reviewed_at)
      VALUES (?, ?, '[]', 7, 'medium', 'low', 'low', ?, 0, 'climbing', 'large', 'lobed', 0, '2026-01-01')`,
    args: [`${name} sp.`, name, toxicToCats],
  });

beforeEach(async () => {
  alternativesControl.fail = false;
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  for (const id of [1, 2]) {
    await db.execute({
      sql: `INSERT INTO home (id, name, join_token) VALUES (?, ?, ?)`,
      args: [id, `home ${id}`, `token-${id}`],
    });
  }
  await db.execute(`INSERT INTO plant_species
    (scientific_name, common_name, aliases, watering_interval_days, drought_tolerance,
     care_level, light_needs, toxic_to_cats, toxic_to_dogs, growth_habit, leaf_size,
     leaf_shape, variegated, reviewed_at)
    VALUES ('Monstera deliciosa', 'Swiss cheese plant', '["monstera"]', 7, 'medium',
     'low', 'medium', 1, 0, 'climbing', 'large', 'lobed', 0, '2026-01-01')`);
  // home 1 has a cat and a note; home 2 has nothing set
  await db.execute(
    `INSERT INTO home_profile (home_id, has_cats, notes) VALUES (1, 1, 'Sunny <flat> by the sea')`
  );
});

describe('normalizeCandidate', () => {
  it('trims the text', () => {
    expect(normalizeCandidate('  monstera  ')).toBe('monstera');
  });

  it(`caps it at ${MAX_CANDIDATE_LENGTH} characters`, () => {
    expect(normalizeCandidate('a'.repeat(250))).toHaveLength(MAX_CANDIDATE_LENGTH);
  });

  it.each([undefined, null, 42, {}, [], '', '   '])('rejects %j', (raw) => {
    expect(normalizeCandidate(raw)).toBeNull();
  });
});

describe('runFitCheck', () => {
  describe('catalog candidate', () => {
    it('returns the model answer plus data_source and species_id set in code', async () => {
      const send = vi.fn().mockResolvedValue(chatResult(modelAnswer()));
      const result = await runFitCheck({
        db,
        client: fakeClient(send),
        homeId: 2,
        candidateText: 'MONSTERA',
      });
      expect(result).toMatchObject({
        status: 'ok',
        body: { verdict: 'good_fit', data_source: 'catalog', species_id: 1 },
      });
    });

    it('applies the guardrail: cat home, toxic plant, model says good_fit', async () => {
      const result = await runFitCheck({
        db,
        client: clientReturning(chatResult(modelAnswer({ verdict: 'good_fit' }))),
        homeId: 1,
        candidateText: 'monstera',
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.body.verdict).toBe('poor_fit');
      expect(result.body.warnings.some((w) => /toxic.*cats/i.test(w))).toBe(true);
    });

    it('logs the check with the species, the typed text, tokens and the guardrail flag', async () => {
      await runFitCheck({
        db,
        client: clientReturning(chatResult(modelAnswer())),
        homeId: 1,
        candidateText: 'monstera',
      });
      const rows = await fitCheckRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        home_id: 1,
        candidate_text: 'monstera',
        species_id: 1,
        verdict: 'poor_fit', // the guardrailed verdict, not the model's
        input_tokens: 120,
        output_tokens: 30,
        guardrail_fired: 1,
      });
    });

    it('sends the catalog row, the profile and the escaped notes to the model', async () => {
      const send = vi.fn().mockResolvedValue(chatResult(modelAnswer()));
      await runFitCheck({ db, client: fakeClient(send), homeId: 1, candidateText: 'monstera' });
      const message = sentUserMessage(send);
      expect(message).toContain('<CATALOG>');
      expect(message).toContain('"scientific_name":"Monstera deliciosa"');
      expect(message).toContain('"has_cats":true');
      expect(message).toContain('Sunny &lt;flat&gt; by the sea');
      expect(message).not.toContain('<flat>');
    });

    it('includes the home’s owned plants, with catalog data when matched', async () => {
      await db.execute(
        `INSERT INTO plants (home_id, name, watering_interval_days, next_watering_date)
         VALUES (1, 'Monstera', 7, '2026-12-01'), (1, 'Mystery cactus', 14, '2026-12-01')`
      );
      const send = vi.fn().mockResolvedValue(chatResult(modelAnswer()));
      await runFitCheck({ db, client: fakeClient(send), homeId: 1, candidateText: 'pothos' });
      const message = sentUserMessage(send);
      expect(message).toMatch(/"name":"Monstera","catalog":\{/);
      expect(message).toContain('{"name":"Mystery cactus"}');
    });
  });

  describe('alternatives', () => {
    const run = (client = clientReturning(chatResult(modelAnswer())), candidateText = 'monstera') =>
      runFitCheck({ db, client, homeId: 1, candidateText });

    it('suggests look-alikes that are safe for the home’s pets, never the candidate', async () => {
      await addSpecies('Safe vine');
      await addSpecies('Toxic vine', 1);
      const result = await run();
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.body.alternatives).toEqual([
        {
          species_id: expect.any(Number),
          common_name: 'Safe vine',
          scientific_name: 'Safe vine sp.',
          explanation: expect.stringContaining('Non-toxic to cats'),
        },
      ]);
      expect(result.body.alternatives[0].species_id).not.toBe(result.body.species_id);
    });

    it('does not suggest species the home already owns', async () => {
      await addSpecies('Owned vine');
      await addSpecies('Other vine');
      await db.execute(
        `INSERT INTO plants (home_id, name, watering_interval_days, next_watering_date)
         VALUES (1, 'owned vine', 7, '2026-12-01')`
      );
      const result = await run();
      if (result.status !== 'ok') throw new Error('expected ok');
      expect(result.body.alternatives.map((a) => a.common_name)).toEqual(['Other vine']);
    });

    it('is empty for a candidate missing from the catalog', async () => {
      await addSpecies('Safe vine');
      const result = await run(undefined, 'fiddle leaf fig');
      if (result.status !== 'ok') throw new Error('expected ok');
      expect(result.body.alternatives).toEqual([]);
    });

    it('does not fail the check when the alternatives lookup fails', async () => {
      await addSpecies('Safe vine');
      alternativesControl.fail = true;
      const result = await run();
      expect(result).toMatchObject({ status: 'ok', body: { alternatives: [] } });
      expect(await fitCheckRows()).toHaveLength(1); // the paid-for answer is still logged
    });
  });

  describe('candidate missing from the catalog', () => {
    it('is marked model_knowledge with no species_id and sent as "not in catalog"', async () => {
      const send = vi
        .fn()
        .mockResolvedValue(chatResult(modelAnswer({ identified_as: 'Ficus lyrata' })));
      const result = await runFitCheck({
        db,
        client: fakeClient(send),
        homeId: 1,
        candidateText: 'fiddle leaf fig',
      });
      expect(result).toMatchObject({
        status: 'ok',
        body: { data_source: 'model_knowledge', species_id: null, identified_as: 'Ficus lyrata' },
      });
      expect(sentUserMessage(send)).toContain('(not in catalog)');
      expect((await fitCheckRows())[0]).toMatchObject({ species_id: null, guardrail_fired: 0 });
    });
  });

  describe('daily quota', () => {
    const logChecks = async (homeId: number, count: number) => {
      for (let i = 0; i < count; i++) {
        await db.execute({
          sql: `INSERT INTO fit_checks (home_id, candidate_text, verdict, response_json, model, prompt_version)
                VALUES (?, 'x', 'good_fit', '{}', 'm', 'v')`,
          args: [homeId],
        });
      }
    };

    it(`allows check number ${DAILY_FIT_CHECK_LIMIT}`, async () => {
      await logChecks(1, DAILY_FIT_CHECK_LIMIT - 1);
      const result = await runFitCheck({
        db,
        client: clientReturning(chatResult(modelAnswer())),
        homeId: 1,
        candidateText: 'monstera',
      });
      expect(result.status).toBe('ok');
    });

    it(`refuses check number ${DAILY_FIT_CHECK_LIMIT + 1} without calling the model`, async () => {
      await logChecks(1, DAILY_FIT_CHECK_LIMIT);
      const send = vi.fn();
      const result = await runFitCheck({
        db,
        client: fakeClient(send),
        homeId: 1,
        candidateText: 'monstera',
      });
      expect(result).toEqual({ status: 'quota_exceeded' });
      expect(send).not.toHaveBeenCalled();
    });

    it('counts per home', async () => {
      await logChecks(1, DAILY_FIT_CHECK_LIMIT);
      const result = await runFitCheck({
        db,
        client: clientReturning(chatResult(modelAnswer())),
        homeId: 2,
        candidateText: 'monstera',
      });
      expect(result.status).toBe('ok');
    });

    it('refuses instead of letting the request through when the count fails', async () => {
      await db.execute('DROP TABLE fit_checks');
      const send = vi.fn();
      const result = await runFitCheck({
        db,
        client: fakeClient(send),
        homeId: 1,
        candidateText: 'monstera',
      });
      expect(result).toEqual({ status: 'failed', failure: 'unavailable' });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    const failureOf = async (client: OpenRouter) => {
      const result = await runFitCheck({ db, client, homeId: 1, candidateText: 'monstera' });
      expect(result.status).toBe('failed');
      return result.status === 'failed' ? result.failure : null;
    };

    it('reports a refusal as "refused"', async () => {
      const client = clientReturning(chatResult('', 'stop', 'I cannot help with that'));
      expect(await failureOf(client)).toBe('refused');
    });

    it('reports a truncated answer as "invalid_response"', async () => {
      const client = clientReturning(chatResult('{"verdict":"good', 'length'));
      expect(await failureOf(client)).toBe('invalid_response');
    });

    it('reports non-JSON content as "invalid_response"', async () => {
      expect(await failureOf(clientReturning(chatResult('not json at all')))).toBe(
        'invalid_response'
      );
    });

    it('reports JSON that does not match the schema as "invalid_response"', async () => {
      const client = clientReturning(chatResult({ ...modelAnswer(), verdict: 'maybe' }));
      expect(await failureOf(client)).toBe('invalid_response');
    });

    it('reports a failed request as "provider_error"', async () => {
      const client = fakeClient(vi.fn().mockRejectedValue(new Error('429 rate limited')));
      expect(await failureOf(client)).toBe('provider_error');
    });

    it('logs nothing for a failed check', async () => {
      await failureOf(clientReturning(chatResult('not json at all')));
      expect(await fitCheckRows()).toHaveLength(0);
    });
  });
});
