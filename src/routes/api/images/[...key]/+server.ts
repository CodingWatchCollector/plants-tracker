import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlatformEnv } from '$lib/server/platform';

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const bucket = getPlatformEnv(platform).PLANT_IMAGES;
	const obj = await bucket.get(params.key);

	if (!obj) throw error(404, 'Image not found');

	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set('cache-control', 'public, max-age=31536000, immutable');

	return new Response(obj.body, { headers });
};
