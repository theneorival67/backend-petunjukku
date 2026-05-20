import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.APP_PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
}));

export const corsConfig = registerAs('cors', () => ({
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim()),
}));

export const supabaseConfig = registerAs('supabase', () => ({
  url:
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey:
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  serviceRoleKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY,
}));

export const storageConfig = registerAs('storage', () => ({
  bucketDocuments: process.env.SUPABASE_STORAGE_BUCKET_DOCUMENTS ?? 'documents',
  bucketAvatars: process.env.SUPABASE_STORAGE_BUCKET_AVATARS ?? 'avatars',
  maxFileSizeMb: parseInt(process.env.SUPABASE_STORAGE_MAX_FILE_SIZE_MB ?? '10', 10),
  get maxFileSizeBytes() {
    return this.maxFileSizeMb * 1024 * 1024;
  },
}));

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  directUrl: process.env.DIRECT_URL,
}));

// export const aiConfig = registerAs('ai', () => ({
//   openaiApiKey: process.env.OPENAI_API_KEY,
//   model: process.env.AI_MODEL ?? 'gpt-4o',
//   maxTokens: parseInt(process.env.AI_MAX_TOKENS ?? '2048', 10),
// }));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET,
  expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
}));