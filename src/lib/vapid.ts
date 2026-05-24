export function getVapidPublicKey(): ArrayBuffer {
	console.log('VAPID_PUBLIC_KEY', process.env.PUBLIC_VAPID_PUBLIC_KEY);
	const base64 = (process.env.PUBLIC_VAPID_PUBLIC_KEY || '').replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))).buffer;
}
