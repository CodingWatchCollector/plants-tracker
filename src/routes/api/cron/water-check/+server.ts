import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { sendPushNotification } from '$lib/server/push';
import { getPlatformEnv } from '$lib/server/platform';

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = getPlatformEnv(platform);

	const secret = request.headers.get('x-cron-secret');
	if (secret !== env.CRON_SECRET) throw error(401, 'Unauthorized');

	const db = getDb(platform);
	const today = new Date().toISOString().split('T')[0];

	const { rows: homeRows } = await db.execute({
		sql: `SELECT home_id, COUNT(*) as due_count
          FROM plants
          WHERE next_watering_date <= ?
          GROUP BY home_id`,
		args: [today]
	});

	if (homeRows.length === 0) {
		return json({ ok: true, message: 'No plants due today' });
	}

	for (const homeRow of homeRows) {
		const home_id = homeRow.home_id as number;
		const due_count = homeRow.due_count as number;

		const { rows: subRows } = await db.execute({
			sql: `SELECT endpoint, p256dh_key, auth_key
            FROM push_subscriptions
            WHERE home_id = ?`,
			args: [home_id]
		});

		if (subRows.length === 0) continue;

		const payload = {
			title: '🌿 Plant Tracker',
			body:
				due_count === 1
					? '1 plant needs watering today'
					: `${due_count} plants need watering today`,
			url: '/dashboard'
		};

		for (const sub of subRows) {
			const result = await sendPushNotification(
				{
					endpoint: sub.endpoint as string,
					p256dh_key: sub.p256dh_key as string,
					auth_key: sub.auth_key as string
				},
				payload,
				platform
			);

			if (result === 'expired') {
				await db.execute({
					sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
					args: [sub.endpoint]
				});
			}
		}
	}

	return json({ ok: true, homes_notified: homeRows.length });
};
