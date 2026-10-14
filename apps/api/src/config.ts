import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  APP_ORIGIN: z.string().url().default('http://127.0.0.1:5180'),
  ALLOW_SIMULATED_EVENTS: z.enum(['true', 'false']).default('false'),
  EMAIL_MODE: z.enum(['mock', 'resend']).default('mock'),
  EMAIL_MOCK_FAILURE: z.enum(['none', 'reject', 'timeout']).default('none'),
  EMAIL_FROM: z.string().min(1).max(254).regex(/^[^\r\n]+$/).default('StyleSense AI <onboarding@resend.dev>'),
  EMAIL_SENDER_NAME: z.string().trim().min(1).max(100).default('StyleSense team'),
  EMAIL_PROPOSED_TIME_WINDOW: z.string().trim().max(100).optional(),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:4100'),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value), 'Must be a PostgreSQL URL'),
}).refine(value => value.NODE_ENV !== 'production' || (value.APP_ORIGIN.startsWith('https://') && value.ALLOW_SIMULATED_EVENTS === 'false' && value.EMAIL_MODE === 'resend'), 'Production requires HTTPS and simulated events disabled')
  .refine(value => value.EMAIL_MODE !== 'resend' || (!!value.RESEND_API_KEY && !!value.RESEND_WEBHOOK_SECRET && value.PUBLIC_BASE_URL.startsWith('https://')), 'Resend requires credentials and a public HTTPS base URL')
  .refine(value => { const url = new URL(value.PUBLIC_BASE_URL); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'; }, 'PUBLIC_BASE_URL must be an HTTP(S) origin');

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report invalid field names, never connection-string values or credentials.
    throw new Error(`Invalid environment configuration: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
  }
  return result.data;
}
