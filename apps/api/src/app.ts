import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';

export function createApp(checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId as string);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
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
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.', requestId: res.locals.requestId } });
  });
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
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
