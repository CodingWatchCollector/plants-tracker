import { PUBLIC_VAPID_PUBLIC_KEY } from '$env/static/public';

export function getVapidPublicKey(): ArrayBuffer {
	const base64 = PUBLIC_VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}
