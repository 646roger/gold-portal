import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Demo/local admin access mechanism: shared secret sent as the `x-admin-key` header. NOT production auth. */
  ADMIN_API_KEY: z.string().min(16, 'ADMIN_API_KEY must be at least 16 characters'),
  /** auto: OpenAI-compatible (free/local) when LLM_BASE_URL is set, otherwise labelled demo mode. */
  LLM_PROVIDER: z.enum(['auto', 'openai', 'anthropic', 'demo']).default('auto'),
  /** Optional. Not needed for local Ollama; free-tier hosts issue free keys. */
  LLM_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  LLM_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(10).default(5),
  RATE_LIMIT_ENABLED: bool,
  TRUST_PROXY: bool.default('false'),
});

export type Env = z.infer<typeof schema> & { corsOrigins: string[]; llmApiKey: string | undefined };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `KEY=` (empty) in a .env file means "unset", not an invalid empty value.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const e = parsed.data;
  const key = (e.LLM_API_KEY || e.ANTHROPIC_API_KEY || '').trim() || undefined;
  return {
    ...e,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    llmApiKey: key,
  };
}

export const env = loadEnv();
