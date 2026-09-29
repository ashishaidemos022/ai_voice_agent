import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestWindowDistance, extractDates, factMatchesText, factMatchesValue, factTokens, normalizeDate,
  normalizeDigits, normalizeWeekday, tokenize, transcriptTokensFor, wordEditDistance
} from '../shared/voice-eval/normalize.ts';
import type { Fact } from '../shared/voice-eval/types.ts';

const dob: Fact = { kind: 'date', value: '1979-03-14', critical: true, argField: 'date_of_birth' };
const zip: Fact = { kind: 'digits', value: '75204', critical: true, argField: 'postal_code' };
const name: Fact = { kind: 'name', value: 'Maya', critical: true };
const day: Fact = { kind: 'weekday', value: 'Thursday', critical: false };

test('tokenize and digit normalization handle spoken digits', () => {
  assert.deepEqual(tokenize("It's Maya, OK?"), ['it', 's', 'maya', 'ok']);
  assert.equal(normalizeDigits('seven five two oh four'), '75204');
  assert.equal(normalizeDigits('7 5 2 0 4'), '75204');
  assert.equal(normalizeDigits('no digits here'), '');
});

test('dates are extracted from ISO, slash and spoken-month formats', () => {
  assert.deepEqual(extractDates('born 1979-03-14'), ['1979-03-14']);
  assert.deepEqual(extractDates('born 3/14/1979'), ['1979-03-14']);
  assert.deepEqual(extractDates('March 14th, 1979 is my birthday'), ['1979-03-14']);
  assert.deepEqual(extractDates('February 30, 1979'), []);
  assert.equal(normalizeDate('March 14 1979'), '1979-03-14');
  assert.equal(normalizeDate('not a date'), null);
});

test('weekday normalization', () => {
  assert.equal(normalizeWeekday('make that thursday please'), 'Thursday');
  assert.equal(normalizeWeekday('whenever'), null);
});

test('facts match transcript text by kind', () => {
  assert.equal(factMatchesText(dob, 'my birthday is March 14th, 1979'), true);
  assert.equal(factMatchesText(dob, 'my birthday is March 4th, 1979'), false);
  assert.equal(factMatchesText(zip, 'zip is seven five two oh four'), true);
  assert.equal(factMatchesText(zip, 'zip is 75240'), false);
  assert.equal(factMatchesText(name, 'this is maya patel'), true);
  assert.equal(factMatchesText(name, 'this is mayan'), false);
  assert.equal(factMatchesText(day, 'Thursday works'), true);
});

test('facts match tool argument values', () => {
  assert.equal(factMatchesValue(dob, '1979-03-14'), true);
  assert.equal(factMatchesValue(dob, '1979-03-41'), false);
  assert.equal(factMatchesValue(zip, '75204'), true);
  assert.equal(factMatchesValue(zip, ' 75204 '), true);
  assert.equal(factMatchesValue(zip, undefined), false);
  assert.equal(factMatchesValue(zip, ''), false);
});

test('edit distance and best window', () => {
  assert.equal(wordEditDistance(['a', 'b', 'c'], ['a', 'x', 'c']), 1);
  assert.equal(wordEditDistance([], ['a']), 1);
  assert.equal(bestWindowDistance(['7', '5', '2', '0', '4'], '197975204'.split('')), 0);
  assert.equal(bestWindowDistance(factTokens(zip), transcriptTokensFor(zip, 'zip 75240')), 2);
  assert.deepEqual(factTokens(dob), ['1979', '03', '14']);
  assert.deepEqual(transcriptTokensFor(dob, 'March 14, 1979'), ['1979', '03', '14']);
});
