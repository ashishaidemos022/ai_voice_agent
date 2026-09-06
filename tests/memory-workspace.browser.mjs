// Run against a Vite dev server using the preview Supabase environment in docs/AGENT_MEMORY.md.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.MEMORY_PLAYWRIGHT_MODULE || 'playwright');
const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const owner = id(1), agentId = id(2), subjectId = id(3), samId = id(4), sessionId = id(5), turnId = id(6);
const base = { user_id: owner, agent_id: agentId, subject_id: subjectId, kind: 'semantic', source: 'user', source_message_id: id(7), source_session_id: sessionId, status: 'active', version: 1, happened_at: null, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z' };
let records = [
  { ...base, id: id(1), memory_key: 'shoe_size', title: 'Shoe size and fit', content: 'US 10 wide', source_quote: 'Remember: I wear US 10 wide.' },
  { ...base, id: id(2), memory_key: 'shoe_budget', title: 'Usual shoe budget', content: '$250', source_quote: 'My usual shoe budget is $250.' },
  { ...base, id: id(3), kind: 'episodic', memory_key: 'past_fit', title: 'Previous fit experience', content: 'Pointed-toe shoes pinched at the conference.', source_quote: 'Pointed-toe shoes pinched last time.', happened_at: '2026-08-25T12:00:00Z' },
  { ...base, id: id(4), memory_key: 'receipts', title: 'Receipt preference', content: 'Email receipts preferred', source_quote: 'I prefer email receipts.' },
  { ...base, id: id(5), subject_id: null, kind: 'procedural', source: 'owner', memory_key: 'shoe_recommendations', title: 'Shoe recommendation procedure', content: 'Compare two suitable shoes. Check current stock. Explain fit differences.', source_quote: 'Written in the workspace memory editor' }
];
const receipt = { turnId, subjectId, currentQuestion: 'What would you recommend for a full day on my feet?', previousMessages: 0, lookup: 'requested', records: records.slice(0, 3), carriedRecords: [], playbooks: [records[4]] };
const events = ['turn_started', 'search_requested', 'retrieved', 'playbooks_selected', 'context_supplied', 'answer_completed'].map((kind, i) => ({ id: `event-${i}`, turn_id: turnId, session_id: sessionId, kind, created_at: `2026-09-05T12:00:0${i}Z`, payload: kind === 'context_supplied' ? { receipt } : kind === 'retrieved' ? { records: records.slice(0, 3) } : kind === 'search_requested' ? { query: 'shoe size budget fit comfort' } : {} }));
const browser = await chromium.launch({ headless: true, ...(process.env.MEMORY_CHROME_PATH ? { executablePath: process.env.MEMORY_CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ agentId, subjectId, sessionId, receipt, owner }) => {
    window.memoryFixture = { agentId, subjectId, sessionId, receipt };
    localStorage.setItem('sb-memory-preview-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: owner, aud: 'authenticated' } }));
  }, { agentId, subjectId, sessionId, receipt, owner });
  await page.route('https://memory-preview.supabase.co/**', async route => {
    const body = route.request().postDataJSON() || {};
    let result = {};
    if (body.action === 'list') result = { subjects: [{ id: subjectId, name: 'Alex · demo customer' }, { id: samId, name: 'Sam · separate customer' }], records: records.filter(record => record.subject_id === body.subject_id || record.subject_id === null) };
    if (body.action === 'events') result = { events };
    if (body.action === 'save') { const index = records.findIndex(record => record.id === body.record.id); records[index] = { ...records[index], ...body.record, version: records[index].version + 1 }; result = { record: records[index] }; }
    if (body.action === 'forget') records = records.filter(record => record.id !== body.id);
    await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(`${process.env.MEMORY_PREVIEW_URL || 'http://127.0.0.1:5178'}/tests/fixtures/memory-workspace.html`);
  await page.getByText('0 earlier messages in this conversation', { exact: false }).waitFor();
  await page.getByText('Usual shoe budget', { exact: true }).waitFor();
  assert.equal(await page.getByText('Receipt preference', { exact: true }).count(), 0, 'irrelevant memory must not appear as supplied');
  await page.screenshot({ path: process.env.MEMORY_SCREENSHOT || '/tmp/viaana-memory-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Explore memory', exact: true }).click();
  await page.getByText('Receipt preference', { exact: true }).waitFor();
  await page.getByText('Usual shoe budget', { exact: true }).click();
  const budget = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Usual shoe budget' }) });
  await budget.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('What to remember', { exact: true }).fill('$350');
  await page.getByRole('button', { name: 'Save memory', exact: true }).click();
  await budget.getByText('$350', { exact: true }).waitFor();
  await budget.getByRole('button', { name: 'Forget', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Removed from future memory retrieval' }).waitFor();
  assert.equal(await page.getByText('Usual shoe budget', { exact: true }).count(), 0);
  await page.getByLabel('Customer profile · stays the same across new chats').selectOption(samId);
  await page.getByText('No facts saved yet.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Playbooks · 1/ }).click();
  await page.getByText('Shoe recommendation procedure', { exact: true }).waitFor();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal overflow at ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('Memory UI passed: selected-only trace, explore, edit, forget, profile switch, shared playbook, and responsive widths.');
} finally { await browser.close(); }
