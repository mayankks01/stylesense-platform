import { Router } from 'express';
import { z } from 'zod';
import type { Database } from './db.js';
import { ApiError, notFound } from './errors.js';
import { campaignSchema, companySchema, eventSchema, idSchema, leadSchema, pageSchema } from './validation.js';
import { json, lockLead, recompute, transaction } from './score-service.js';
import type { Prisma } from './generated/prisma/client.js';

const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, pages: Math.ceil(total / limit) });
const nonempty = <T extends Record<string, unknown>>(value: T) => Object.keys(value).length > 0;

export function businessRoutes(db: Database, allowSimulatedEvents: boolean) {
  const router = Router();
  router.get('/companies', async (req, res) => {
    const { page, limit } = pageSchema.strict().parse(req.query);
    const where = { ownerId: res.locals.userId as string };
    const [data, total] = await db.$transaction([db.company.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }), db.company.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(page, limit, total) });
  });
  router.post('/companies', async (req, res) => {
    const body = companySchema.parse(req.body);
    res.status(201).json({ data: await db.company.create({ data: { ...body, ownerId: res.locals.userId } }) });
  });
  router.patch('/companies/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const body = companySchema.partial().refine(nonempty, 'At least one field is required').parse(req.body);
    const data = await transaction(db, async tx => {
      const company = await tx.company.findFirst({ where: { id, ownerId } });
      if (!company) notFound();
      const updated = await tx.company.update({ where: { id_ownerId: { id, ownerId } }, data: body });
      const leads = await tx.lead.findMany({ where: { ownerId, companyId: id }, orderBy: { id: 'asc' } });
      for (const lead of leads) { await lockLead(tx, ownerId, lead.id); await recompute(tx, ownerId, lead.id, 'Company attributes updated'); }
      return updated;
    });
    res.json({ data });
  });
  router.get('/leads', async (req, res) => {
    const query = pageSchema.extend({
      search: z.string().trim().max(100).optional(),
      status: z.enum(['NEW', 'SENT', 'DELIVERED', 'OPENED', 'REPLIED', 'UNSUBSCRIBED']).optional(),
      minScore: z.coerce.number().int().min(0).max(100).optional(),
      companyId: idSchema.optional(),
    }).strict().parse(req.query);
    const where: Prisma.LeadWhereInput = {
      ownerId: res.locals.userId, companyId: query.companyId,
      ...(query.status || query.minScore !== undefined ? { score: { is: { status: query.status, total: query.minScore !== undefined ? { gte: query.minScore } : undefined } } } : {}),
      ...(query.search ? { OR: ['firstName', 'lastName', 'email', 'title'].map(field => ({ [field]: { contains: query.search, mode: 'insensitive' } })) } : {}),
    };
    const [data, total] = await db.$transaction([
      db.lead.findMany({ where, include: { company: true, score: true }, orderBy: [{ score: { total: 'desc' } }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      db.lead.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(query.page, query.limit, total) });
  });
  router.post('/leads', async (req, res) => {
    const body = leadSchema.parse(req.body); const ownerId = res.locals.userId as string;
    const data = await transaction(db, async tx => {
      if (!await tx.company.findFirst({ where: { id: body.companyId, ownerId } })) notFound();
      const lead = await tx.lead.create({ data: { ...body, ownerId, icp: json(body.icp) } });
      await recompute(tx, ownerId, lead.id, 'Lead created');
      return tx.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { company: true, score: true } });
    });
    res.status(201).json({ data });
  });
  router.get('/leads/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const data = await db.lead.findFirst({ where: { id, ownerId: res.locals.userId }, include: { company: true, score: true } });
    if (!data) notFound();
    res.json({ data });
  });
  router.patch('/leads/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const body = leadSchema.omit({ companyId: true }).partial().refine(nonempty, 'At least one field is required').parse(req.body);
    const data = await transaction(db, async tx => {
      await lockLead(tx, ownerId, id);
      await tx.lead.update({ where: { id_ownerId: { id, ownerId } }, data: { ...body, ...(body.icp ? { icp: json(body.icp) } : {}) } });
      // Carry a permanent opt-out to any newly corrected email for this lead.
      if (body.email && await tx.emailEvent.findFirst({ where: { ownerId, leadId: id, OR: [{ type: 'UNSUBSCRIBED' }, { intent: 'UNSUBSCRIBE' }] } })) {
        await tx.suppression.upsert({ where: { ownerId_email: { ownerId, email: body.email } }, update: {}, create: { ownerId, email: body.email, reason: 'Lead previously unsubscribed' } });
      }
      await recompute(tx, ownerId, id, 'Lead attributes updated');
      return tx.lead.findUniqueOrThrow({ where: { id }, include: { company: true, score: true } });
    });
    res.json({ data });
  });
  router.get('/leads/:id/score-history', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const { page, limit } = pageSchema.strict().parse(req.query);
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    const where = { leadId, ownerId };
    const [data, total] = await db.$transaction([db.scoreHistory.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }), db.scoreHistory.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(page, limit, total) });
  });
  router.post('/leads/:id/recompute', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    z.object({}).strict().parse(req.body ?? {});
    const data = await transaction(db, async tx => { await lockLead(tx, ownerId, id); return recompute(tx, ownerId, id, 'Explicit history replay with current configuration'); });
    res.json({ data });
  });
  router.get('/events', async (req, res) => {
    const { page, limit, leadId, type } = pageSchema.extend({ leadId: idSchema.optional(), type: z.enum(['SENT', 'DELIVERED', 'OPENED', 'REPLIED', 'UNSUBSCRIBED']).optional() }).strict().parse(req.query);
    const ownerId = res.locals.userId as string;
    if (leadId && !await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    const where = { ownerId, leadId, type };
    const [data, total] = await db.$transaction([db.emailEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }), db.emailEvent.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(page, limit, total) });
  });
  router.post('/leads/:id/simulated-events', async (req, res) => {
    if (!allowSimulatedEvents) notFound();
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const body = eventSchema.parse(req.body);
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 60_000) throw new ApiError(400, 'VALIDATION_ERROR', 'Event timestamps cannot be in the future.');
    const result = await transaction(db, async tx => {
      await lockLead(tx, ownerId, leadId);
      const previous = await tx.emailEvent.findUnique({ where: { ownerId_source_dedupeKey: { ownerId, source: 'simulation', dedupeKey: body.dedupeKey } } });
      if (previous) {
        const payload = previous.payload as { text: string | null; simulated: boolean };
        if (previous.leadId !== leadId || previous.type !== body.type || previous.intent !== (body.intent ?? null) || (body.occurredAt && previous.occurredAt.getTime() !== occurredAt.getTime()) || payload.text !== (body.text ?? null) || !payload.simulated) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This event key was used for different input.');
        return { data: previous, replayed: true };
      }
      const event = await tx.emailEvent.create({ data: { ownerId, leadId, type: body.type, intent: body.intent, source: 'simulation', dedupeKey: body.dedupeKey, occurredAt, payload: { text: body.text ?? null, simulated: true } } });
      if (body.type === 'UNSUBSCRIBED' || body.intent === 'UNSUBSCRIBE') {
        const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
        if (lead.email) await tx.suppression.upsert({ where: { ownerId_email: { ownerId, email: lead.email } }, update: {}, create: { ownerId, email: lead.email, reason: 'Simulated unsubscribe' } });
      }
      await recompute(tx, ownerId, leadId, `Simulated ${body.type.toLowerCase()} event`, event.id);
      return { data: event, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  });
  router.get('/campaigns', async (req, res) => {
    const { page, limit } = pageSchema.strict().parse(req.query);
    const where = { ownerId: res.locals.userId as string };
    const [data, total] = await db.$transaction([db.campaign.findMany({ where, include: { _count: { select: { leads: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }), db.campaign.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(page, limit, total) });
  });
  router.post('/campaigns', async (req, res) => {
    const body = campaignSchema.parse(req.body);
    res.status(201).json({ data: await db.campaign.create({ data: { ...body, icp: json(body.icp), ownerId: res.locals.userId } }) });
  });
  router.get('/campaigns/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const data = await db.campaign.findFirst({ where: { id, ownerId: res.locals.userId }, include: { _count: { select: { leads: true } } } });
    if (!data) notFound();
    res.json({ data });
  });
  router.patch('/campaigns/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const body = campaignSchema.partial().refine(nonempty, 'At least one field is required').parse(req.body);
    const data = await transaction(db, async tx => {
      if (!await tx.campaign.findFirst({ where: { id, ownerId } })) notFound();
      return tx.campaign.update({ where: { id_ownerId: { id, ownerId } }, data: { ...body, ...(body.icp ? { icp: json(body.icp) } : {}) } });
    });
    res.json({ data });
  });
  router.get('/campaigns/:id/leads', async (req, res) => {
    const campaignId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const { page, limit } = pageSchema.strict().parse(req.query);
    if (!await db.campaign.findFirst({ where: { id: campaignId, ownerId } })) notFound();
    const where = { campaignId, ownerId };
    const [data, total] = await db.$transaction([db.campaignLead.findMany({ where, include: { lead: { include: { company: true, score: true } } }, orderBy: { leadId: 'asc' }, skip: (page - 1) * limit, take: limit }), db.campaignLead.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data, pagination: pagination(page, limit, total) });
  });
  router.post('/campaigns/:id/leads', async (req, res) => {
    const campaignId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const { leadId } = z.object({ leadId: idSchema }).strict().parse(req.body);
    const data = await transaction(db, async tx => {
      if (!await tx.campaign.findFirst({ where: { id: campaignId, ownerId } }) || !await tx.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
      return tx.campaignLead.upsert({ where: { campaignId_leadId: { campaignId, leadId } }, create: { campaignId, leadId, ownerId }, update: {} });
    });
    res.json({ data });
  });
  return router;
}
