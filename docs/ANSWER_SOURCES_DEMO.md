# Answer sources demo

The Chat workspace now has an Answer sources inspector with four expandable cards: instructions, personal memory, document knowledge, and business data. Each completed answer stores its receipt in the existing message `raw` JSON. No database migration is needed. Old messages without receipts cannot reconstruct their original instruction snapshot or document passages.

Use the answer selector or “Inspect sources for this answer” beneath a response. Current retrieval and earlier tool context have separate labels. Instructions are supplied throughout the turn; the panel does not claim to observe internal reasoning. Memory citations use M labels and document citations use K labels, scoped to each answer.

The far-right Tools and history rail has a Compact button. It shrinks from 320px to 56px and remembers the layout preference in browser storage. Memory records and source receipts remain in Supabase; only this layout preference is stored locally.

## Recording setup

Select Shopify Agent, expand Manage memories, create a dedicated “Alex · conference demo” profile, and save separate notes:

- Fact: Shoe size — US 10 wide.
- Fact: Shoe budget — Up to $600.
- Past event: Previous conference discomfort — Pointed-toe shoes pinched during the last conference.

Start a new chat with that same profile. Keep personal memories separate from verified orders and returns. Do not reuse the $250 budget example: this catalog's footwear starts above that amount.

1. “Can you take my payment and complete the purchase here?” Open My instructions to inspect the storefront checkout rule.
2. “What shoe size and budget do you remember for me?” Open Personal memories to show the actual retrieved facts.
3. “What went wrong with my shoes at the last conference?” Show the episode and its source.
4. “Check the catalog for men’s work shoes within my budget that accommodate wide feet.” Show returned database fields. Forge Derby and Bastion Loafer were $545 and $490 when inspected; use the actual returned values during recording.
5. “Compare Forge Derby and Bastion Loafer for toe room, break-in, and eight-hour comfort. My conference is next month.” Show the actual guide passages and the answer's K citations. Do not script a product winner without supporting evidence.
6. “Recheck the recommended pair’s catalog price and availability, then give me the product link.” Distinguish stored catalog availability from live storefront checkout.

## Deployment and validation

Deploy the updated frontend and `rag-service` Edge Function together. The RAG function now requests actual file-search results and derives citation filenames and excerpts directly from them, rather than accepting model-authored citation JSON. It fails closed to an empty citation list when no real passages are returned. The generated retrieval summary is not itself a source passage.

Document context survives memory and business-tool continuations within a turn, then clears before the next question. The regression test exercises this with mocked network responses.

Run `npm run typecheck`, `npm run build`, and `node --experimental-strip-types --test tests/rag-evidence.test.ts tests/chat-source-context.test.ts tests/rag-routing.test.ts tests/agent-memory.test.ts tests/chat-rich-content.test.ts`.

For a layout-only preview, start Vite and open `/tests/fixtures/answer-sources.html`. It uses clearly labeled simulated data and makes no production queries. An authenticated production rehearsal remains necessary to validate the connected document, SQL tool, and saved profile together.
