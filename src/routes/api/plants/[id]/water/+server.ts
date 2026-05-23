import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { markWatered } from '$lib/server/queries/plants';

export const POST: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');
	const db = getDb(platform);
	await markWatered(db, Number(params.id), locals.home.id);
	return json({ ok: true });
};
