import assert from 'node:assert/strict';
import test from 'node:test';
import { containsRichContent } from '../src/components/ui/markdown-utils.ts';

test('detects markdown images as wide content', () => {
  assert.equal(containsRichContent('![Architecture](https://example.com/diagram.png)'), true);
});

test('detects GFM tables with and without leading pipes', () => {
  assert.equal(containsRichContent('| Name | Status |\n| --- | --- |\n| Agent | Ready |'), true);
  assert.equal(containsRichContent('Name | Status\n--- | ---\nAgent | Ready'), true);
});

test('keeps ordinary prose in the readable-width layout', () => {
  assert.equal(containsRichContent('A concise answer with **emphasis** and a list.'), false);
});

test('detects A2UI payloads as rich content', () => {
  assert.equal(containsRichContent('{"a2ui":{"version":"0.8","ui":{}}}'), true);
});
