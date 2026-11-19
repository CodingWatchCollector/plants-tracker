import type { Client } from '@libsql/client';
import type { OpenRouter } from '@openrouter/sdk';
import type {
  AlternativeBody,
  FitCheckBody,
  HomeProfile,
  OwnedPlant,
  PlantSpecies,
} from '$lib/types';
import { getAlternatives } from '../queries/alternatives';
import { findSpeciesByName, getOwnedPlantsWithSpecies } from '../queries/catalog';
import { getFitCheckCountByHomeAndDate, logFitCheck } from '../queries/fit-checks';
import { getProfile } from '../queries/profile';
import { DEFAULT_FIT_CHECK_MODEL, evaluateFitCheck, type FitCheckFailure } from './fit-check';
import { PROMPT_VERSION } from './fit-check-prompt';
import {
  MAX_ALTERNATIVES,
  RERANK_SHORTLIST_SIZE,
  chooseAlternatives,
  needsRerank,
  rerankAlternatives,
} from './rerank-alternatives';

export const DAILY_FIT_CHECK_LIMIT = 20;
export const MAX_CANDIDATE_LENGTH = 100;

// sql: the SQL top 3 with templated explanations. rerank: the model picks from the SQL top 10 and
// explains its picks, falling back to the SQL top 3. Stays 'sql' until the A vs. B eval is judged.
export type AlternativesMode = 'sql' | 'rerank';
export const ALTERNATIVES_MODE: AlternativesMode = 'sql';

// What the user typed, trimmed and capped; null when nothing is left.
export const normalizeCandidate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, MAX_CANDIDATE_LENGTH).trim();
  return text || null;
};

export type RunFitCheckResult =
  | { status: 'ok'; body: FitCheckBody }
  | { status: 'quota_exceeded' }
  // unavailable: the quota could not be checked, so the request is refused rather than let through.
  | { status: 'failed'; failure: FitCheckFailure | 'unavailable' };

type RunFitCheckProps = {
  db: Client;
  client: OpenRouter;
  homeId: number;
  candidateText: string; // already passed through normalizeCandidate
  alternativesMode?: AlternativesMode; // for tests and the eval; production uses ALTERNATIVES_MODE
};

// Look-alikes only exist for catalog candidates: there is nothing to compare a free-text name to.
// A failure here must not throw away a model answer that has already been paid for and logged. A
// failed re-rank is no failure at all: chooseAlternatives falls back to the SQL top 3. The re-rank
// is not logged and does not count toward the quota; the eval measures what it costs.
const findAlternatives = async (
  db: Client,
  client: OpenRouter,
  mode: AlternativesMode,
  homeProfile: HomeProfile,
  species: PlantSpecies | null,
  ownedPlants: OwnedPlant[]
): Promise<AlternativeBody[]> => {
  if (!species) return [];
  try {
    const shortlist = await getAlternatives({
      db,
      homeProfile,
      candidate: species,
      excludeSpeciesIds: ownedPlants.flatMap((p) => (p.species ? [p.species.id] : [])),
      limit: mode === 'rerank' ? RERANK_SHORTLIST_SIZE : MAX_ALTERNATIVES,
    });
    const rerank =
      mode === 'rerank' && needsRerank(shortlist)
        ? await rerankAlternatives({
            client,
            model: DEFAULT_FIT_CHECK_MODEL,
            homeProfile,
            candidate: species,
            shortlist,
          })
        : null;
    return chooseAlternatives(shortlist, rerank);
  } catch (error) {
    console.error(`[FindAlternatives error] ${(error as Error)?.message || 'unknown error'}`);
    return [];
  }
};

export const runFitCheck = async ({
  db,
  client,
  homeId,
  candidateText,
  alternativesMode = ALTERNATIVES_MODE,
}: RunFitCheckProps): Promise<RunFitCheckResult> => {
  const checksToday = await getFitCheckCountByHomeAndDate({ db, homeId });
  if (checksToday === null) return { status: 'failed', failure: 'unavailable' };
  if (Number(checksToday) >= DAILY_FIT_CHECK_LIMIT) return { status: 'quota_exceeded' };

  const [homeProfile, ownedPlants, species] = await Promise.all([
    getProfile(db, homeId),
    getOwnedPlantsWithSpecies(db, homeId),
    findSpeciesByName(db, candidateText),
  ]);

  const [outcome, alternatives] = await Promise.all([
    evaluateFitCheck({
      client,
      model: DEFAULT_FIT_CHECK_MODEL,
      homeProfile,
      ownedPlants,
      candidate: species ?? candidateText,
    }),
    findAlternatives(db, client, alternativesMode, homeProfile, species, ownedPlants),
  ]);
  // refused and invalid answers were already paid for, so they are logged (and count toward the
  // quota). provider_error is not: no answer came back and an outage shouldn't use up a quota.
  if (!outcome.ok && outcome.failure === 'provider_error') {
    return { status: 'failed', failure: outcome.failure };
  }
  await logFitCheck({
    db,
    homeId,
    candidateText,
    speciesId: species?.id ?? null,
    verdict: outcome.ok ? outcome.response.verdict : 'error',
    responseJson: JSON.stringify(
      outcome.ok ? outcome.response : { failure: outcome.failure, detail: outcome.detail }
    ),
    model: DEFAULT_FIT_CHECK_MODEL,
    promptVersion: PROMPT_VERSION,
    inputTokens: outcome.usage?.inputTokens,
    outputTokens: outcome.usage?.outputTokens,
    latencyMs: outcome.usage?.latencyMs ?? 0,
    guardrailFired: outcome.ok && outcome.guardrailFired,
  });
  if (!outcome.ok) return { status: 'failed', failure: outcome.failure };

  return {
    status: 'ok',
    body: {
      ...outcome.response,
      data_source: species ? 'catalog' : 'model_knowledge',
      species_id: species?.id ?? null,
      alternatives,
    },
  };
};
