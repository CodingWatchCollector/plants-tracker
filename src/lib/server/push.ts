import { ApplicationServer, importVapidKeys } from '@negrel/webpush';
import { getPlatformEnv } from '$lib/server/platform';

interface PushSubscriptionRow {
	endpoint: string;
	p256dh_key: string;
	auth_key: string;
}

interface NotificationPayload {
	title: string;
	body: string;
	url: string;
}

async function getAppServer(platform: App.Platform | undefined) {
	const env = getPlatformEnv(platform);
	const vapidKeys = await importVapidKeys(JSON.parse(env.VAPID_KEYS), { extractable: false });

	return ApplicationServer.new({
		contactInformation: env.VAPID_SUBJECT,
		vapidKeys
	});
}

export async function sendPushNotification(
	subscription: PushSubscriptionRow,
	payload: NotificationPayload,
	platform: App.Platform | undefined
): Promise<'ok' | 'expired' | 'error'> {
	try {
		const appServer = await getAppServer(platform);

		const sub = appServer.subscribe({
			endpoint: subscription.endpoint,
			keys: {
				p256dh: subscription.p256dh_key,
				auth: subscription.auth_key
			}
		});

		await sub.pushTextMessage(JSON.stringify(payload), {});
		return 'ok';
	} catch (e) {
		const message = e instanceof Error ? e.message : '';
		if (message.includes('410') || message.includes('404')) return 'expired';
		console.error('Push error:', message);
		return 'error';
	}
}
