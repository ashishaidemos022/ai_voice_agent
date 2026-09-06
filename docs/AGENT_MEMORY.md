# Workspace agent memory

The workspace Memory inspector shows customer facts (semantic), dated experiences (episodic), agent playbooks (procedural), and the context supplied for the current answer (working memory).

## Deploy

1. Apply `supabase/migrations/20260905120000_add_agent_memory.sql` to the intended Supabase project using your normal migration process.
2. Deploy both `agent-memory` and `responses-chat` Edge Functions. They import the shared memory modules; use the repository root when deploying.
3. Rebuild/deploy the frontend with its existing Supabase URL and anonymous key.

Both functions require the existing Supabase service-role environment. Answer generation and optional memory extraction require `OPENAI_API_KEY`; `OPENAI_BASE_URL` remains optional. Secrets stay on the server.

Nothing in this change automatically migrates or deploys a hosted project. Without a selected customer profile, chats continue without personal-memory tools.

## Try it

1. Select an agent in workspace chat. Open **Memory**, press **+**, and create an Alex demo profile.
2. Start a chat. Say: “Remember: I wear US 10 wide. My usual shoe budget is $250. Pointed-toe shoes pinched last time. I prefer email receipts.”
3. Inspect the saved facts and their source messages under **Explore memory**.
4. End the chat and start another with the same customer profile. Ask: “What would you recommend for a full day on my feet?”
5. **Follow this answer** shows actual search events, selected records, playbooks and context receipts. Memory references in the answer expand to the corresponding source snapshots.
6. Say: “Remember: my usual shoe budget is now $350.” Inspect version history. Start another conversation to verify the current value is recalled.
7. For procedural memory, add an owner-authored playbook titled “Shoe recommendation procedure” with relevant steps. Its title and body determine keyword matching.
8. For episodic memory, add a dated report manually, or use **Extract memories to review** in a conversation and save an extracted episode after reviewing its source quote.

Extraction proposes up to four facts and one episode from the latest 30 user messages. It does not save suggestions automatically. Existing-key conflicts require editing the existing memory, protecting against unreviewed replacement.

## Behavior and scope

- The server validates the workspace owner, agent, session and customer profile. Personal notes belong to that profile and agent. Owner-authored playbooks belong to the agent and can apply across its customer profiles.
- Retrieval currently uses transparent keyword ranking, including singular/plural normalization. The model supplies topic keywords. This first version does not use embeddings or a separate retrieval classifier.
- The model chooses whether to call personal-memory tools. Relevant playbooks are selected separately. A skipped personal lookup does not mean no current context or system instructions.
- Memory tool calls execute on the server. Subsequent answer requests rebuild their results from server records, excluding forgotten items and reflecting current versions.
- SQL serializes writes to each logical memory, keeps version snapshots, rejects stale edits, and blocks direct client writes. Repeated identical saves do not create new versions.
- Forgetting excludes an item from future retrieval. Original conversations, existing answers, audit events and prior versions are retained.
- The trace records operations and context supplied to the model, not private model reasoning. References are checked against supplied IDs; they are attribution rather than proof of causal influence.
- Live events are polled while a response is pending. Completed answers retain memory receipts in message metadata for historical inspection.
- Voice and the standalone embed have not yet been connected to this service.

## Verification

Run with Node 24 or a Node version supporting TypeScript stripping:

```sh
npm run test:memory
npm run typecheck
npm run build
deno check --no-config --no-lock --node-modules-dir=none supabase/functions/agent-memory/index.ts supabase/functions/responses-chat/index.ts
```

The memory suite runs the actual migration in PGlite PostgreSQL and tests row-level isolation, prohibited client writes, versioning, stale updates, source ownership and forgetting, plus retrieval and reference validation.

The browser fixture is test-only and is not a production entry point. It requires a Vite server; opening its HTML directly with `file://` does not run the React application.

```sh
VITE_SUPABASE_URL=https://memory-preview.supabase.co VITE_SUPABASE_ANON_KEY=preview-only npm run dev -- --host 127.0.0.1 --port 5178
# In another terminal, with Playwright and Chromium available:
node tests/memory-workspace.browser.mjs
```

`MEMORY_PLAYWRIGHT_MODULE`, `MEMORY_CHROME_PATH`, `MEMORY_PREVIEW_URL`, and `MEMORY_SCREENSHOT` optionally customize the browser test. It intercepts the preview API with simulated customer data and never uses a production account.
