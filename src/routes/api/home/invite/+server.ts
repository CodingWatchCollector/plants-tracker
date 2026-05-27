import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const db = getDb(platform);
	const { rows } = await db.execute({
		sql: 'SELECT join_token FROM home WHERE id = ?',
		args: [locals.home.id]
	});

	if (!rows[0]) throw error(404, 'Home not found');

	return json({ join_token: rows[0].join_token as string });
};
