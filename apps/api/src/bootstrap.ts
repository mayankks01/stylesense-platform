import { z } from 'zod';
import { createDatabase } from './db.js';
import { readConfig } from './config.js';
import { hashPassword } from './auth.js';
import { emailSchema } from './validation.js';

const values = z.object({ BOOTSTRAP_EMAIL: emailSchema, BOOTSTRAP_NAME: z.string().trim().min(1).max(100), BOOTSTRAP_PASSWORD: z.string().min(12).max(128) }).safeParse(process.env);
if (!values.success) {
  console.error('Set BOOTSTRAP_EMAIL, BOOTSTRAP_NAME and BOOTSTRAP_PASSWORD (12–128 characters) in apps/api/.env.');
  process.exitCode = 1;
} else {
  const db = createDatabase(readConfig().DATABASE_URL);
  try {
    const { BOOTSTRAP_EMAIL: email, BOOTSTRAP_NAME: name, BOOTSTRAP_PASSWORD: password } = values.data;
    if (await db.user.findUnique({ where: { email } })) throw new Error('EXISTS');
    await db.user.create({ data: { email, name, passwordHash: await hashPassword(password) } });
    console.log('Account created. Remove BOOTSTRAP_PASSWORD from your environment file.');
  } catch {
    console.error('Account was not created. Check database connectivity and whether that account already exists. Existing passwords are never overwritten.');
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
}
