import { z } from 'zod';
import { fingerprint, providerJson, type SourcePage } from './network.js';
import type { Candidate, Classification } from './schemas.js';

export type ToolCall = { type: 'function_call'; name: string; arguments: string; call_id: string };
export type ModelItem = Record<string, unknown>;
export interface ModelProvider { name: string; model: string; simulated: boolean; turn(instructions: string, input: ModelItem[], tools: unknown[], signal: AbortSignal): Promise<ModelItem[]> }
export interface ResearchProvider { search(query: string, signal: AbortSignal): Promise<{ url: string; title: string }[]>; fetch(url: string, signal: AbortSignal): Promise<SourcePage> }
const outputSchema = z.object({ status: z.literal('completed'), output: z.array(z.record(z.string(), z.unknown())).max(30) });
export const callSchema = z.object({ type: z.literal('function_call'), name: z.string().max(100), arguments: z.string().max(60000), call_id: z.string().min(1).max(200) });
export class OpenAIModel implements ModelProvider {
  name = 'openai'; simulated = false;
  constructor(private key: string, public model: string, private transport: typeof fetch = fetch) {}
  async turn(instructions: string, input: ModelItem[], tools: unknown[], signal: AbortSignal) {
    const raw = await providerJson('https://api.openai.com/v1/responses', this.key, { model: this.model, store: false, instructions, input, tools, tool_choice: 'required', parallel_tool_calls: false, max_output_tokens: 6000 }, signal, this.transport);
    return outputSchema.parse(raw).output;
  }
}
export class TavilyResearch implements ResearchProvider {
  constructor(private key: string, private fetchSource: ResearchProvider['fetch'], private transport: typeof fetch = fetch) {}
  async search(query: string, signal: AbortSignal) {
    const raw = await providerJson('https://api.tavily.com/search', this.key, { query, search_depth: 'basic', max_results: 10, include_answer: false, include_raw_content: false }, signal, this.transport);
    return z.object({ results: z.array(z.object({ url: z.string().url().max(2000), title: z.string().max(1000) })).max(20) }).parse(raw).results;
  }
  fetch(url: string, signal: AbortSignal) { return this.fetchSource(url, signal); }
}
// Conservative literal opt-out handling remains available even when the model is down.
export function explicitOptOut(text: string) { return /\b(unsubscribe|opt[ -]?out|remove me|stop (?:emailing|contacting|sending)|do not (?:email|contact)|don't (?:email|contact))\b/i.test(text); }
export function mockClassification(text: string, firstName = 'there', company = 'your company'): Classification {
  let intent: Classification['intent'] = 'NEEDS_INFO';
  if (explicitOptOut(text)) intent = 'UNSUBSCRIBE';
  else if (/\b(wrong person|not (?:the|your) (?:right )?person|not my (?:area|responsibility)|someone else|not responsible)\b/i.test(text)) intent = 'WRONG_PERSON';
  else if (/\b(not now|not interested|later|next (?:quarter|year)|no budget|not a priority|not ready)\b/i.test(text)) intent = 'NOT_NOW';
  else if (/\b(send|share|details|information|pricing|how|more|explain)\b/i.test(text)) intent = 'NEEDS_INFO';
  else if (/\b(interested|let.s (?:talk|meet|schedule)|demo|call|sounds good|yes)\b/i.test(text)) intent = 'INTERESTED';
  const body = { INTERESTED: 'Thank you for your interest. What would be a convenient time to discuss your priorities?', NEEDS_INFO: 'Thank you for your question. Which aspect would you like us to clarify so we can provide relevant information?', NOT_NOW: 'Thank you for letting us know. We will respect your timing.', WRONG_PERSON: 'Thank you for clarifying. We will avoid assuming that this is your responsibility.', UNSUBSCRIBE: '' }[intent];
  return { intent, rationale: 'Local deterministic demonstration classifier; not a live model prediction.', draft: intent === 'UNSUBSCRIBE' ? null : `Hi ${firstName},\n\n${body}\n\nOur previous conversation concerned ${company}.\n\nBest,\nStyleSense team` };
}
export function mockCandidate(index: number): Candidate {
  const name = `Demo Apparel ${index}`; const domain = `fixture-${index}.example.test`; const sourceUrl = `https://${domain}/team`; const firstName = `Demo${index}`;
  const excerpt = `${name} is an Apparel company in India with 100 employees. ${firstName} Example is Buyer at ${name}. Our team is addressing overstock.`;
  return { company: { name, domain, industry: 'Apparel', region: 'India', size: 100 }, contact: { firstName, lastName: 'Example', title: 'Buyer', email: null }, facts: ['company.name', 'company.industry', 'company.region', 'company.size', 'contact.name', 'contact.title'].map(field => ({ field: field as Candidate['facts'][number]['field'], sourceUrl, excerpt })), outreach: [{ token: 'pain_point_category', value: 'overstock', sourceUrl, excerpt }] };
}
export class MockResearch implements ResearchProvider {
  async search() { return Array.from({ length: 10 }, (_, i) => ({ url: mockCandidate(i + 1).facts[0]!.sourceUrl, title: `Synthetic fixture ${i + 1}` })); }
  async fetch(url: string) {
    const candidate = Array.from({ length: 10 }, (_, i) => mockCandidate(i + 1)).find(item => item.facts[0]!.sourceUrl === url);
    if (!candidate) throw new Error('Unknown fixture URL.');
    const text = candidate.facts[0]!.excerpt;
    return { url, text, fetchedAt: new Date().toISOString(), contentHash: fingerprint(text), simulated: true };
  }
}
export class MockModel implements ModelProvider {
  name = 'mock'; model = 'deterministic-demo-v1'; simulated = true;
  async turn(_instructions: string, input: ModelItem[]) {
    const task = JSON.parse(String(input[0]?.content)) as { task: string; count?: number; text?: string; context?: { firstName: string; company: string } };
    const outputs = input.filter(item => item.type === 'function_call_output');
    const call = (name: string, value: unknown): ModelItem[] => [{ type: 'function_call', name, call_id: `mock-${outputs.length}`, arguments: JSON.stringify(value) }];
    if (task.task === 'reply') return call('classify_reply', mockClassification(task.text ?? '', task.context?.firstName, task.context?.company));
    if (!outputs.length) return call('search', { query: 'Synthetic demonstration fixtures' });
    const count = task.count ?? 5;
    if (outputs.length <= count) return call('fetch', { url: mockCandidate(outputs.length).facts[0]!.sourceUrl });
    return call('finish_discovery', { candidates: Array.from({ length: count }, (_, i) => mockCandidate(i + 1)) });
  }
}
export type AiOptions = { model: ModelProvider; research: ResearchProvider; production: boolean };
