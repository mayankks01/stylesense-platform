import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScore, scoringConfig, type FitInput, type ScoreEvent } from '../src/scoring.js';

const input: FitInput = { industry: 'Apparel', region: 'India', size: 200, title: 'Head of Merchandising', icp: { industries: ['apparel'], regions: ['India'], titles: ['Head of Merchandising'], minCompanySize: 50, maxCompanySize: 500 } };
const event = (id: string, type: string, intent: string | null = null, time = '2026-01-01T00:00:00Z'): ScoreEvent => ({ id, type, intent, occurredAt: new Date(time) });

test('fit requires evidence and exact normalized matches; unknown fields earn nothing', () => {
  assert.equal(calculateScore(input, []).total, 60);
  assert.equal(calculateScore({ ...input, industry: null, region: null, size: null, title: null }, []).total, 0);
  assert.equal(calculateScore({ ...input, title: 'Assistant to Head of Merchandising' }, []).fit, 45);
  assert.equal(calculateScore({ ...input, icp: { industries: [], regions: [], titles: [] } }, []).total, 0);
});
test('repeat opens are capped and newest reply intent replaces older intent independent of arrival order', () => {
  const events = [event('a', 'OPENED'), event('b', 'OPENED'), event('c', 'REPLIED', 'INTERESTED'), event('d', 'REPLIED', 'NOT_NOW', '2026-01-02T00:00:00Z')];
  assert.equal(calculateScore(input, events).total, 70);
  assert.deepEqual(calculateScore(input, events), calculateScore(input, [...events].reverse()));
  assert.equal(calculateScore(input, [event('a', 'OPENED'), event('b', 'REPLIED', 'INTERESTED')]).total, 100);
});
test('unsubscribe is permanent across later replies and external suppression is honored', () => {
  const result = calculateScore(input, [event('a', 'UNSUBSCRIBED'), event('b', 'REPLIED', 'INTERESTED', '2026-01-02T00:00:00Z')]);
  assert.equal(result.total, 0); assert.equal(result.status, 'UNSUBSCRIBED');
  assert.equal(calculateScore(input, [], true).total, 0);
  assert.equal(calculateScore(input, [event('a', 'REPLIED', 'UNSUBSCRIBE')]).status, 'UNSUBSCRIBED');
});
test('scores stay within bounds even for negative intent and large configuration weights', () => {
  assert.equal(calculateScore({ ...input, industry: null, region: null, size: null, title: null }, [event('a', 'REPLIED', 'WRONG_PERSON')]).total, 0);
  const heavy = { ...scoringConfig, fit: { industry: 100, region: 100, companySize: 100, title: 100 } };
  assert.equal(calculateScore(input, [], false, heavy).total, 100);
});
test('same-timestamp replies have deterministic ID tie-breaks and delivery cannot regress reply state', () => {
  const events = [event('z', 'REPLIED', 'NEEDS_INFO'), event('a', 'REPLIED', 'INTERESTED'), event('x', 'DELIVERED', null, '2026-01-03T00:00:00Z')];
  assert.equal(calculateScore(input, events).total, 80);
  assert.equal(calculateScore(input, events).status, 'REPLIED');
});
