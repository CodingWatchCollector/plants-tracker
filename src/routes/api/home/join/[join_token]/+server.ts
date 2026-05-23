import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { signHomeToken } from '$lib/server/jwt';

export const GET: RequestHandler = async ({ params, platform, cookies }) => {
	const db = getDb(platform);

	const { rows } = await db.execute({
		sql: 'SELECT id, name FROM home WHERE join_token = ?',
		args: [params.join_token]
	});

	if (!rows[0]) throw error(404, 'Invite link is invalid or has expired');

	const id = rows[0].id as number;
	const name = rows[0].name as string;
	const jwt = await signHomeToken({ id, name }, platform);

	// After generating jwt, instead of returning it in json:
	cookies.set('home_jwt', jwt, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 90 // 90 days
	});

	return json({ id, name });
};
