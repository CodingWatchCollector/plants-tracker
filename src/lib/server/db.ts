import { getPlatformEnv } from '$lib/server/platform';
import { createClient } from '@libsql/client/http';

export function getDb(platform: App.Platform | undefined) {
	const env = getPlatformEnv(platform);
	return createClient({
		url: env.TURSO_URL,
		authToken: env.TURSO_AUTH_TOKEN
	});
}
