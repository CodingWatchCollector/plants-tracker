import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const { endpoint, p256dh_key, auth_key } = await request.json();

	if (!endpoint || !p256dh_key || !auth_key) {
		throw error(400, 'Missing subscription fields');
	}

	const db = getDb(platform);

	// upsert — same endpoint may re-subscribe after SW update
	await db.execute({
		sql: `INSERT INTO push_subscriptions (home_id, endpoint, p256dh_key, auth_key)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(home_id, endpoint) DO UPDATE SET
          p256dh_key = excluded.p256dh_key,
          auth_key   = excluded.auth_key`,
		args: [locals.home.id, endpoint, p256dh_key, auth_key]
	});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const { endpoint } = await request.json();
	if (!endpoint) throw error(400, 'Missing endpoint');

	const db = getDb(platform);
	await db.execute({
		sql: 'DELETE FROM push_subscriptions WHERE endpoint = ? AND home_id = ?',
		args: [endpoint, locals.home.id]
	});

	return json({ ok: true });
};
