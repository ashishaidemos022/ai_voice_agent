import assert from 'node:assert/strict';
import test from 'node:test';
import { containsRichContent, isDirectImageUrl } from '../src/components/ui/markdown-utils.ts';

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

test('recognizes direct image assets but not storefront pages', () => {
  assert.equal(isDirectImageUrl('https://cdn.shopify.com/s/files/1/001/products/forge-derby.jpg?v=2'), true);
  assert.equal(isDirectImageUrl('https://example.com/lookbook.webp'), true);
  assert.equal(isDirectImageUrl('https://vaultnoir.myshopify.com/collections/footwear'), false);
});

test('treats direct image links as wide content', () => {
  assert.equal(containsRichContent('[Forge Derby](https://cdn.shopify.com/s/files/1/001/products/forge.jpg)'), true);
});
