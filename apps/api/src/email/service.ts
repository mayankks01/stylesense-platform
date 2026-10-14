import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import type { EmailMessage, EventType } from '../generated/prisma/client.js';
import { ApiError, notFound } from '../errors.js';
import { json, lockLead, recompute, transaction, type Transaction } from '../score-service.js';
import { emailHtml, renderTemplate, evidenceSchema, type GroundingIssue } from './template.js';
import { ProviderError, isTestRecipient, type EmailProvider } from './provider.js';

export type EmailOptions = { provider: EmailProvider; publicBaseUrl: string; from: string; senderName: string; proposedTimeWindow?: string; webhookSecret?: string; production: boolean };
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const messageView = (message: EmailMessage) => ({ id: message.id, leadId: message.leadId, campaignId: message.campaignId, recipient: message.recipient, from: message.fromAddress, subject: message.subject, body: message.body, html: message.html, provider: message.provider, providerId: message.providerId, status: message.sendStatus, attempts: message.attemptCount, acceptedAt: message.acceptedAt, createdAt: message.createdAt, lastError: message.lastError, simulated: message.provider === 'mock' });

export async function logIssues(db: Database | Transaction, ownerId: string, leadId: string, issues: GroundingIssue[]) {
  if (issues.length) await db.groundingLog.createMany({ data: issues.map(issue => ({ ownerId, leadId, ...issue })) });
}

export async function preview(db: Database, ownerId: string, campaignId: string, leadId: string, variant: 1 | 2 | 3, options: EmailOptions) {
  const enrollment = await db.campaignLead.findFirst({ where: { campaignId, leadId, ownerId }, include: { lead: { include: { company: true, outreachEvidence: true } } } });
  if (!enrollment) notFound();
  const { lead } = enrollment;
  const evidence = lead.outreachEvidence.map(({ token, value, sourceUrl, excerpt }) => evidenceSchema.parse({ token, value, sourceUrl, excerpt }));
  const rendered = renderTemplate({ firstName: lead.firstName, leadSourceUrl: lead.sourceUrl, companyName: lead.company.name, companySourceUrl: lead.company.sourceUrl, evidence, senderName: options.senderName, proposedTimeWindow: options.proposedTimeWindow }, variant);
  await logIssues(db, ownerId, leadId, rendered.issues);
  return rendered;
}

export async function prepareMessage(db: Database, ownerId: string, campaignId: string, leadId: string, variant: 1 | 2 | 3, key: string, options: EmailOptions) {
  const fingerprint = tokenHash(JSON.stringify({ campaignId, leadId, variant }));
  const prior = await db.emailMessage.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } } });
  if (prior) {
    if (prior.requestFingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key belongs to a different message request.');
    return prior;
  }
  const rendered = await preview(db, ownerId, campaignId, leadId, variant, options);
  if (!rendered.sendable || !rendered.subject) throw new ApiError(422, 'GROUNDING_BLOCKED', 'No grounded subject or required identity is available. Review grounding logs and stored evidence.');
  return transaction(db, async tx => {
    await lockLead(tx, ownerId, leadId);
    const existing = await tx.emailMessage.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: key } } });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key belongs to a different message request.');
      return existing;
    }
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const id = randomUUID();
    const openToken = randomBytes(32).toString('hex'); const unsubscribeToken = randomBytes(32).toString('hex');
    const unsubscribeUrl = `${options.publicBaseUrl}/api/public/unsubscribe/${unsubscribeToken}`;
    const pixelUrl = `${options.publicBaseUrl}/api/public/open/${openToken}.gif`;
    return tx.emailMessage.create({ data: {
      id, ownerId, campaignId, leadId, recipient: `delivered+${id}@resend.dev`, leadEmailSnapshot: lead.email,
      subject: rendered.subject!, body: `${rendered.body}\n\nUnsubscribe: ${unsubscribeUrl}`, html: emailHtml(rendered.body, unsubscribeUrl, pixelUrl), unsubscribeUrl,
      fromAddress: options.from, provider: options.provider.name, requestFingerprint: fingerprint, idempotencyKey: key,
      groundingSnapshot: json(rendered), openTokenHash: tokenHash(openToken), unsubscribeTokenHash: tokenHash(unsubscribeToken),
    } });
  });
}

async function isSuppressed(tx: Transaction, message: EmailMessage) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: message.leadId } });
  const addresses = [message.recipient, message.leadEmailSnapshot, lead.email].filter((value): value is string => !!value);
  return !!await tx.suppression.findFirst({ where: { ownerId: message.ownerId, email: { in: addresses } } }) || !!await tx.emailEvent.findFirst({ where: { ownerId: message.ownerId, leadId: message.leadId, OR: [{ type: 'UNSUBSCRIBED' }, { intent: 'UNSUBSCRIBE' }] } });
}

export async function recordMessageEvent(tx: Transaction, message: EmailMessage, type: EventType, source: string, dedupeKey: string, occurredAt: Date, payload: unknown) {
  const previous = await tx.emailEvent.findUnique({ where: { ownerId_source_dedupeKey: { ownerId: message.ownerId, source, dedupeKey } } });
  if (previous) {
    if (previous.messageId !== message.id || previous.type !== type) throw new ApiError(409, 'EVENT_CONFLICT', 'Event key was used for a different message or event.');
    return previous;
  }
  const event = await tx.emailEvent.create({ data: { ownerId: message.ownerId, leadId: message.leadId, messageId: message.id, type, source, dedupeKey, occurredAt, payload: json(payload) } });
  await recompute(tx, message.ownerId, message.leadId, `${source}: ${type.toLowerCase()}`, event.id);
  return event;
}

export async function sendMessage(db: Database, ownerId: string, id: string, options: EmailOptions) {
  const claim = await transaction(db, async tx => {
    const found = await tx.emailMessage.findFirst({ where: { id, ownerId } });
    if (!found) notFound();
    await lockLead(tx, ownerId, found.leadId);
    const message = await tx.emailMessage.findUniqueOrThrow({ where: { id } });
    if (message.sendStatus === 'ACCEPTED') return message;
    if (message.provider !== options.provider.name || !message.openTokenHash || !message.unsubscribeTokenHash || !isTestRecipient(message.recipient)) throw new ApiError(409, 'MESSAGE_CONFIGURATION_CHANGED', 'Prepare a new sandbox message under the current provider configuration.');
    if (message.sendStatus === 'BLOCKED') throw new ApiError(409, 'SUPPRESSED', 'This message is blocked by an unsubscribe.');
    if (message.leaseUntil && message.leaseUntil > new Date()) throw new ApiError(409, 'SEND_IN_PROGRESS', 'A send is already in progress.');
    // Resend retains idempotency keys for 24 hours. Never resend uncertain old attempts.
    if (message.firstAttemptAt && Date.now() - message.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000) throw new ApiError(409, 'RECONCILIATION_REQUIRED', 'The safe retry window has ended. Reconcile this attempt with the provider before any new send.');
    if (await isSuppressed(tx, message)) return tx.emailMessage.update({ where: { id }, data: { sendStatus: 'BLOCKED', lastError: 'SUPPRESSED' } });
    return tx.emailMessage.update({ where: { id }, data: { sendStatus: 'SENDING', firstAttemptAt: message.firstAttemptAt ?? new Date(), leaseUntil: new Date(Date.now() + 60000), attemptCount: { increment: 1 }, lastError: null } });
  });
  if (claim.sendStatus === 'ACCEPTED') return claim;
  if (claim.sendStatus === 'BLOCKED') throw new ApiError(409, 'SUPPRESSED', 'Unsubscribed recipients cannot receive further outreach.');
  try {
    // Do not wrap this transaction in the automatic retry helper: it contains an external side effect.
    // Holding the lead lock serializes unsubscribe with the final suppression check and submission.
    return await db.$transaction(async tx => {
      await lockLead(tx, ownerId, claim.leadId);
      if (await isSuppressed(tx, claim)) return tx.emailMessage.update({ where: { id }, data: { sendStatus: 'BLOCKED', lastError: 'SUPPRESSED', leaseUntil: null } });
      const result = await options.provider.send({ id: claim.id, from: claim.fromAddress, to: claim.recipient, subject: claim.subject, text: claim.body, html: claim.html, unsubscribeUrl: claim.unsubscribeUrl });
      const acceptedAt = new Date();
      const updated = await tx.emailMessage.update({ where: { id }, data: { providerId: result.id, sendStatus: 'ACCEPTED', acceptedAt, leaseUntil: null, lastError: null } });
      await recordMessageEvent(tx, updated, 'SENT', options.provider.name, `accepted:${id}`, acceptedAt, { providerAccepted: true, simulated: options.provider.name === 'mock' });
      return updated;
    }, { timeout: 20000, maxWait: 5000 });
  } catch (error) {
    const uncertain = !(error instanceof ProviderError) || error.uncertain;
    const code = error instanceof ProviderError ? error.code : 'SEND_OUTCOME_UNCERTAIN';
    await db.emailMessage.updateMany({ where: { id, ownerId, sendStatus: 'SENDING' }, data: { sendStatus: uncertain ? 'UNCERTAIN' : 'FAILED', lastError: code, leaseUntil: null } });
    throw new ApiError(502, code, uncertain ? 'The send outcome is uncertain. Retry only this same message within the safe retry window.' : 'The provider rejected the send. No successful send was recorded.');
  }
}

export async function unsubscribe(db: Database, message: EmailMessage) {
  return transaction(db, async tx => {
    await lockLead(tx, message.ownerId, message.leadId);
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: message.leadId } });
    for (const email of new Set([message.recipient, message.leadEmailSnapshot, lead.email].filter((value): value is string => !!value))) {
      await tx.suppression.upsert({ where: { ownerId_email: { ownerId: message.ownerId, email } }, create: { ownerId: message.ownerId, email, reason: 'Unsubscribe link' }, update: {} });
    }
    return recordMessageEvent(tx, message, 'UNSUBSCRIBED', 'unsubscribe', `unsubscribe:${message.id}`, new Date(), { simulated: message.provider === 'mock' });
  });
}
