import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRunRagForTurn } from '../shared/rag-routing.ts';

test('Vault Noir runs RAG only for product knowledge turns', () => {
  const skipped = [
    "Hi, I'm shopping for a polished men's work shoe.",
    'Turn my requirements into a concise shopping brief and return only the brief.',
    'Check my footwear preferences, purchases, and returns.',
    'Query the Supabase footwear catalog and return structured matches.',
    "Before I spend money, re-check the selected product's catalog price and availability.",
    'Take me to that product page.'
  ];
  const retrieved = [
    'Compare Forge Derby and Bastion Loafer for toe room, break-in, comfort, rain, and longevity.',
    'What is the Forge Derby construction and break-in period?',
    'How should I care for the Bastion Loafer?',
    'Explain the weather resistance of this shoe.'
  ];
  for (const prompt of skipped) assert.equal(shouldRunRagForTurn(prompt), false, prompt);
  for (const prompt of retrieved) assert.equal(shouldRunRagForTurn(prompt), true, prompt);
});
