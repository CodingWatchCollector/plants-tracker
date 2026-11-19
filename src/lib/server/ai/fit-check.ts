import type { OpenRouter } from '@openrouter/sdk';
import z from 'zod';
import { FIT_CHECK_SYSTEM_PROMPT } from './fit-check-prompt';
import {
  structuredCall,
  type StructuredCallFailure,
  type StructuredCallUsage,
} from './structured-call';
import type { FitCheckResponse, HomeProfile, OwnedPlant, PlantSpecies } from '$lib/types';

const schema = z.object({
  verdict: z.enum(['good_fit', 'caution', 'poor_fit']),
  summary: z.string(),
  reasons: z.array(
    z.object({
      factor: z.enum(['care', 'pets', 'kids', 'light', 'travel', 'other']),
      detail: z.string(),
    })
  ),
  warnings: z.array(z.string()),
  identified_as: z.string().nullable(),
}) satisfies z.ZodType<FitCheckResponse>;
// The other direction: the plain type must not allow anything the schema rejects.
const _plainTypeMatchesSchema = (r: FitCheckResponse): z.infer<typeof schema> => r;
void _plainTypeMatchesSchema;

export const DEFAULT_FIT_CHECK_MODEL = 'anthropic/claude-haiku-4.5';

export type FitCheckFailure = StructuredCallFailure;
export type FitCheckUsage = StructuredCallUsage;

export type FitCheckOutcome =
  | {
      ok: true;
      response: FitCheckResponse; // after the guardrail
      rawResponse: FitCheckResponse; // as the model returned it, before the guardrail
      guardrailFired: boolean;
      usage: FitCheckUsage;
    }
  | {
      ok: false;
      failure: FitCheckFailure;
      detail: string; // the error message; for invalid content include up to 1000 chars of it
      usage: FitCheckUsage | null; // null only for provider_error (no response came back)
    };

type EvaluateFitCheckProps = {
  client: OpenRouter;
  model: string;
  homeProfile: HomeProfile;
  ownedPlants: OwnedPlant[];
  candidate: PlantSpecies | string;
};

export const evaluateFitCheck = async ({
  client,
  model,
  homeProfile,
  ownedPlants,
  candidate,
}: EvaluateFitCheckProps): Promise<FitCheckOutcome> => {
  const result = await structuredCall({
    client,
    model,
    schemaName: 'plant-suggestion',
    schema,
    system: FIT_CHECK_SYSTEM_PROMPT,
    user: getFitCheckMessage({ homeProfile, ownedPlants, candidate }),
  });
  if (!result.ok) return result;
  const guardrailed = applyFitCheckGuardrail({
    response: result.data,
    candidate,
    homeProfile,
  });
  return {
    ok: true,
    response: guardrailed.response,
    rawResponse: result.data,
    guardrailFired: guardrailed.guardrailFired,
    usage: result.usage,
  };
};

// Block names match the ones the system prompt refers to (HOME_NOTES, CATALOG).
// User-written text is escaped so it can't close a block early and fake a new one.
const escapeText = (text: string) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

const catalogFacts = (s: PlantSpecies) => ({
  scientific_name: s.scientific_name,
  common_name: s.common_name,
  care_level: s.care_level,
  light_needs: s.light_needs,
  drought_tolerance: s.drought_tolerance,
  watering_interval_days: s.watering_interval_days,
  toxic_to_cats: s.toxic_to_cats,
  toxic_to_dogs: s.toxic_to_dogs,
  toxicity_notes: s.toxicity_notes,
});

type FitCheckMessageProps = Pick<
  EvaluateFitCheckProps,
  'homeProfile' | 'ownedPlants' | 'candidate'
>;
const getFitCheckMessage = ({ homeProfile, ownedPlants, candidate }: FitCheckMessageProps) => {
  const { home_id: _homeId, updated_at: _updatedAt, notes: homeNotes, ...profile } = homeProfile;
  const owned = ownedPlants.length
    ? ownedPlants
        .map((p) =>
          JSON.stringify({
            name: escapeText(p.name),
            ...(p.species ? { catalog: catalogFacts(p.species) } : {}),
          })
        )
        .join('\n')
    : '(none)';
  const candidateBlock =
    typeof candidate === 'string'
      ? `<CANDIDATE>\n${escapeText(candidate)}\n(not in catalog)\n</CANDIDATE>`
      : `<CANDIDATE>\n${escapeText(candidate.common_name)}\n<CATALOG>\n${JSON.stringify(catalogFacts(candidate))}\n</CATALOG>\n</CANDIDATE>`;

  return `<HOME_PROFILE>
${JSON.stringify(profile)}
</HOME_PROFILE>
<HOME_NOTES>
${homeNotes ? escapeText(homeNotes) : '(none)'}
</HOME_NOTES>
<OWNED_PLANTS>
${owned}
</OWNED_PLANTS>
${candidateBlock}`;
};

type ApplyFitCheckGuardrailProps = {
  response: FitCheckResponse;
  candidate: PlantSpecies | string;
  homeProfile: HomeProfile;
};

// Who a toxicity warning is about, and the words that show it names them. 'kids' uses the
// children regex from the kids rule; the pet entries accept a plain "pets" too.
const WARNING_SUBJECTS = {
  cats: /\b(cats?|kittens?|felines?|pets?)\b/i,
  dogs: /\b(dogs?|puppy|puppies|canines?|pets?)\b/i,
  kids: /\b(child|children|kids?|toddlers?|bab(y|ies)|people|humans?)\b/i,
} as const;
export type WarningSubject = keyof typeof WARNING_SUBJECTS;
const TOXIC_WARNING = /\b(toxic|poisonous)\b/i;
const NEGATED_WARNING = /\b(non-?toxic|not toxic|not poisonous)\b/i;

// True when one of the warnings is a (non-negated) toxicity warning that names the subject.
// Shared by the guardrail and the eval scoring, so both judge a warning the same way.
export const warnsAbout = (warnings: string[], subject: WarningSubject) =>
  warnings.some(
    (w) => TOXIC_WARNING.test(w) && !NEGATED_WARNING.test(w) && WARNING_SUBJECTS[subject].test(w)
  );

// Applies only to catalog candidates, with two rules:
//   - pets: toxic to a pet the home has, so the verdict can't be good_fit and a toxicity warning
//     for that pet must be present;
//   - small kids: toxic to cats or dogs (ASPCA pet toxicity as a proxy for "not safe around small
//     kids"), so a toxicity warning mentioning children must be present. The verdict is not forced.
// guardrailFired is true only when this changed the output. Does not mutate its input.
export const applyFitCheckGuardrail = ({
  response,
  candidate,
  homeProfile,
}: ApplyFitCheckGuardrailProps): { response: FitCheckResponse; guardrailFired: boolean } => {
  if (typeof candidate === 'string') {
    return { response, guardrailFired: false };
  }
  const exposedPets: ('cats' | 'dogs')[] = [];
  if (homeProfile.has_cats && candidate.toxic_to_cats) exposedPets.push('cats');
  if (homeProfile.has_dogs && candidate.toxic_to_dogs) exposedPets.push('dogs');

  const missingWarnings = exposedPets
    .filter((pet) => !warnsAbout(response.warnings, pet))
    .map((pet) => `Toxic to ${pet} if ingested.`);
  const exposedKids =
    homeProfile.has_small_kids && (candidate.toxic_to_cats || candidate.toxic_to_dogs);
  if (exposedKids && !warnsAbout(response.warnings, 'kids')) {
    missingWarnings.push('Toxic if eaten; keep out of reach of small children.');
  }
  const verdict =
    exposedPets.length && response.verdict === 'good_fit' ? 'poor_fit' : response.verdict;

  if (!missingWarnings.length && verdict === response.verdict) {
    return { response, guardrailFired: false };
  }
  return {
    response: { ...response, verdict, warnings: [...response.warnings, ...missingWarnings] },
    guardrailFired: true,
  };
};
