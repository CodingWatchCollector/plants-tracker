import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getAiClient } from '$lib/server/ai/client';
import { normalizeCandidate, runFitCheck } from '$lib/server/ai/run-fit-check';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
  if (!locals.home) throw error(401, 'Unauthorized');

  const data = await request.json().catch(() => null);
  const candidateText = normalizeCandidate(data?.candidate);
  if (!candidateText) throw error(400, 'Candidate is required');

  const result = await runFitCheck({
    db: getDb(platform),
    client: getAiClient(platform),
    homeId: locals.home.id,
    candidateText,
  });

  switch (result.status) {
    case 'ok':
      return json(result.body);
    case 'quota_exceeded':
      throw error(429, 'Daily limit of plant checks reached. Try again tomorrow.');
    case 'failed':
      switch (result.failure) {
        case 'refused':
          throw error(422, 'The assistant could not evaluate this plant.');
        case 'invalid_response':
          throw error(502, 'The assistant returned an unusable answer. Please try again.');
        default:
          throw error(503, 'The plant check is unavailable right now. Please try again later.');
      }
  }
};
