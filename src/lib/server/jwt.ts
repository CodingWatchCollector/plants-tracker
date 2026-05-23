import { getPlatformEnv } from '$lib/server/platform';
import { SignJWT, jwtVerify } from 'jose';

function getSecret(platform: App.Platform | undefined) {
	const env = getPlatformEnv(platform);
	return new TextEncoder().encode(env.JWT_SECRET);
}

export async function signHomeToken(
	home: { id: number; name: string },
	platform: App.Platform | undefined
): Promise<string> {
	return new SignJWT({ home_id: home.id, home_name: home.name })
		.setProtectedHeader({ alg: 'HS256' })
		.setExpirationTime('90d')
		.sign(getSecret(platform));
}

export async function verifyHomeToken(
	token: string,
	platform: App.Platform | undefined
): Promise<{ home_id: number; home_name: string } | null> {
	try {
		const { payload } = await jwtVerify(token, getSecret(platform));
		return payload as { home_id: number; home_name: string };
	} catch (err) {
		console.error('verifyHomeToken', err instanceof Error ? err.message : err);
		return null;
	}
}
