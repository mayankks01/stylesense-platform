import type { Prisma } from './generated/prisma/client.js';
import type { Database } from './db.js';
import { calculateScore, scoringConfig, scoringVersion } from './scoring.js';
import { icpSchema } from './validation.js';
import { notFound } from './errors.js';

export type Transaction = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function transaction<T>(db: Database, operation: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(operation, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) {
      if (attempt < 3 && typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034') continue;
      throw error;
    }
  }
}
export async function lockLead(tx: Transaction, ownerId: string, leadId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Lead" WHERE "id" = ${leadId}::uuid AND "ownerId" = ${ownerId}::uuid FOR UPDATE`;
  if (!rows.length) notFound();
}
export async function recompute(tx: Transaction, ownerId: string, leadId: string, reason: string, triggerEventId?: string) {
  const lead = await tx.lead.findFirst({ where: { id: leadId, ownerId }, include: { company: true, score: true, events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] } } });
  if (!lead) notFound();
  const suppressed = lead.email ? !!await tx.suppression.findUnique({ where: { ownerId_email: { ownerId, email: lead.email } } }) : false;
  const input = { industry: lead.company.industry, region: lead.company.region, size: lead.company.size, title: lead.title, icp: icpSchema.parse(lead.icp) };
  const result = calculateScore(input, lead.events, suppressed);
  const data = { ownerId, total: result.total, fit: result.fit, engagement: result.engagement, status: result.status, configVersion: scoringVersion };
  await tx.leadScore.upsert({ where: { leadId }, create: { leadId, ...data }, update: data });
  await tx.scoreHistory.create({ data: {
    ownerId, leadId, triggerEventId, previousTotal: lead.score?.total ?? null,
    total: result.total, fit: result.fit, engagement: result.engagement, status: result.status,
    reason: `${reason}; fit ${result.fit}, engagement ${result.engagement}${result.suppressed ? '; suppressed' : ''}`,
    config: json(scoringConfig), inputs: json({ fit: input, eventIds: lead.events.map(event => event.id), suppressed, breakdown: result }),
  } });
  return result;
}
