import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Database } from './db.js';
import { auth, type AuthOptions } from './auth.js';
import { businessRoutes } from './routes.js';
import { ApiError } from './errors.js';
import { emailRoutes, publicEmailRoutes, webhookRoute } from './email/routes.js';
import type { EmailOptions } from './email/service.js';
import { aiRoutes } from './ai/routes.js';
import type { AiOptions } from './ai/providers.js';

export function createApp(checkDatabase: () => Promise<void>, db?: Database, options: AuthOptions = { appOrigin: 'http://127.0.0.1:5180', production: false, allowSimulatedEvents: false }, email?: EmailOptions, ai?: AiOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': options.production ? [] : null } } }));
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId as string);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (db && email) app.use('/api/webhooks', webhookRoute(db, email));
  app.use(express.json({ limit: '32kb' }));
  if (db && email) app.use('/api/public', publicEmailRoutes(db));
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'stylesense-api' });
  });
  app.get('/api/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable.', requestId: res.locals.requestId } });
    }
  });
  if (db) {
    const authentication = auth(db, options);
    app.use('/api/auth', authentication.router);
    app.use('/api', authentication.requireOrigin, authentication.requireSession, businessRoutes(db, options.allowSimulatedEvents && !options.production));
    if (email) app.use('/api', emailRoutes(db, email));
    if (ai) app.use('/api', aiRoutes(db, ai));
  }
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId } });
  });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, requestId: res.locals.requestId } });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })), requestId: res.locals.requestId } });
      return;
    }
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
    if (['P2002', 'P2003', 'P2025', 'P2034'].includes(String(databaseCode))) {
      const status = databaseCode === 'P2025' ? 404 : 409;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'CONFLICT', message: status === 404 ? 'Resource not found.' : 'The request conflicts with existing data. Refresh and try again.', requestId: res.locals.requestId } });
      return;
    }
    const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : '';
    const status = type === 'entity.parse.failed' ? 400 : type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ error: {
      code: status === 400 ? 'INVALID_JSON' : status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
      message: status === 400 ? 'Request body must be valid JSON.' : status === 413 ? 'Request body is too large.' : 'An unexpected error occurred.',
      requestId: res.locals.requestId,
    } });
  };
  app.use(errorHandler);
  return app;
}
