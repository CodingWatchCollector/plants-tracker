import { getVapidPublicKey } from '$lib/vapid';
import { apiFetch } from '$lib/api';

const registerServiceWorker = (): Promise<ServiceWorkerRegistration> => {
	return navigator.serviceWorker.register('/sw.js', { scope: '/' });
};

const getOrCreateSubscription = async (
	reg: ServiceWorkerRegistration
): Promise<PushSubscription> => {
	const existing = await reg.pushManager.getSubscription();
	if (existing) return existing;

	return reg.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: getVapidPublicKey()
	});
};

export const setupPushNotifications = async (): Promise<'granted' | 'denied' | 'unsupported'> => {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
		return 'unsupported';
	}

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return 'denied';

	try {
		const reg = await registerServiceWorker();
		const subscription = await getOrCreateSubscription(reg);
		const { endpoint, keys } = subscription.toJSON();

		if (!endpoint || !keys?.p256dh || !keys?.auth) {
			throw new Error('Incomplete subscription data');
		}

		const res = await apiFetch('/api/push/subscribe', {
			method: 'POST',
			body: JSON.stringify({
				endpoint,
				p256dh_key: keys.p256dh,
				auth_key: keys.auth
			})
		});

		if (!res.ok) throw new Error(await res.text());
		return 'granted';
	} catch (e) {
		console.error('Push setup failed:', e instanceof Error ? e.message : e);
		return 'denied';
	}
};

export const unsubscribePushNotifications = async (): Promise<void> => {
	const reg = await navigator.serviceWorker.getRegistration('/sw.js');
	if (!reg) return;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;

	await apiFetch('/api/push/subscribe', {
		method: 'DELETE',
		body: JSON.stringify({ endpoint: sub.endpoint })
	});

	await sub.unsubscribe();
};
