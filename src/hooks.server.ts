import type { Handle } from '@sveltejs/kit';
import { verifyHomeToken } from '$lib/server/jwt';
import { getDb } from '$lib/server/db';
import { sendPushNotification } from '$lib/server/push';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get('home_jwt');

	if (token) {
		const payload = await verifyHomeToken(token, event.platform);
		if (payload) {
			event.locals.home = { id: payload.home_id, name: payload.home_name };
		}
	}

	return resolve(event);
};

export async function scheduled(
	_event: ScheduledEvent,
	platform: App.Platform | undefined
): Promise<void> {
	const db = getDb(platform);
	const today = new Date().toISOString().split('T')[0];

	// get all homes that have plants due today
	const { rows: homeRows } = await db.execute({
		sql: `SELECT DISTINCT home_id, COUNT(*) as due_count
          FROM plants
          WHERE next_watering_date <= ?
          GROUP BY home_id`,
		args: [today]
	});

	for (const homeRow of homeRows) {
		const home_id = homeRow.home_id as number;
		const due_count = homeRow.due_count as number;

		// get all push subscriptions for this home
		const { rows: subRows } = await db.execute({
			sql: `SELECT endpoint, p256dh_key, auth_key
            FROM push_subscriptions
            WHERE home_id = ?`,
			args: [home_id]
		});

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

			// clean up expired subscriptions
			if (result === 'expired') {
				await db.execute({
					sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
					args: [sub.endpoint]
				});
			}
		}
	}
}
