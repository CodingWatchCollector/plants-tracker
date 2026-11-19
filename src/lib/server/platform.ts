import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
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
    TURSO_URL: privateEnv.TURSO_URL || '',
    TURSO_AUTH_TOKEN: privateEnv.TURSO_AUTH_TOKEN || '',
    VAPID_KEYS: privateEnv.VAPID_KEYS || '',
    VAPID_SUBJECT: privateEnv.VAPID_SUBJECT || '',
    JWT_SECRET: privateEnv.JWT_SECRET || '',
    PUBLIC_VAPID_PUBLIC_KEY: publicEnv.PUBLIC_VAPID_PUBLIC_KEY || '',
    PUBLIC_APP_URL: publicEnv.PUBLIC_APP_URL || '',
    CRON_SECRET: privateEnv.CRON_SECRET || '',
    OPENROUTER_API_KEY: privateEnv.OPENROUTER_API_KEY || '',
    TREFLE_API_KEY: privateEnv.TREFLE_API_KEY || '',
    PLANT_IMAGES: {},
  };
}
