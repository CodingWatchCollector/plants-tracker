// Stage B of the alternatives: the model re-ranks the SQL shortlist and explains its picks.
// Stage A (the SQL hard filters and look similarity) stays the only source of candidates, so the
// model can only choose among plants that already passed every filter. Only relative value imports:
// the eval runs this under tsx, which doesn't resolve $lib.
import type { OpenRouter } from '@openrouter/sdk';
import z from 'zod';
import type { AlternativeBody, HomeProfile, PlantSpecies } from '$lib/types';
import type { Alternative } from '../queries/alternatives';
import type { FitCheckFailure, FitCheckUsage } from './fit-check';
import { RERANK_SYSTEM_PROMPT } from './rerank-prompt';
import { structuredCall } from './structured-call';

// How many alternatives the user sees, and how many the model's picks must yield to be used.
export const MAX_ALTERNATIVES = 3;
export const MIN_VALID_PICKS = 2;
// How many shortlist entries the model chooses from.
export const RERANK_SHORTLIST_SIZE = 10;

// species_id is a plain number in the schema because strict structured outputs may reject the
// minimum/maximum that Zod adds to int(). Whole numbers are enforced in code instead, like the
// number of picks.
const schema = z.object({
  picks: z.array(z.object({ species_id: z.number(), reason: z.string() })),
});

export type RerankPick = { species_id: number; reason: string };

export type RerankResult =
  | {
      ok: true;
      picks: RerankPick[]; // in the model's order, all from the shortlist, no repeats, at most 3
      invalidPicks: number; // picks dropped because their id was not in the shortlist
      usage: FitCheckUsage;
    }
  | {
      ok: false;
      failure: FitCheckFailure;
      detail: string;
      usage: FitCheckUsage | null; // null only for provider_error
    };

// With this few entries the SQL top 3 is the whole shortlist, so there is nothing to re-rank.
export const needsRerank = (shortlist: Alternative[]) => shortlist.length > MAX_ALTERNATIVES;

type RerankAlternativesProps = {
  client: OpenRouter;
  model: string;
  homeProfile: HomeProfile;
  candidate: PlantSpecies;
  shortlist: Alternative[];
};

const lookFields = (s: PlantSpecies) => ({
  growth_habit: s.growth_habit,
  leaf_size: s.leaf_size,
  leaf_shape: s.leaf_shape,
  variegated: s.variegated,
});

// Catalog data and the home's structured fields only. The home notes are free text and are left
// out on purpose, which keeps prompt injection out of this call.
const getRerankMessage = ({
  homeProfile,
  candidate,
  shortlist,
}: Pick<RerankAlternativesProps, 'homeProfile' | 'candidate' | 'shortlist'>) => {
  const home = {
    has_cats: homeProfile.has_cats,
    has_dogs: homeProfile.has_dogs,
    has_small_kids: homeProfile.has_small_kids,
    care_commitment: homeProfile.care_commitment,
    typical_light: homeProfile.typical_light,
    travels_often: homeProfile.travels_often,
  };
  const candidateFacts = {
    common_name: candidate.common_name,
    scientific_name: candidate.scientific_name,
    ...lookFields(candidate),
  };
  const entries = shortlist.map((a) =>
    JSON.stringify({
      species_id: a.species.id,
      common_name: a.species.common_name,
      scientific_name: a.species.scientific_name,
      ...lookFields(a.species),
      care_level: a.species.care_level,
      light_needs: a.species.light_needs,
      similarity: a.similarity,
    })
  );
  return `<HOME_PROFILE>
${JSON.stringify(home)}
</HOME_PROFILE>
<CANDIDATE>
${JSON.stringify(candidateFacts)}
</CANDIDATE>
<SHORTLIST>
${entries.join('\n')}
</SHORTLIST>`;
};

export const rerankAlternatives = async ({
  client,
  model,
  homeProfile,
  candidate,
  shortlist,
}: RerankAlternativesProps): Promise<RerankResult> => {
  const result = await structuredCall({
    client,
    model,
    schemaName: 'alternative-picks',
    schema,
    system: RERANK_SYSTEM_PROMPT,
    user: getRerankMessage({ homeProfile, candidate, shortlist }),
  });
  if (!result.ok) return result;

  const byId = new Map(shortlist.map((a) => [a.species.id, a]));
  const seen = new Set<number>();
  const picks: RerankPick[] = [];
  let invalidPicks = 0;
  for (const pick of result.data.picks) {
    const entry = Number.isInteger(pick.species_id) ? byId.get(pick.species_id) : undefined;
    if (!entry) {
      invalidPicks++;
    } else if (!seen.has(pick.species_id) && picks.length < MAX_ALTERNATIVES) {
      seen.add(pick.species_id);
      // A blank reason would show as an empty line, so use the templated explanation instead.
      picks.push({
        species_id: pick.species_id,
        reason: pick.reason.trim() || entry.explanation,
      });
    }
  }
  return { ok: true, picks, invalidPicks, usage: result.usage };
};

const toBody = (a: Alternative, explanation: string = a.explanation): AlternativeBody => ({
  species_id: a.species.id,
  common_name: a.species.common_name,
  scientific_name: a.species.scientific_name,
  explanation,
});

// The alternatives to show. null means the re-rank was skipped (see needsRerank). The model's
// picks are used when there are at least MIN_VALID_PICKS of them; in every other case (skipped,
// failed, too few valid picks) it is the SQL top 3 with the explanations getAlternatives built.
// Both runFitCheck and the eval call this, so they apply the same fallback rules.
export const chooseAlternatives = (
  shortlist: Alternative[],
  rerank: RerankResult | null
): AlternativeBody[] => {
  if (rerank?.ok) {
    const byId = new Map(shortlist.map((a) => [a.species.id, a]));
    const chosen = rerank.picks.flatMap((p) => {
      const entry = byId.get(p.species_id);
      return entry ? [toBody(entry, p.reason)] : [];
    });
    if (chosen.length >= MIN_VALID_PICKS) return chosen.slice(0, MAX_ALTERNATIVES);
  }
  return shortlist.slice(0, MAX_ALTERNATIVES).map((a) => toBody(a));
};
