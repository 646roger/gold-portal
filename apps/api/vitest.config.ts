import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/helpers/globalSetup.ts'],
    fileParallelism: false, // integration tests share one Postgres test database
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://goldloan:goldloan@localhost:5432/goldloan_test',
      ADMIN_API_KEY: 'test-admin-key-0123456789',
      CORS_ORIGINS: 'http://localhost:5173',
      LLM_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      RATE_LIMIT_ENABLED: 'false',
    },
  },
});
