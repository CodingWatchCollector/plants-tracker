import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { sendPushNotification } from '$lib/server/push';

export const POST: RequestHandler = async ({ locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const db = getDb(platform);

	const { rows } = await db.execute({
		sql: 'SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE home_id = ?',
		args: [locals.home.id]
	});

	if (rows.length === 0) {
		throw error(400, 'No push subscriptions found for this home — enable notifications first');
	}

	const results = await Promise.all(
		rows.map((sub) =>
			sendPushNotification(
				{
					endpoint: sub.endpoint as string,
					p256dh_key: sub.p256dh_key as string,
					auth_key: sub.auth_key as string
				},
				{
					title: '🌿 Plant Tracker',
					body: 'Test notification — push is working!',
					url: '/dashboard'
				},
				platform
			)
		)
	);

	return json({ results });
};
