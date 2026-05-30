import { registerAs } from '@nestjs/config';

/**
 * OpenCode Go — https://opencode.ai/docs/go/
 * Base: https://opencode.ai/zen/go/v1
 * Auth: Authorization: Bearer OPENCODE_GO_API_KEY
 */
export const aiConfig = registerAs('ai', () => {
  const goApiKey =
    process.env.OPENCODE_GO_API_KEY?.trim() ||
    process.env.OPENCODE_API_KEY?.trim() ||
    '';

  const goBaseUrl = (
    process.env.OPENCODE_GO_BASE_URL ??
    process.env.OPENCODE_API_BASE_URL ??
    'https://opencode.ai/zen/go/v1'
  )
    .trim()
    .replace(/\/$/, '');

  return {
    enabled: process.env.AI_ENABLED === 'true' && Boolean(goApiKey),
    goApiKey,
    goBaseUrl,
    envModel: process.env.AI_ENV_MODEL ?? 'deepseek-v4-flash',
    envApiPath: process.env.AI_ENV_API_PATH ?? 'chat/completions',
    chatModel: process.env.AI_CHAT_MODEL ?? 'deepseek-v4-flash',
    chatApiPath: process.env.AI_CHAT_API_PATH ?? 'chat/completions',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '2048', 10),
    requestTimeoutMs: parseInt(
      process.env.AI_REQUEST_TIMEOUT_MS ?? '60000',
      10,
    ),
    ragBaseUrl: (process.env.RAG_FASTAPI_BASE_URL ?? 'http://127.0.0.1:8000')
      .trim()
      .replace(/\/$/, ''),
    ragResolvePath: process.env.RAG_CP_RESOLVE_PATH ?? 'cp/resolve',
    zenApiKey: process.env.OPENCODE_ZEN_API_KEY?.trim() ?? '',
    zenBaseUrl: (
      process.env.OPENCODE_ZEN_BASE_URL ?? 'https://opencode.ai/zen/v1'
    )
      .trim()
      .replace(/\/$/, ''),
  };
});
