import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getPlant, updatePlant, deletePlant } from '$lib/server/queries/plants';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);
	const plant = await getPlant(db, Number(params.id), locals.home.id);
	if (!plant) throw error(404, 'Plant not found');
	return json(plant);
};

export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const data = await request.json();
	const db = getDb(platform);
	await updatePlant(db, Number(params.id), locals.home.id, data);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);
	await deletePlant(db, Number(params.id), locals.home.id);
	return json({ ok: true });
};
