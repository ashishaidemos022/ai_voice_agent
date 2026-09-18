import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeFacts, parseAdapterTests, wordDiff } from '../src/components/open-weight/adapterEvaluationUtils.ts';

test('held-out parser accepts alternate required facts and rejects leaked targets', () => {
  const source = JSON.stringify({
    id: 'hours', category: 'faq',
    messages: [{ role: 'system', content: 'Answer facts.' }, { role: 'user', content: 'When is lunch?' }],
    expected: { required: [['11:30 a.m.', '11:30 AM'], 'Tuesday'] }
  });
  const [item] = parseAdapterTests(source);
  assert.equal(item.id, 'hours');
  assert.throws(() => parseAdapterTests(JSON.stringify({ ...item, messages: [...item.messages, { role: 'assistant', content: 'target' }] })), /end with a user/);
});

test('fact grader accepts phrasing alternatives and reports missing and forbidden claims', () => {
  const expected = { required: [['11:30 a.m.', '11:30 AM'], 'Tuesday'], forbidden: ['Monday'] };
  assert.equal(gradeFacts(expected, 'Lunch starts at 11:30 AM Tuesday.').pass, true);
  const failed = gradeFacts(expected, 'Lunch starts Monday.');
  assert.equal(failed.pass, false);
  assert.deepEqual(failed.missing, ['11:30 a.m. OR 11:30 AM', 'Tuesday']);
  assert.deepEqual(failed.forbidden, ['Monday']);
});

test('hours gate rejects an invented closing time even when required facts are present', () => {
  const expected = {
    required: [['11:30 a.m.', '11:30 am'], ['2:30 p.m.', '2:30 pm']],
    forbidden: ['3:00 p.m.', '3:00 pm']
  };
  const failed = gradeFacts(expected, 'Lunch is served from 11:30 a.m. to 2:30 p.m., but may run until 3:00 p.m.');
  assert.equal(failed.pass, false);
  assert.deepEqual(failed.forbidden, ['3:00 p.m.']);
});

test('word diff highlights terms unique to each model output', () => {
  const diff = wordDiff('Lunch is available Saturday', 'Lunch starts at noon Saturday');
  assert.equal(diff.before.find((part) => part.token === 'available')?.changed, true);
  assert.equal(diff.after.find((part) => part.token === 'noon')?.changed, true);
  assert.equal(diff.after.find((part) => part.token === 'Lunch')?.changed, false);
});
