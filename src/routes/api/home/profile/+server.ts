import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getProfile, upsertProfile } from '$lib/server/queries/profile';

const BOOLEAN_FIELDS = ['has_cats', 'has_dogs', 'has_small_kids', 'travels_often'] as const;

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);
	return json(await getProfile(db, locals.home.id));
};

export const PUT: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const data = await request.json();

	for (const field of BOOLEAN_FIELDS) {
		if (data[field] !== undefined && typeof data[field] !== 'boolean') {
			throw error(400, `Invalid ${field}`);
		}
	}
	if (
		data.care_commitment !== undefined &&
		!['low', 'medium', 'high'].includes(data.care_commitment)
	) {
		throw error(400, 'Invalid care_commitment');
	}
	if (
		data.typical_light !== undefined &&
		!['low', 'medium', 'bright'].includes(data.typical_light)
	) {
		throw error(400, 'Invalid typical_light');
	}
	if (data.notes !== undefined && (typeof data.notes !== 'string' || data.notes.length > 500)) {
		throw error(400, 'Notes must be 500 characters or fewer');
	}

	const db = getDb(platform);
	await upsertProfile(db, locals.home.id, {
		has_cats: data.has_cats,
		has_dogs: data.has_dogs,
		has_small_kids: data.has_small_kids,
		care_commitment: data.care_commitment,
		typical_light: data.typical_light,
		travels_often: data.travels_often,
		notes: data.notes
	});

	return json({ ok: true });
};
