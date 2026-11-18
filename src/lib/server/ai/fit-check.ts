import type { OpenRouter } from '@openrouter/sdk';
import z from 'zod';
import { FIT_CHECK_SYSTEM_PROMPT } from './fit-check-prompt';
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

// refused: the model declined. invalid_response: truncated, empty, or not matching the schema.
// provider_error: the request itself failed (network, routing, rate limit, bad key).
export type FitCheckFailure = 'refused' | 'invalid_response' | 'provider_error';

export type FitCheckUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};

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

type TokenCounts = Pick<FitCheckUsage, 'inputTokens' | 'outputTokens'>;

class FitCheckError extends Error {
  constructor(
    readonly failure: FitCheckFailure,
    message: string,
    readonly tokens?: TokenCounts
  ) {
    super(message);
  }
}

type EvaluateFitCheckProps = {
  client: OpenRouter;
  model: string;
  homeProfile: HomeProfile;
  ownedPlants: OwnedPlant[];
  candidate: PlantSpecies | string;
};

const MAX_DETAIL_CONTENT = 1000;

export const evaluateFitCheck = async ({
  client,
  model,
  homeProfile,
  ownedPlants,
  candidate,
}: EvaluateFitCheckProps): Promise<FitCheckOutcome> => {
  const startTime = performance.now();
  const usageOf = (tokens?: TokenCounts): FitCheckUsage => ({
    inputTokens: tokens?.inputTokens ?? null,
    outputTokens: tokens?.outputTokens ?? null,
    latencyMs: Math.round(performance.now() - startTime),
  });
  try {
    const res = await client.chat.send({
      chatRequest: {
        model,
        messages: [
          { role: 'system', content: FIT_CHECK_SYSTEM_PROMPT },
          {
            role: 'user',
            content: getFitCheckMessage({ homeProfile, ownedPlants, candidate }),
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
    });
    if (res instanceof ReadableStream) {
      throw new FitCheckError('provider_error', 'unexpected streaming response');
    }
    const tokens: TokenCounts = {
      inputTokens: res.usage?.promptTokens ?? null,
      outputTokens: res.usage?.completionTokens ?? null,
    };
    const choice = res.choices[0];
    const finishReason = choice.finishReason;
    if (finishReason !== 'stop') {
      throw new FitCheckError(
        'invalid_response',
        `unexpected finishReason: ${finishReason}`,
        tokens
      );
    }
    if (choice.message.refusal) {
      throw new FitCheckError('refused', 'received refusal message', tokens);
    }
    const content = choice.message.content;
    if (typeof content !== 'string') {
      throw new FitCheckError('invalid_response', 'wrong content type', tokens);
    }
    const parsed = schema.safeParse(parseJson(content));
    if (!parsed.success) {
      throw new FitCheckError(
        'invalid_response',
        `schema mismatch: ${parsed.error.message}\ncontent: ${content.slice(0, MAX_DETAIL_CONTENT)}`,
        tokens
      );
    }
    const guardrailed = applyFitCheckGuardrail({
      response: parsed.data,
      candidate,
      homeProfile,
    });
    return {
      ok: true,
      response: guardrailed.response,
      rawResponse: parsed.data,
      guardrailFired: guardrailed.guardrailFired,
      usage: usageOf(tokens),
    };
  } catch (error) {
    const message = (error as Error)?.message || 'unknown error';
    console.error(`[EvaluateFitCheck error] ${message}`);
    if (error instanceof FitCheckError) {
      return {
        ok: false,
        failure: error.failure,
        detail: message,
        usage: error.tokens ? usageOf(error.tokens) : null,
      };
    }
    return { ok: false, failure: 'provider_error', detail: message, usage: null };
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

const PET_WORDS = {
  cats: /\b(cats?|kittens?|felines?|pets?)\b/i,
  dogs: /\b(dogs?|puppy|puppies|canines?|pets?)\b/i,
};
const KID_WORDS = /\b(child|children|kids?|toddlers?|bab(y|ies)|people|humans?)\b/i;
const TOXIC_WARNING = /\b(toxic|poisonous)\b/i;
const NEGATED_WARNING = /\b(non-?toxic|not toxic|not poisonous)\b/i;

const warnsAbout = (warnings: string[], words: RegExp) =>
  warnings.some((w) => TOXIC_WARNING.test(w) && !NEGATED_WARNING.test(w) && words.test(w));

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
  const exposedPets: (keyof typeof PET_WORDS)[] = [];
  if (homeProfile.has_cats && candidate.toxic_to_cats) exposedPets.push('cats');
  if (homeProfile.has_dogs && candidate.toxic_to_dogs) exposedPets.push('dogs');

  const missingWarnings = exposedPets
    .filter((pet) => !warnsAbout(response.warnings, PET_WORDS[pet]))
    .map((pet) => `Toxic to ${pet} if ingested.`);
  const exposedKids =
    homeProfile.has_small_kids && (candidate.toxic_to_cats || candidate.toxic_to_dogs);
  if (exposedKids && !warnsAbout(response.warnings, KID_WORDS)) {
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
