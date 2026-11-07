import type { Client } from '@libsql/client';
import type { OpenRouter } from '@openrouter/sdk';
import { findSpeciesByName, getOwnedPlantsWithSpecies } from '../queries/catalog';
import { getFitCheckCountByHomeAndDate } from '../queries/fit-checks';
import { getProfile } from '../queries/profile';
import { getAiFitCheck, type AiFitCheckResponse, type FitCheckFailure } from './fit-check';

export const DAILY_FIT_CHECK_LIMIT = 20;
export const MAX_CANDIDATE_LENGTH = 100;

// What the user typed, trimmed and capped; null when nothing is left.
export const normalizeCandidate = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, MAX_CANDIDATE_LENGTH).trim();
  return text || null;
};

// data_source and species_id are set here, in code, never by the model.
export type FitCheckBody = AiFitCheckResponse & {
  data_source: 'catalog' | 'model_knowledge';
  species_id: number | null;
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
};

export const runFitCheck = async ({
  db,
  client,
  homeId,
  candidateText,
}: RunFitCheckProps): Promise<RunFitCheckResult> => {
  const checksToday = await getFitCheckCountByHomeAndDate({ db, homeId });
  if (checksToday === null) return { status: 'failed', failure: 'unavailable' };
  if (Number(checksToday) >= DAILY_FIT_CHECK_LIMIT) return { status: 'quota_exceeded' };

  const [homeProfile, ownedPlants, species] = await Promise.all([
    getProfile(db, homeId),
    getOwnedPlantsWithSpecies(db, homeId),
    findSpeciesByName(db, candidateText),
  ]);

  const result = await getAiFitCheck({
    client,
    db,
    homeProfile,
    homeNotes: homeProfile.notes,
    ownedPlants,
    homeId,
    candidate: species ?? candidateText,
    rawClientPrompt: candidateText,
  });
  if (!result.ok) return { status: 'failed', failure: result.failure };

  return {
    status: 'ok',
    body: {
      ...result.response,
      data_source: species ? 'catalog' : 'model_knowledge',
      species_id: species?.id ?? null,
    },
  };
};
