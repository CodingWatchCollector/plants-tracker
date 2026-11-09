import type { Client } from '@libsql/client';
import type { OpenRouter } from '@openrouter/sdk';
import type { HomeProfile, OwnedPlant, PlantSpecies } from '$lib/types';
import { getAlternatives } from '../queries/alternatives';
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

// A look-alike the home could add instead, with what the "Add this plant" button needs.
export type AlternativeBody = {
  species_id: number;
  common_name: string;
  scientific_name: string;
  explanation: string;
};

// data_source, species_id and alternatives are set here, in code, never by the model.
export type FitCheckBody = AiFitCheckResponse & {
  data_source: 'catalog' | 'model_knowledge';
  species_id: number | null;
  alternatives: AlternativeBody[];
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

// Look-alikes only exist for catalog candidates: there is nothing to compare a free-text name to.
// A failure here must not throw away a model answer that has already been paid for and logged.
const findAlternatives = async (
  db: Client,
  homeProfile: HomeProfile,
  species: PlantSpecies | null,
  ownedPlants: OwnedPlant[]
): Promise<AlternativeBody[]> => {
  if (!species) return [];
  try {
    const alternatives = await getAlternatives({
      db,
      homeProfile,
      candidate: species,
      excludeSpeciesIds: ownedPlants.flatMap((p) => (p.species ? [p.species.id] : [])),
    });
    return alternatives.map((a) => ({
      species_id: a.species.id,
      common_name: a.species.common_name,
      scientific_name: a.species.scientific_name,
      explanation: a.explanation,
    }));
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
}: RunFitCheckProps): Promise<RunFitCheckResult> => {
  const checksToday = await getFitCheckCountByHomeAndDate({ db, homeId });
  if (checksToday === null) return { status: 'failed', failure: 'unavailable' };
  if (Number(checksToday) >= DAILY_FIT_CHECK_LIMIT) return { status: 'quota_exceeded' };

  const [homeProfile, ownedPlants, species] = await Promise.all([
    getProfile(db, homeId),
    getOwnedPlantsWithSpecies(db, homeId),
    findSpeciesByName(db, candidateText),
  ]);

  const [result, alternatives] = await Promise.all([
    getAiFitCheck({
      client,
      db,
      homeProfile,
      homeNotes: homeProfile.notes,
      ownedPlants,
      homeId,
      candidate: species ?? candidateText,
      rawClientPrompt: candidateText,
    }),
    findAlternatives(db, homeProfile, species, ownedPlants),
  ]);
  if (!result.ok) return { status: 'failed', failure: result.failure };

  return {
    status: 'ok',
    body: {
      ...result.response,
      data_source: species ? 'catalog' : 'model_knowledge',
      species_id: species?.id ?? null,
      alternatives,
    },
  };
};
