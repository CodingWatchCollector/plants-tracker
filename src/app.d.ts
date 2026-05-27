// See https://svelte.dev/docs/kit/types#app.d.ts

import type { Home } from '$lib/types';

type ENV = {
	TURSO_URL: string;
	TURSO_AUTH_TOKEN: string;
	VAPID_KEYS: string;
	VAPID_SUBJECT: string;
	PUBLIC_APP_URL: string;
	PLANT_IMAGES: R2Bucket;
	JWT_SECRET: string;
	PUBLIC_VAPID_PUBLIC_KEY: string;
	CRON_SECRET: string;
};
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			home: Pick<Home, 'id' | 'name'> | null;
		}
		interface Platform {
			env: ENV;
			cf: CfProperties;
			ctx: ExecutionContext;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Navigator {
		standalone?: boolean;
	}
	interface ScheduledEvent {
		scheduledTime: number;
		cron: string;
	}
	namespace NodeJS {
		type ProcessEnv = ENV;
	}
}

export {};
