import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import { emailSchema } from './validation.js';

const COOKIE = 'stylesense_session';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, hash: string) {
  const [version, salt, key] = hash.split(':');
  if (version !== 'scrypt-v1' || !salt || !key || !/^[a-f0-9]{128}$/.test(key)) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(key, 'hex'));
}
export type AuthOptions = { appOrigin: string; production: boolean; allowSimulatedEvents: boolean };
function cookieToken(header: string | undefined) {
  const token = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

export function auth(db: Database, options: AuthOptions) {
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: options.production, path: '/' };
  const requireOrigin: RequestHandler = (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== options.appOrigin) throw new ApiError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
    next();
  };
  const requireSession: RequestHandler = async (req, res, next) => {
    const token = cookieToken(req.headers.cookie);
    const session = token ? await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: { select: { id: true, name: true, email: true } } } }) : null;
    if (!session || session.expiresAt <= new Date()) {
      if (session) await db.session.deleteMany({ where: { tokenHash: session.tokenHash } });
      res.clearCookie(COOKIE, cookieOptions);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    }
    res.locals.session = session;
    res.locals.userId = session.userId;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.get('x-csrf-token');
      if (!csrf || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrfToken))) throw new ApiError(403, 'CSRF_REJECTED', 'CSRF token is missing or invalid.');
    }
    next();
  };
  const router = Router();
  router.use(requireOrigin);
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.', requestId: res.locals.requestId } });
  } });
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));
  router.post('/login', limiter, async (req, res) => {
    const body = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict().parse(req.body);
    const user = await db.user.findUnique({ where: { email: body.email } });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? await dummyHash);
    if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const previous = cookieToken(req.headers.cookie);
    await db.$transaction(async tx => {
      await tx.session.deleteMany({ where: { OR: [{ userId: user.id, expiresAt: { lte: new Date() } }, ...(previous ? [{ tokenHash: digest(previous) }] : [])] } });
      await tx.session.create({ data: { tokenHash: digest(token), userId: user.id, csrfToken, expiresAt } });
    });
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
    res.json({ user: { id: user.id, name: user.name, email: user.email }, csrfToken, expiresAt });
  });
  router.get('/me', requireSession, (_req, res) => {
    const session = res.locals.session;
    res.json({ user: session.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
  });
  router.post('/logout', requireSession, async (_req, res) => {
    await db.session.deleteMany({ where: { tokenHash: res.locals.session.tokenHash } });
    res.clearCookie(COOKIE, cookieOptions);
    res.status(204).end();
  });
  return { router, requireSession, requireOrigin };
}
