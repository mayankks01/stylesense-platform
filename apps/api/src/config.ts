import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:5180'),
  ALLOW_SIMULATED_EVENTS: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value), 'Must be a PostgreSQL URL'),
}).refine(value => value.NODE_ENV !== 'production' || (value.APP_ORIGIN.startsWith('https://') && value.ALLOW_SIMULATED_EVENTS === 'false'), 'Production requires HTTPS and simulated events disabled');

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report invalid field names, never connection-string values or credentials.
    throw new Error(`Invalid environment configuration: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}
