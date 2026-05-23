import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getPlants, createPlant } from '$lib/server/queries/plants';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);
	const plants = await getPlants(db, locals.home.id);
	return json(plants);
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const data = await request.json();

	if (!data.name?.trim()) throw error(400, 'Plant name is required');
	if (!data.watering_interval_days || data.watering_interval_days < 1) {
		throw error(400, 'Watering interval must be at least 1 day');
	}

	const db = getDb(platform);
	const id = await createPlant(db, locals.home.id, data);

	return json({ id }, { status: 201 });
};
