import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlatformEnv } from '$lib/server/platform';

export const POST: RequestHandler = async ({ request, locals, platform: platformFromRequest }) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const formData = await request.formData();
	const file = formData.get('image');

	if (!file || !(file instanceof File)) {
		throw error(400, 'No image provided');
	}

	if (file.size > 1024 * 1024) {
		throw error(400, 'Image too large — max 1MB after compression');
	}

	const allowed = ['image/jpeg', 'image/png', 'image/webp'];
	if (!allowed.includes(file.type)) {
		throw error(400, 'Invalid image type');
	}
	const platformEnv = getPlatformEnv(platformFromRequest);

	const ext = file.type.split('/')[1];
	const key = `homes/${locals.home.id}/plants/${crypto.randomUUID()}.${ext}`;

	const bucket = platformEnv.PLANT_IMAGES;

	await bucket.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type }
	});

	const url = `${platformEnv.PUBLIC_APP_URL}/api/images/${key}`;

	return json({ url });
};

export const DELETE: RequestHandler = async ({
	request,
	locals,
	platform: platformFromRequest
}) => {
	if (!locals.home) throw error(401, 'Unauthorized');

	const { key } = await request.json();
	if (!key || typeof key !== 'string') throw error(400, 'Missing key');

	// prevent deleting other homes' images
	if (!key.startsWith(`homes/${locals.home.id}/`)) {
		throw error(403, 'Forbidden');
	}
	const platformEnv = getPlatformEnv(platformFromRequest);

	await platformEnv.PLANT_IMAGES.delete(key);
	return json({ ok: true });
};
