import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { intentSchema } from './schemas.js';
import { MockModel, MockResearch, OpenAIModel } from './providers.js';
import { classifyReply } from './replies.js';

const examples = z.array(z.object({ id: z.string(), text: z.string(), intent: intentSchema })).min(5).max(8).parse(JSON.parse(readFileSync(new URL('../../../../evaluation/replies.json', import.meta.url), 'utf8')));
const live = process.argv.includes('--live');
if (live && (!process.env.OPENAI_API_KEY || !process.env.AI_MODEL)) throw new Error('Live evaluation requires OPENAI_API_KEY and AI_MODEL locally.');
const model = live ? new OpenAIModel(process.env.OPENAI_API_KEY!, process.env.AI_MODEL!) : new MockModel();
const options = { model, research: new MockResearch(), production: false };
const predictions = []; const matrix: Record<string, Record<string, number>> = {}; let correct = 0;
for (const example of examples) {
  let predicted = 'ERROR'; let classifier = model.name;
  try { const result = await classifyReply(example.text, { firstName: 'Example', company: 'Example Apparel' }, options); predicted = result.intent; classifier = result.provider; } catch { /* Provider errors count as misses, never silently exclude them. */ }
  const match = predicted === example.intent; if (match) correct++;
  const row = matrix[example.intent] ??= {}; row[predicted] = (row[predicted] ?? 0) + 1;
  predictions.push({ id: example.id, expected: example.intent, predicted, classifier, correct: match });
}
console.log(JSON.stringify({ provider: model.name, model: model.model, simulated: model.simulated, correct, total: examples.length, accuracy: correct / examples.length, limitation: 'Eight hand-labelled smoke examples, not an independent production benchmark. Literal opt-outs use the safety guard before the selected classifier.', predictions, confusionMatrix: matrix }, null, 2));
if (predictions.some(item => item.predicted === 'ERROR')) process.exitCode = 1;
