import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Resets the TEST database, applies every migration.sql under prisma/migrations in order,
 * then seeds plans + market rate. (Plain SQL so tests do not depend on Prisma's schema engine.)
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://goldloan:goldloan@localhost:5432/goldloan_test';
  if (!/test/i.test(new URL(url).pathname)) throw new Error('Refusing to reset a database whose name does not contain "test".');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../prisma/migrations');
    for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) {
      await client.query(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
    }
    await client.query(`
      INSERT INTO loan_schemes (id,name,repayment_type,annual_interest_rate,max_ltv_percent,tenure_months) VALUES
       ('PLAN_BULLET_01','Bullet Repayment','BULLET',12.00,70.00,12),
       ('PLAN_EMI_01','Monthly EMI','EMI',10.50,75.00,12);
      INSERT INTO market_rates (rate_per_gram_paise) VALUES (700000);`);
  } finally {
    await client.end();
  }
}
