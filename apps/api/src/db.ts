import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(connectionString: string) {
  const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema name');
  const adapter = new PrismaPg({ connectionString, options: `-c search_path=${schema}`, max: 10, connectionTimeoutMillis: 3000 }, { schema });
  return new PrismaClient({ adapter });
}
export type Database = ReturnType<typeof createDatabase>;
