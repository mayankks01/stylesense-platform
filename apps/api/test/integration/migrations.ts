import { readFileSync, readdirSync } from 'node:fs';
import type pg from 'pg';

export async function applyTestMigrations(connection: pg.Client, schema: string) {
  const root = new URL('../../../../prisma/migrations/', import.meta.url);
  for (const name of readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const sql = readFileSync(new URL(`${name}/migration.sql`, root), 'utf8');
    await connection.query(sql.replaceAll('"public".', `"${schema}".`).replace('CREATE SCHEMA IF NOT EXISTS "public";', `CREATE SCHEMA IF NOT EXISTS "${schema}";`));
  }
}
