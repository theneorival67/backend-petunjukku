import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => {
  const aiServiceBaseUrl = (
    process.env.AI_SERVICE_BASE_URL ??
    process.env.RAG_FASTAPI_BASE_URL ??
    'http://127.0.0.1:8000'
  )
    .trim()
    .replace(/\/$/, '');

  return {
    enabled: process.env.AI_ENABLED === 'true',
    requestTimeoutMs: parseInt(
      process.env.AI_REQUEST_TIMEOUT_MS ?? '60000',
      10,
    ),
    aiServiceBaseUrl,
    internalApiKey: process.env.INTERNAL_API_KEY?.trim() ?? '',
    ragBaseUrl: aiServiceBaseUrl,
    ragResolvePath: process.env.RAG_CP_RESOLVE_PATH ?? 'cp/resolve',
  };
});
