import { z } from 'zod';

export const idSchema = z.string().uuid();
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const sourceSchema = z.string().trim().url().max(2000).refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS source URL');
export const icpSchema = z.object({
  industries: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  regions: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  titles: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  minCompanySize: z.number().int().min(1).max(100_000_000).optional(),
  maxCompanySize: z.number().int().min(1).max(100_000_000).optional(),
}).strict().refine(value => value.minCompanySize === undefined || value.maxCompanySize === undefined || value.minCompanySize <= value.maxCompanySize, 'Company size bounds are reversed');
export type Icp = z.infer<typeof icpSchema>;
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
export const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Use a domain without a URL path'),
  industry: optionalText(100), region: optionalText(100),
  size: z.number().int().min(1).max(100_000_000).nullable().optional(),
  sourceUrl: sourceSchema.nullable().optional(),
}).strict();
export const leadSchema = z.object({
  companyId: idSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: emailSchema.nullable().optional(),
  title: optionalText(160),
  sourceUrl: sourceSchema,
  icp: icpSchema,
}).strict();
export const campaignSchema = z.object({ name: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default(''), icp: icpSchema }).strict();
export const eventSchema = z.object({
  type: z.enum(['SENT', 'DELIVERED', 'OPENED', 'REPLIED', 'UNSUBSCRIBED']),
  intent: z.enum(['INTERESTED', 'NEEDS_INFO', 'NOT_NOW', 'WRONG_PERSON', 'UNSUBSCRIBE']).optional(),
  dedupeKey: z.string().trim().min(8).max(128),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  text: z.string().max(10000).optional(),
}).strict().refine(value => value.type === 'REPLIED' ? value.intent !== undefined : value.intent === undefined, 'Only replies require intent');
