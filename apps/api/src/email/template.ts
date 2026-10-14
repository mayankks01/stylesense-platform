import { z } from 'zod';
import { sourceSchema } from '../validation.js';

export const evidenceToken = z.enum(['observed_signal_short', 'observed_signal_sentence', 'company_segment', 'pain_point_category', 'specific_context_detail', 'one_line_relevance_hypothesis', 'quantified_outcome_optional', 'optional_soft_proof_point']);
export const evidenceSchema = z.object({ token: evidenceToken, value: z.string().trim().min(1).max(500), sourceUrl: sourceSchema, excerpt: z.string().trim().min(1).max(4000) }).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type TemplateInput = {
  firstName: string; leadSourceUrl: string; companyName: string; companySourceUrl: string | null;
  evidence: Evidence[]; senderName: string; proposedTimeWindow?: string;
};
export type GroundingIssue = { token: string; reason: string; action: 'omitted' | 'blocked' };
export const capabilityMap: Record<string, string> = {
  overstock: 'improve planning with AI demand forecasting',
  'heavy markdowns': 'improve planning with AI demand forecasting',
  'high return rates': 'improve size and fit prediction',
  'sizing complaints': 'improve size and fit prediction',
  'slow reaction to trends': 'respond to trends with trend intelligence',
  stockouts: 'improve inventory allocation across channels and stores',
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const clean = (value: string) => value.length > 0 && !/[\r\n\x00-\x1f{}]/.test(value);

// Tokens are selected from stored fields, never supplied by the send request or an LLM draft.
// Excerpt matching checks traceability, not the independent truth of a cited webpage.
export function renderTemplate(input: TemplateInput, variant: 1 | 2 | 3) {
  const issues: GroundingIssue[] = [];
  const tokens: Record<string, string> = {};
  const provenance: Record<string, unknown> = {};
  function stored(token: string, value: string, field: string, sourceUrl?: string | null) {
    if (!clean(value) || (sourceUrl !== undefined && !sourceSchema.safeParse(sourceUrl).success)) {
      issues.push({ token, reason: 'Stored value is missing provenance or contains unsafe token content.', action: 'blocked' }); return;
    }
    tokens[token] = value; provenance[token] = { field, ...(sourceUrl ? { sourceUrl } : {}) };
  }
  stored('first_name', input.firstName, 'lead.firstName', input.leadSourceUrl);
  stored('company_name', input.companyName, 'company.name', input.companySourceUrl);
  stored('sender_name', input.senderName, 'config.EMAIL_SENDER_NAME');
  if (input.proposedTimeWindow) stored('proposed_time_window', input.proposedTimeWindow, 'config.EMAIL_PROPOSED_TIME_WINDOW');
  for (const raw of input.evidence) {
    const parsed = evidenceSchema.safeParse(raw);
    if (!parsed.success || !clean(raw.value) || !raw.excerpt.includes(raw.value)) {
      issues.push({ token: raw.token, reason: 'Token value is not traceable to its stored source excerpt.', action: 'omitted' }); continue;
    }
    tokens[raw.token] = raw.value;
    provenance[raw.token] = { field: `outreachEvidence.${raw.token}`, sourceUrl: raw.sourceUrl, excerpt: raw.excerpt };
  }
  if (tokens.pain_point_category && capabilityMap[tokens.pain_point_category]) {
    tokens.value_prop_for_pain_point = capabilityMap[tokens.pain_point_category]!;
    provenance.value_prop_for_pain_point = { field: 'Appendix A capability map', basis: 'pain_point_category' };
  } else if (tokens.pain_point_category) {
    issues.push({ token: 'pain_point_category', reason: 'Pain point is outside the supported Appendix A mapping.', action: 'omitted' });
    delete tokens.pain_point_category;
  }
  function has(names: string[], action: 'omitted' | 'blocked') {
    let ok = true;
    for (const token of names) if (!tokens[token]) { ok = false; issues.push({ token, reason: 'No grounded value exists for this token.', action }); }
    return ok;
  }
  const subjectTokens = variant === 1 ? ['company_name', 'observed_signal_short'] : variant === 2 ? ['company_name', 'pain_point_category'] : ['first_name', 'observed_signal_short'];
  const subjectReady = has(subjectTokens, 'blocked');
  const essentialsReady = has(['first_name', 'sender_name'], 'blocked');
  const subject = !subjectReady ? null : variant === 1 ? `${tokens.company_name}’s ${tokens.observed_signal_short} - quick question` : variant === 2 ? `Cutting ${tokens.pain_point_category} at ${tokens.company_name}` : `${tokens.first_name}, saw ${tokens.observed_signal_short}`;
  const sentences: string[] = [];
  if (has(['observed_signal_sentence'], 'omitted')) sentences.push(`I noticed ${tokens.observed_signal_sentence}.`);
  if (has(['company_segment', 'value_prop_for_pain_point'], 'omitted')) sentences.push(`At StyleSense AI, we help apparel and fashion ${tokens.company_segment} teams ${tokens.value_prop_for_pain_point}${tokens.quantified_outcome_optional ? ` - ${tokens.quantified_outcome_optional}` : ''}.`);
  if (has(['company_name', 'specific_context_detail', 'one_line_relevance_hypothesis'], 'omitted')) sentences.push(`Given ${tokens.company_name}’s ${tokens.specific_context_detail}, ${tokens.one_line_relevance_hypothesis}.`);
  sentences.push(`Would you be open to a 15-minute call${tokens.proposed_time_window ? ` ${tokens.proposed_time_window}` : ''} to see if it’s a fit?`);
  const body = essentialsReady ? [`Hi ${tokens.first_name},`, ...sentences, `Best,\n${tokens.sender_name}\nStyleSense AI`, ...(tokens.optional_soft_proof_point ? [`P.S. ${tokens.optional_soft_proof_point}`] : [])].join('\n\n') : '';
  return { subject, body, tokens, provenance, issues, sendable: subjectReady && essentialsReady && !issues.some(issue => issue.action === 'blocked'), templateVersion: 'appendix-a-v1' };
}

export function emailHtml(body: string, unsubscribeUrl: string, pixelUrl: string) {
  const paragraphs = body.split('\n\n').map(paragraph => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
  return `<!doctype html><html lang="en"><body>${paragraphs}<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from StyleSense AI outreach</a></p><img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt=""></body></html>`;
}
