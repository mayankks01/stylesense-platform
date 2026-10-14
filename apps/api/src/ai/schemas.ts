import { z } from 'zod';
import { companySchema, emailSchema, icpSchema, sourceSchema } from '../validation.js';
import { evidenceSchema } from '../email/template.js';
export const intentSchema = z.enum(['INTERESTED', 'NEEDS_INFO', 'NOT_NOW', 'WRONG_PERSON', 'UNSUBSCRIBE']);
export const classificationSchema = z.object({ intent: intentSchema, rationale: z.string().min(1).max(1000), draft: z.string().min(1).max(4000).nullable() }).strict();
export type Classification = z.infer<typeof classificationSchema>;
export const discoveryInput = z.object({ icp: icpSchema, count: z.number().int().min(5).max(10).default(5) }).strict();
export const factSchema = z.object({ field: z.enum(['company.name', 'company.industry', 'company.region', 'company.size', 'contact.name', 'contact.title', 'contact.email']), sourceUrl: sourceSchema, excerpt: z.string().min(1).max(2000) }).strict();
export const candidateSchema = z.object({
  company: companySchema.omit({ sourceUrl: true }).extend({ industry: z.string().min(1).max(100).nullable(), region: z.string().min(1).max(100).nullable(), size: z.number().int().min(1).max(100000000).nullable() }),
  contact: z.object({ firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100), title: z.string().min(1).max(160).nullable(), email: emailSchema.nullable() }).strict(),
  facts: z.array(factSchema).min(2).max(7), outreach: z.array(evidenceSchema).max(8),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const discoveryOutput = z.object({ candidates: z.array(candidateSchema).max(10) }).strict();
export const searchInput = z.object({ query: z.string().trim().min(3).max(300) }).strict();
export const fetchInput = z.object({ url: sourceSchema }).strict();
export const keySchema = z.string().min(8).max(128).regex(/^[\w-]+$/);
export const tool = (name: string, description: string, schema: z.ZodType) => ({ type: 'function', name, description, parameters: z.toJSONSchema(schema), strict: false });
export const discoveryTools = [tool('search', 'Search public websites for the supplied ICP. Results are leads to investigate, not evidence.', searchInput), tool('fetch', 'Fetch a URL returned by search. Cite only the returned text and final URL.', fetchInput), tool('finish_discovery', 'Return candidates backed by fetched text. Return fewer candidates or none when evidence is missing.', discoveryOutput)];
export const replyTool = tool('classify_reply', 'Classify the reply and propose a contextual draft for human review; never send.', classificationSchema);
