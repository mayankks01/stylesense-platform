import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Webhook } from 'svix';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { idSchema, pageSchema } from '../validation.js';
import { lockLead, transaction } from '../score-service.js';
import { evidenceSchema, escapeHtml } from './template.js';
import { logIssues, messageView, prepareMessage, preview, recordMessageEvent, sendMessage, tokenHash, unsubscribe, type EmailOptions } from './service.js';

const variantSchema = z.object({ subjectVariant: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }).strict();
const capabilitySchema = z.string().regex(/^[a-f0-9]{64}$/);

export function emailRoutes(db: Database, options: EmailOptions) {
  const router = Router();
  router.get('/leads/:id/outreach-evidence', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    res.json({ data: await db.outreachEvidence.findMany({ where: { leadId, ownerId }, orderBy: { token: 'asc' } }) });
  });
  router.put('/leads/:id/outreach-evidence', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    const body = evidenceSchema.parse(req.body);
    if (!body.excerpt.includes(body.value) || /[\r\n\x00-\x1f{}]/.test(body.value)) {
      await logIssues(db, ownerId, leadId, [{ token: body.token, reason: 'Submitted value is not supported by its source excerpt or contains unsafe content.', action: 'blocked' }]);
      throw new ApiError(422, 'GROUNDING_BLOCKED', 'Evidence must contain the exact proposed value and no template or header control characters.');
    }
    const data = await db.outreachEvidence.upsert({ where: { leadId_token: { leadId, token: body.token } }, create: { ...body, leadId, ownerId }, update: body });
    res.json({ data });
  });
  router.get('/leads/:id/grounding-logs', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    const { page, limit } = pageSchema.strict().parse(req.query);
    const where = { ownerId, leadId };
    const [data, total] = await db.$transaction([db.groundingLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: (page - 1) * limit }), db.groundingLog.count({ where })]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });
  router.post('/campaigns/:campaignId/leads/:leadId/email-preview', async (req, res) => {
    const campaignId = idSchema.parse(req.params.campaignId); const leadId = idSchema.parse(req.params.leadId);
    const body = variantSchema.parse(req.body ?? {});
    res.json({ data: await preview(db, res.locals.userId, campaignId, leadId, body.subjectVariant, options) });
  });
  router.post('/campaigns/:campaignId/leads/:leadId/messages', async (req, res) => {
    const campaignId = idSchema.parse(req.params.campaignId); const leadId = idSchema.parse(req.params.leadId);
    const body = variantSchema.parse(req.body ?? {});
    const key = z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/).parse(req.get('idempotency-key'));
    const message = await prepareMessage(db, res.locals.userId, campaignId, leadId, body.subjectVariant, key, options);
    res.status(201).json({ data: messageView(message) });
  });
  router.get('/messages', async (req, res) => {
    const { page, limit, leadId, campaignId } = pageSchema.extend({ leadId: idSchema.optional(), campaignId: idSchema.optional() }).strict().parse(req.query);
    const where = { ownerId: res.locals.userId as string, leadId, campaignId };
    const [messages, total] = await db.$transaction([db.emailMessage.findMany({ where, take: limit, skip: (page - 1) * limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }), db.emailMessage.count({ where })]);
    res.json({ data: messages.map(messageView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });
  router.get('/messages/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const message = await db.emailMessage.findFirst({ where: { id, ownerId: res.locals.userId } });
    if (!message) notFound();
    res.json({ data: { ...messageView(message), grounding: message.groundingSnapshot } });
  });
  router.post('/messages/:id/send', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    z.object({}).strict().parse(req.body ?? {});
    const result = await sendMessage(db, res.locals.userId, id, options);
    if (result.sendStatus === 'BLOCKED') throw new ApiError(409, 'SUPPRESSED', 'Unsubscribed recipients cannot receive further outreach.');
    res.json({ data: messageView(result) });
  });
  router.post('/messages/:id/simulate-delivery', async (req, res) => {
    if (options.provider.name !== 'mock' || options.production) notFound();
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    z.object({}).strict().parse(req.body ?? {});
    const message = await db.emailMessage.findFirst({ where: { id, ownerId, provider: 'mock', sendStatus: 'ACCEPTED' } });
    if (!message) notFound();
    const event = await transaction(db, async tx => { await lockLead(tx, ownerId, message.leadId); return recordMessageEvent(tx, message, 'DELIVERED', 'mock', `delivered:${id}`, new Date(), { simulated: true }); });
    res.json({ data: event });
  });
  return router;
}

const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
export function publicEmailRoutes(db: Database) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.get('/open/:token.gif', async (req, res) => {
    const parsed = capabilitySchema.safeParse(req.params.token);
    if (parsed.success && req.method === 'GET') {
      const message = await db.emailMessage.findUnique({ where: { openTokenHash: tokenHash(parsed.data) } });
      if (message?.sendStatus === 'ACCEPTED') await transaction(db, async tx => {
        await lockLead(tx, message.ownerId, message.leadId);
        await recordMessageEvent(tx, message, 'OPENED', 'pixel', randomUUID(), new Date(), { simulated: message.provider === 'mock', signal: 'image_request_not_verified_human' });
      });
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.type('gif').send(pixel);
  });
  const lookup = async (token: unknown) => {
    const parsed = capabilitySchema.safeParse(token);
    const message = parsed.success ? await db.emailMessage.findUnique({ where: { unsubscribeTokenHash: tokenHash(parsed.data) } }) : null;
    if (!message) notFound();
    return message;
  };
  router.get('/unsubscribe/:token', async (req, res) => {
    await lookup(req.params.token);
    res.type('html').send(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe · StyleSense AI</title></head><body><main><h1>Unsubscribe from StyleSense AI</h1><p>Confirm below to stop future outreach. No sign-in is needed.</p><form method="post" action="/api/public/unsubscribe/${escapeHtml(String(req.params.token))}"><button type="submit">Unsubscribe</button></form></main></body></html>`);
  });
  router.post('/unsubscribe/:token', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
    const message = await lookup(req.params.token);
    await unsubscribe(db, message);
    res.type('html').send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed · StyleSense AI</title></head><body><main><h1>You are unsubscribed</h1><p>You will not receive further StyleSense AI outreach from this account.</p></main></body></html>');
  });
  return router;
}

export function webhookRoute(db: Database, options: EmailOptions) {
  const router = Router();
  router.post('/resend', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res) => {
    if (!options.webhookSecret || options.provider.name !== 'resend') throw new ApiError(503, 'WEBHOOK_NOT_CONFIGURED', 'Resend webhooks are not configured.');
    const id = req.get('svix-id'); const timestamp = req.get('svix-timestamp'); const signature = req.get('svix-signature');
    if (!id || id.length > 100 || !timestamp || !signature || !Buffer.isBuffer(req.body)) throw new ApiError(400, 'INVALID_WEBHOOK', 'Invalid webhook signature or payload.');
    let raw: unknown;
    try {
      const payload = req.body.toString('utf8');
      new Webhook(options.webhookSecret).verify(payload, { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });
      raw = JSON.parse(payload);
    }
    catch { throw new ApiError(400, 'INVALID_WEBHOOK', 'Invalid webhook signature or payload.'); }
    const envelope = z.object({ type: z.string(), created_at: z.iso.datetime({ offset: true }), data: z.object({ email_id: z.string().min(1).max(128) }).passthrough() }).passthrough().parse(raw);
    if (envelope.type !== 'email.delivered') { res.json({ received: true, ignored: true }); return; }
    const message = await db.emailMessage.findFirst({ where: { provider: 'resend', providerId: envelope.data.email_id } });
    // A delivery callback may beat the send transaction. Request a retry instead of losing it.
    if (!message) throw new ApiError(503, 'MESSAGE_NOT_RECORDED', 'Message acceptance is not recorded yet; retry delivery.');
    await transaction(db, async tx => { await lockLead(tx, message.ownerId, message.leadId); await recordMessageEvent(tx, message, 'DELIVERED', 'resend-webhook', id, new Date(envelope.created_at), envelope); });
    res.json({ received: true });
  });
  return router;
}
