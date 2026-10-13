import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Icp } from './validation.js';

const configSchema = z.object({
  version: z.string().min(1),
  fit: z.object({ industry: z.number().int().nonnegative(), region: z.number().int().nonnegative(), companySize: z.number().int().nonnegative(), title: z.number().int().nonnegative() }).strict(),
  engagement: z.object({ opened: z.number().int().nonnegative(), interested: z.number().int(), needsInfo: z.number().int(), notNow: z.number().int(), wrongPerson: z.number().int() }).strict(),
  minimum: z.literal(0), maximum: z.literal(100), suppressedScore: z.literal(0),
}).strict();
export const scoringConfig = configSchema.parse(JSON.parse(readFileSync(new URL('../../../config/scoring.json', import.meta.url), 'utf8')));
export const scoringVersion = `${scoringConfig.version}:${createHash('sha256').update(JSON.stringify(scoringConfig)).digest('hex').slice(0, 12)}`;
export type ScoreEvent = { id: string; type: string; intent: string | null; occurredAt: Date };
export type FitInput = { industry: string | null; region: string | null; size: number | null; title: string | null; icp: Icp };
const normalized = (value: string) => value.trim().toLowerCase();
const matches = (value: string | null, choices: string[]) => value !== null && choices.some(choice => normalized(choice) === normalized(value));

export function calculateScore(input: FitInput, events: ScoreEvent[], suppressed = false, config = scoringConfig) {
  const c = input.icp;
  const fitComponents = {
    industry: matches(input.industry, c.industries) ? config.fit.industry : 0,
    region: matches(input.region, c.regions) ? config.fit.region : 0,
    companySize: input.size !== null && (c.minCompanySize !== undefined || c.maxCompanySize !== undefined) && (c.minCompanySize === undefined || input.size >= c.minCompanySize) && (c.maxCompanySize === undefined || input.size <= c.maxCompanySize) ? config.fit.companySize : 0,
    title: matches(input.title, c.titles) ? config.fit.title : 0,
  };
  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  const replies = ordered.filter(event => event.type === 'REPLIED');
  const lastReply = replies.at(-1);
  const opened = ordered.some(event => event.type === 'OPENED');
  const optedOut = suppressed || ordered.some(event => event.type === 'UNSUBSCRIBED' || event.intent === 'UNSUBSCRIBE');
  const weights: Record<string, number> = { INTERESTED: config.engagement.interested, NEEDS_INFO: config.engagement.needsInfo, NOT_NOW: config.engagement.notNow, WRONG_PERSON: config.engagement.wrongPerson, UNSUBSCRIBE: 0 };
  const engagement = (opened ? config.engagement.opened : 0) + (lastReply?.intent ? (weights[lastReply.intent] ?? 0) : 0);
  const fit = Object.values(fitComponents).reduce((sum, value) => sum + value, 0);
  const total = optedOut ? config.suppressedScore : Math.max(config.minimum, Math.min(config.maximum, fit + engagement));
  const status = optedOut ? 'UNSUBSCRIBED' : lastReply ? 'REPLIED' : opened ? 'OPENED' : ordered.some(event => event.type === 'DELIVERED') ? 'DELIVERED' : ordered.some(event => event.type === 'SENT') ? 'SENT' : 'NEW';
  return { total, fit, engagement, status, fitComponents, opened, latestReplyIntent: lastReply?.intent ?? null, suppressed: optedOut };
}
