import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { searchSpecies } from '$lib/server/queries/catalog';

const MAX_QUERY_LENGTH = 100;

// Autocomplete for the plant check page. Only what a suggestion list needs.
export const GET: RequestHandler = async ({ url, locals, platform }) => {
  if (!locals.home) throw error(401, 'Unauthorized');

  const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) return json([]);

  const species = await searchSpecies(getDb(platform), q);
  return json(
    species.map(({ id, common_name, scientific_name }) => ({ id, common_name, scientific_name }))
  );
};
