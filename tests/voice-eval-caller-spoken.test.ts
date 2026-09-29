import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenForTts } from '../shared/voice-eval/caller/spoken.ts';

test('years are spelled the way a caller says them', () => {
  assert.equal(spokenForTts('February 14th, 1988.'), 'February 14th, nineteen eighty-eight.');
  assert.equal(spokenForTts('born in 1907'), 'born in nineteen oh seven');
  assert.equal(spokenForTts('1900'), 'nineteen hundred');
  assert.equal(spokenForTts('2000'), 'two thousand');
  assert.equal(spokenForTts('2005'), 'two thousand five');
  assert.equal(spokenForTts('2012'), 'twenty twelve');
  assert.equal(spokenForTts('1970'), 'nineteen seventy');
});

test('letter-and-digit codes are spelled out character by character', () => {
  assert.equal(spokenForTts('It’s M1 1AF.'), 'It’s M one one A F.');
  assert.equal(spokenForTts('my code is 2B'), 'my code is two B');
});

test('ordinals, small numbers and plain words are left alone', () => {
  assert.equal(spokenForTts('the 14th at 3 pm'), 'the 14th at 3 pm');
  assert.equal(spokenForTts('Tuesday works, thanks.'), 'Tuesday works, thanks.');
  assert.equal(spokenForTts('call 12345'), 'call 12345');
});
