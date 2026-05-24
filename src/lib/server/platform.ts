import { dev } from '$app/environment';
// import {
// 	TURSO_URL,
// 	TURSO_AUTH_TOKEN,
// 	VAPID_KEYS,
// 	VAPID_SUBJECT,
// 	JWT_SECRET
// } from '$env/static/private';
// import { PUBLIC_VAPID_PUBLIC_KEY, PUBLIC_APP_URL } from '$env/static/public';

// In dev, platform is undefined — read from .env via SvelteKit's env modules instead
export function getPlatformEnv(platform: App.Platform | undefined): App.Platform['env'] {
	if (!dev) {
		if (!platform?.env) throw new Error('Platform env not available');
		return platform.env;
	}

	console.log('CAUTION: Using dev env');
	return {
		TURSO_URL: '',
		TURSO_AUTH_TOKEN: '',
		VAPID_KEYS: '',
		VAPID_SUBJECT: '',
		JWT_SECRET: '',
		PUBLIC_VAPID_PUBLIC_KEY: '',
		PUBLIC_APP_URL: '',
		PLANT_IMAGES: {}
	};
}
