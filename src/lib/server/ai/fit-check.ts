import { OpenRouter } from '@openrouter/sdk';
import z from 'zod';
import { FIT_CHECK_SYSTEM_PROMPT, PROMPT_VERSION } from './fit-check-prompt';
import type { HomeProfile, PlantSpecies } from '$lib/types';
import type { Client } from '@libsql/client';
import { logFitCheck } from '../queries/fit-checks';

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
});
export type AiFitCheckResponse = z.infer<typeof schema>;

// A plant the household owns, with its catalog row when the name matched one.
export type OwnedPlant = { name: string; species: PlantSpecies | null };

type GetAiFitCheckProps = {
  client: OpenRouter;
  db: Client;
  homeProfile: HomeProfile;
  homeNotes: string;
  ownedPlants: OwnedPlant[];
  homeId: number;
  candidate: PlantSpecies | string;
  rawClientPrompt: string;
};
const MODEL = 'anthropic/claude-haiku-4.5';

export const getAiFitCheck = ({
  client,
  db,
  homeProfile,
  homeNotes,
  ownedPlants,
  homeId,
  candidate,
  rawClientPrompt,
}: GetAiFitCheckProps): Promise<AiFitCheckResponse | null> => {
  const startTime = performance.now();
  return client.chat
    .send({
      chatRequest: {
        model: MODEL,
        messages: [
          { role: 'system', content: FIT_CHECK_SYSTEM_PROMPT },
          {
            role: 'user',
            content: getFitCheckMessage({
              homeProfile,
              homeNotes,
              ownedPlants,
              candidate,
            }),
          },
        ],
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            strict: true,
            name: 'plant-suggestion',
            schema: schema.toJSONSchema(),
          },
        },
        provider: {
          requireParameters: true,
        },
      },
    })
    .then((res) => {
      if (res instanceof ReadableStream) {
        throw new Error('unexpected streaming response');
      }
      const rawResponse = res.choices[0];
      const finishReason = rawResponse.finishReason;
      if (finishReason !== 'stop') {
        console.log({ finishReason });
        throw new Error(`unexpected finishReason: ${finishReason}`);
      }
      if (rawResponse.message.refusal) {
        console.log({ refusal: rawResponse.message.refusal });
        throw new Error('received refusal message');
      }
      const content = rawResponse.message.content;
      if (typeof content !== 'string') {
        console.log({ content });
        throw new Error('wrong content type');
      }
      const parsedResponse = schema.parse(JSON.parse(content));
      const guardrailedResponse = applyFitCheckGuardrail({
        response: parsedResponse,
        candidate,
        homeProfile,
      });
      return logFitCheck({
        db,
        homeId,
        candidateText: rawClientPrompt,
        speciesId: typeof candidate === 'string' ? null : candidate.id,
        verdict: guardrailedResponse.response.verdict,
        responseJson: JSON.stringify(guardrailedResponse.response),
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        inputTokens: res.usage?.promptTokens,
        outputTokens: res.usage?.completionTokens,
        latencyMs: Math.round(performance.now() - startTime),
        guardrailFired: guardrailedResponse.guardrailFired,
      }).then(() => guardrailedResponse.response);
    })
    .catch((error) => {
      console.error(`[GetAiFitCheck error] ${error?.message || 'unknown error'}`);
      return null;
    });
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
  GetAiFitCheckProps,
  'homeProfile' | 'homeNotes' | 'ownedPlants' | 'candidate'
>;
const getFitCheckMessage = ({
  homeProfile,
  homeNotes,
  ownedPlants,
  candidate,
}: FitCheckMessageProps) => {
  const { home_id: _homeId, updated_at: _updatedAt, notes: _notes, ...profile } = homeProfile;
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
  response: AiFitCheckResponse;
  candidate: PlantSpecies | string;
  homeProfile: HomeProfile;
};

const PET_WORDS = {
  cats: /\b(cats?|kittens?|felines?|pets?)\b/i,
  dogs: /\b(dogs?|puppy|puppies|canines?|pets?)\b/i,
};
const TOXIC_WARNING = /\b(toxic|poisonous)\b/i;
const NEGATED_WARNING = /\b(non-toxic|nontoxic|not toxic|not poisonous|safe)\b/i;

const warnsAboutPet = (warnings: string[], pet: keyof typeof PET_WORDS) =>
  warnings.some((w) => TOXIC_WARNING.test(w) && !NEGATED_WARNING.test(w) && PET_WORDS[pet].test(w));

// Applies only when the catalog says the candidate is toxic to a pet the home has.
// Then the verdict can't be good_fit and a toxicity warning for that pet must be present.
// guardrailFired is true only when this changed the output. Does not mutate its input.
export const applyFitCheckGuardrail = ({
  response,
  candidate,
  homeProfile,
}: ApplyFitCheckGuardrailProps): { response: AiFitCheckResponse; guardrailFired: boolean } => {
  if (typeof candidate === 'string') {
    return { response, guardrailFired: false };
  }
  const exposedPets: (keyof typeof PET_WORDS)[] = [];
  if (homeProfile.has_cats && candidate.toxic_to_cats) exposedPets.push('cats');
  if (homeProfile.has_dogs && candidate.toxic_to_dogs) exposedPets.push('dogs');

  const missingWarnings = exposedPets
    .filter((pet) => !warnsAboutPet(response.warnings, pet))
    .map((pet) => `Toxic to ${pet} if ingested.`);
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
