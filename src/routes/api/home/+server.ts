import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { generateToken } from '$lib/server/tokens';
import { signHomeToken } from '$lib/server/jwt';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
	const { name } = await request.json();

	if (!name?.trim()) throw error(400, 'Home name is required');

	const db = getDb(platform);
	const join_token = generateToken();

	const { lastInsertRowid } = await db.execute({
		sql: 'INSERT INTO home (name, join_token) VALUES (?, ?)',
		args: [name.trim(), join_token]
	});

	const id = Number(lastInsertRowid);
	const jwt = await signHomeToken({ id, name: name.trim() }, platform);

	// After generating jwt, instead of returning it in json:
	cookies.set('home_jwt', jwt, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 90 // 90 days
	});

	return json({ id, name , join_token });
};
