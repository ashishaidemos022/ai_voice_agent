import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysYmd, chicagoLocalToUtcIso, chicagoMonthDay, chicagoWeekday, chicagoYmd } from '../shared/voice-eval/chicago-time.ts';
import { percentile } from '../shared/voice-eval/stats.ts';
import { scoreLatency } from '../shared/voice-eval/scoring/latency.ts';
import { turnMetric } from './helpers/voice-eval-fixtures.ts';

test('chicago time helpers handle CDT and CST', () => {
  assert.equal(chicagoLocalToUtcIso('2026-10-06', 9), '2026-10-06T14:00:00.000Z');
  assert.equal(chicagoLocalToUtcIso('2026-12-08', 9), '2026-12-08T15:00:00.000Z');
  assert.equal(chicagoWeekday('2026-10-08T19:00:00Z'), 'Thursday');
  assert.equal(chicagoYmd(new Date('2026-10-06T03:00:00Z')), '2026-10-05');
  assert.equal(chicagoMonthDay('2026-10-06T14:00:00Z'), 'October 6');
  assert.equal(addDaysYmd('2026-09-30', 2), '2026-10-02');
});

test('percentile uses nearest rank', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([100, 200, 300, 400], 0.5), 200);
  assert.equal(percentile([100, 200, 300, 400], 0.95), 400);
});

test('latency passes, warns and fails on p95', () => {
  const fast = scoreLatency([turnMetric(1000, 600), turnMetric(5000, 800), turnMetric(9000, 900)]);
  assert.equal(fast.status, 'pass');
  assert.equal(fast.p50Ms, 800);
  assert.equal(fast.p95Ms, 900);
  assert.equal(fast.turnCount, 3);
  assert.equal(scoreLatency([turnMetric(1, 700), turnMetric(2, 1200)]).status, 'warn');
  assert.equal(scoreLatency([turnMetric(1, 700), turnMetric(2, 2100)]).status, 'fail');
});

test('latency reports tool turns separately and ignores missing values', () => {
  const result = scoreLatency([turnMetric(1, 500), turnMetric(2, 1400, { toolCallMs: 900 }), turnMetric(3, null)]);
  assert.equal(result.turnCount, 2);
  assert.equal(result.toolTurnP95Ms, 1400);
  assert.equal(scoreLatency([]).status, 'no_data');
});
