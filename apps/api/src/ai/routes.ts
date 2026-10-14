import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Database } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { icpSchema, idSchema, pageSchema } from '../validation.js';
import { json, lockLead, recompute, transaction } from '../score-service.js';
import { discover, verifyCandidate, type DiscoveryResult } from './discovery.js';
import { discoveryInput, keySchema } from './schemas.js';
import { fingerprint, type SourcePage } from './network.js';
import type { AiOptions } from './providers.js';
import { simulateReply, suppressed } from './replies.js';

export function aiRoutes(db: Database, options: AiOptions) {
  const router = Router();
  const limited = rateLimit({ windowMs: 3600000, limit: 20, keyGenerator: (_req, res) => String(res.locals.userId), standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'AI_RATE_LIMIT', message: 'Hourly research/reply request limit reached. Try again later.' } }); } });
  router.get('/ai/settings', (_req, res) => { res.json({ data: { provider: options.model.name, model: options.model.model, simulated: options.model.simulated, replySimulationEnabled: !options.production } }); });
  router.post('/discovery', limited, async (req, res) => {
    const body = discoveryInput.parse(req.body); const key = keySchema.parse(req.get('idempotency-key')); const ownerId = res.locals.userId as string;
    const requestHash = fingerprint(JSON.stringify(body));
    const { run, fresh } = await transaction(db, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId}::uuid FOR UPDATE`;
      const prior = await tx.discoveryRun.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } } });
      if (prior) { if (prior.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This discovery key belongs to different input.'); return { run: prior, fresh: false }; }
      if (await tx.discoveryRun.findFirst({ where: { ownerId, status: 'RUNNING', createdAt: { gte: new Date(Date.now() - 120000) } } })) throw new ApiError(409, 'DISCOVERY_RUNNING', 'A discovery run is already in progress. Refresh its status.');
      const run = await tx.discoveryRun.create({ data: { ownerId, idempotencyKey: key, requestHash, icp: json(body.icp), requested: body.count, provider: options.model.name, model: options.model.model, simulated: options.model.simulated } });
      return { run, fresh: true };
    });
    if (!fresh) { res.json({ data: run }); return; }
    const progress: DiscoveryResult = { sources: [], trace: [], rejections: [], candidates: [] };
    try {
      const result = await discover(body.icp, body.count, options, AbortSignal.timeout(90000), progress);
      await db.$transaction(async tx => {
        for (const candidate of result.candidates) await tx.discoveryCandidate.create({ data: { ownerId, runId: run.id, fingerprint: candidate.fingerprint, data: json(candidate) } });
        await tx.discoveryRun.update({ where: { id: run.id }, data: { status: result.candidates.length >= body.count ? 'COMPLETE' : 'PARTIAL', sources: json(result.sources), trace: json(result.trace), rejections: json(result.rejections), completedAt: new Date() } });
      });
    } catch {
      await db.discoveryRun.update({ where: { id: run.id }, data: { status: 'FAILED', sources: json(progress.sources), trace: json(progress.trace), rejections: json(progress.rejections), error: 'Discovery could not finish within its validation, provider, or time limits. Review the trace and configuration before starting a new run.', completedAt: new Date() } });
    }
    res.status(201).json({ data: await db.discoveryRun.findUniqueOrThrow({ where: { id: run.id } }) });
  });
  router.get('/discovery', async (req, res) => {
    const { page, limit } = pageSchema.strict().parse(req.query); const where = { ownerId: res.locals.userId as string };
    const [data, total] = await db.$transaction([db.discoveryRun.findMany({ where, select: { id: true, status: true, requested: true, provider: true, model: true, simulated: true, createdAt: true, completedAt: true, error: true, _count: { select: { candidates: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: (page - 1) * limit }), db.discoveryRun.count({ where })]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });
  router.get('/discovery/:id', async (req, res) => {
    const id = idSchema.parse(req.params.id); const data = await db.discoveryRun.findFirst({ where: { id, ownerId: res.locals.userId }, include: { candidates: { orderBy: { id: 'asc' } } } }); if (!data) notFound(); res.json({ data });
  });
  router.post('/discovery/:id/import', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string; const { candidateId } = z.object({ candidateId: idSchema }).strict().parse(req.body);
    const data = await transaction(db, async tx => {
      const run = await tx.discoveryRun.findFirst({ where: { id, ownerId, status: { in: ['COMPLETE', 'PARTIAL'] } } }); if (!run) notFound();
      await tx.$queryRaw`SELECT "id" FROM "DiscoveryRun" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const row = await tx.discoveryCandidate.findFirst({ where: { id: candidateId, runId: id, ownerId } }); if (!row) notFound();
      if (row.importedLeadId) return { leadId: row.importedLeadId, reused: true };
      const stored = row.data as Record<string, unknown>;
      const candidate = verifyCandidate({ company: stored.company, contact: stored.contact, facts: stored.facts, outreach: stored.outreach }, run.sources as unknown as SourcePage[]);
      // Serialize imports for this account across runs, including domain/person deduplication.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${ownerId}::uuid FOR UPDATE`;
      const existing = await tx.lead.findUnique({ where: { ownerId_discoveryKey: { ownerId, discoveryKey: candidate.fingerprint } } });
      if (existing) { await tx.discoveryCandidate.update({ where: { id: row.id }, data: { importedLeadId: existing.id } }); return { leadId: existing.id, reused: true }; }
      const companyFact = candidate.verifiedFacts.find(fact => fact.field === 'company.name')!;
      let company = await tx.company.findUnique({ where: { ownerId_domain: { ownerId, domain: candidate.company.domain } } });
      if (company && company.name.toLowerCase() !== candidate.company.name.toLowerCase()) throw new ApiError(409, 'COMPANY_CONFLICT', 'An existing company uses this domain with a different name. Review it before importing.');
      if (!company) company = await tx.company.create({ data: { ...candidate.company, ownerId, sourceUrl: companyFact.sourceUrl } });
      const person = await tx.lead.findFirst({ where: { ownerId, companyId: company.id, firstName: { equals: candidate.contact.firstName, mode: 'insensitive' }, lastName: { equals: candidate.contact.lastName, mode: 'insensitive' } } });
      if (person) { await tx.discoveryCandidate.update({ where: { id: row.id }, data: { importedLeadId: person.id } }); return { leadId: person.id, reused: true }; }
      const lead = await tx.lead.create({ data: { ...candidate.contact, ownerId, companyId: company.id, sourceUrl: candidate.verifiedFacts.find(fact => fact.field === 'contact.name')!.sourceUrl, icp: json(icpSchema.parse(run.icp)), discoveryKey: candidate.fingerprint } });
      for (const fact of candidate.verifiedFacts) await tx.researchFact.create({ data: { ...fact, fetchedAt: new Date(fact.fetchedAt), ownerId, leadId: lead.id } });
      for (const item of candidate.outreach) await tx.outreachEvidence.create({ data: { ...item, ownerId, leadId: lead.id } });
      await recompute(tx, ownerId, lead.id, run.simulated ? 'Synthetic discovery fixture imported' : 'Researched lead imported');
      await tx.discoveryCandidate.update({ where: { id: row.id }, data: { importedLeadId: lead.id } }); return { leadId: lead.id, reused: false };
    });
    res.json({ data });
  });
  router.get('/leads/:id/research-facts', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound();
    res.json({ data: await db.researchFact.findMany({ where: { leadId, ownerId }, orderBy: { field: 'asc' } }) });
  });
  router.post('/leads/:id/replies', limited, async (req, res) => {
    if (options.production) throw new ApiError(403, 'SIMULATION_DISABLED', 'Reply simulation is disabled in production.');
    const leadId = idSchema.parse(req.params.id); const key = keySchema.parse(req.get('idempotency-key')); const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    res.status(201).json({ data: await simulateReply(db, res.locals.userId, leadId, text, key, options) });
  });
  router.get('/leads/:id/replies', async (req, res) => {
    const leadId = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string; const { page, limit } = pageSchema.strict().parse(req.query);
    if (!await db.lead.findFirst({ where: { id: leadId, ownerId } })) notFound(); const where = { ownerId, leadId };
    const [data, total] = await db.$transaction([db.replyAnalysis.findMany({ where, take: limit, skip: (page - 1) * limit, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }), db.replyAnalysis.count({ where })]);
    res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  });
  router.post('/replies/:id/review', async (req, res) => {
    const id = idSchema.parse(req.params.id); const ownerId = res.locals.userId as string;
    const body = z.discriminatedUnion('decision', [z.object({ decision: z.literal('approve'), draft: z.string().trim().min(1).max(4000) }).strict(), z.object({ decision: z.literal('dismiss') }).strict()]).parse(req.body);
    const data = await transaction(db, async tx => {
      const row = await tx.replyAnalysis.findFirst({ where: { id, ownerId } }); if (!row) notFound(); await lockLead(tx, ownerId, row.leadId);
      const current = await tx.replyAnalysis.findUniqueOrThrow({ where: { id } });
      if (await suppressed(tx, ownerId, current.leadId)) throw new ApiError(409, 'SUPPRESSED', 'This lead opted out. Response approval is blocked.');
      const next = body.decision === 'approve' ? 'APPROVED' : 'DISMISSED';
      if (current.status === next && (body.decision === 'dismiss' || current.reviewedDraft === body.draft)) return current;
      if (current.status !== 'PENDING_REVIEW') throw new ApiError(409, 'ALREADY_REVIEWED', 'This draft is no longer pending review.');
      return tx.replyAnalysis.update({ where: { id }, data: { status: next, reviewedDraft: body.decision === 'approve' ? body.draft : null, reviewedAt: new Date() } });
    });
    res.json({ data });
  });
  return router;
}
