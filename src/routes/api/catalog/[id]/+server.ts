import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getSpeciesById } from '$lib/server/queries/catalog';

// What the "add plant" form needs to start from a catalog species.
export const GET: RequestHandler = async ({ params, locals, platform }) => {
  if (!locals.home) throw error(401, 'Unauthorized');

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw error(404, 'Plant not found');

  const species = await getSpeciesById(getDb(platform), id);
  if (!species) throw error(404, 'Plant not found');

  return json({
    id: species.id,
    common_name: species.common_name,
    scientific_name: species.scientific_name,
    watering_interval_days: species.watering_interval_days,
  });
};
