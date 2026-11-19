import { OpenRouter } from '@openrouter/sdk';
import { getPlatformEnv } from '$lib/server/platform';

export const getAiClient = (platform: App.Platform | undefined) => {
  const env = getPlatformEnv(platform);
  return new OpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    httpReferer: 'plants-tracker.com',
    appTitle: 'Plants tracker',
  });
};
