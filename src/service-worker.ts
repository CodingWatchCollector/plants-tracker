/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, version } from '$service-worker';

const self = globalThis.self as unknown as ServiceWorkerGlobalScope;

const CACHE = `plants-tracker-${version}`;
const REVALIDATE_MS = 60 * 1000;

// assets to precache on install — SvelteKit gives us the exact list
const ASSETS = [...build, ...files];

// API routes to cache with stale-while-revalidate
const SWR_ROUTES = ['/api/plants'];

function isSWRRoute(pathname: string): boolean {
	return SWR_ROUTES.some(
		(route) => pathname === route || pathname.match(new RegExp(`^${route}/\\d+$`))
	);
}

async function notifyClients(type: string, data: unknown): Promise<void> {
	const clients = await self.clients.matchAll({ type: 'window' });
	clients.forEach((client) => client.postMessage({ type, data }));
}

async function invalidatePlantsCache(cache: Cache): Promise<void> {
	const keys = await cache.keys();
	await Promise.all(
		keys
			.filter((req) => new URL(req.url).pathname.startsWith('/api/plants'))
			.map((key) => cache.delete(key))
	);
}

async function revalidatePlants(cache: Cache, headers: Headers): Promise<void> {
	try {
		const fresh = await fetch('/api/plants', { headers });
		if (fresh.ok) {
			const data = await fresh.clone().json();
			await cache.put('/api/plants', fresh);
			await notifyClients('PLANTS_UPDATED', data);
		}
	} catch {
		// offline — silently keep serving cache
	}
}

// install: precache all build assets and static files
self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}
	event.waitUntil(addFilesToCache());
	// activate immediately without waiting for old SW to be released
	self.skipWaiting();
});

// activate: clean up old caches from previous deployments
self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}
	event.waitUntil(deleteOldCaches());
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// only handle same-origin requests
	if (url.origin !== self.location.origin) return;

	// mutations: network only, then invalidate cache and push fresh data
	if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
		if (url.pathname.startsWith('/api/plants')) {
			event.respondWith(
				fetch(request.clone()).then(async (response) => {
					if (response.ok) {
						const cache = await caches.open(CACHE);
						await invalidatePlantsCache(cache);
						await revalidatePlants(cache, request.headers);
					}
					return response;
				})
			);
		}
		return;
	}

	// GET only from here
	if (request.method !== 'GET') return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// build/static assets: cache first, always fresh due to hashed filenames
			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			// API plants routes: stale-while-revalidate
			if (isSWRRoute(url.pathname)) {
				const cached = await cache.match(request);

				if (cached) {
					const cachedAt = cached.headers.get('sw-cached-at');
					const age = cachedAt ? Date.now() - Number(cachedAt) : Infinity;

					if (age > REVALIDATE_MS) {
						// stale: return cache immediately, revalidate in background
						revalidatePlants(cache, request.headers);
					}

					return cached;
				}

				// no cache yet: fetch and cache with timestamp
				const response = await fetch(request);
				if (response.ok) {
					const headers = new Headers(response.headers);
					headers.set('sw-cached-at', String(Date.now()));
					const toCache = new Response(await response.clone().arrayBuffer(), {
						status: response.status,
						statusText: response.statusText,
						headers
					});
					await cache.put(request, toCache);
				}
				return response;
			}

			// everything else: network first, fall back to cache
			try {
				const response = await fetch(request);
				if (!(response instanceof Response)) {
					throw new Error('Invalid response from fetch');
				}
				if (response.status === 200) {
					cache.put(request, response.clone());
				}
				return response;
			} catch {
				const cached = await cache.match(request);
				if (cached) return cached;
				throw new Error('No network and no cache available');
			}
		})()
	);
});

// push notifications
self.addEventListener('push', (event) => {
	if (!event.data) return;
	const data = event.data.json();
	event.waitUntil(
		self.registration.showNotification(data.title ?? '🌿 Plant Tracker', {
			body: data.body ?? 'Time to check your plants.',
			icon: '/favicon.svg',
			badge: '/apple-touch-icon.png',
			tag: 'watering-reminder',
			renotify: true,
			data: { url: data.url ?? '/' }
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url ?? '/dashboard';
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
			const existing = clientList.find((c) => c.url.includes(url) && 'focus' in c);
			if (existing) return existing.focus();
			return self.clients.openWindow(url);
		})
	);
});
