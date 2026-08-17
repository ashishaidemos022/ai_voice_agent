# Vault Noir Supabase + RAG Routing Demo Script

## Setup

Run the same transcript twice:

1. Fixed mode with GPT-5.6 Sol.
2. Auto mode with a fresh conversation.

Replace `<DEMO_CUSTOMER_EMAIL>` with a seeded customer email. Stop at the storefront handoff; this agent has no cart or payment tool.

## Opening narration

> Vault Noir combines structured commerce data in Supabase with unstructured product expertise from an internally attached knowledge article. The same conversation moves from a simple request to tool use, multi-factor reasoning, and a consequential pre-purchase decision. Auto mode chooses the model for each turn.

## Turn 1 — Grounded conversation

**Shopper:**

> Hi, I'm shopping for a polished men's work shoe.

**Expected:** Luna. The concierge asks one focused question and makes no tool call.

**Narration:**

> This is ordinary conversation, so Luna is enough.

## Turn 2 — Bounded transformation

**Shopper:**

> Turn my requirements into a concise shopping brief: men's, US 10, wide feet, under $600, office wear, comfortable for eight-hour days. Return only the brief.

**Expected:** Nano. No tool call.

**Narration:**

> Extracting and formatting known preferences is a bounded task, so Nano handles it without reasoning overhead.

## Turn 3 — Customer lookup

**Shopper:**

> Yes, you may use <DEMO_CUSTOMER_EMAIL> to check my footwear preferences, purchases, and returns. Summarize only what matters for this shopping decision.

**Expected:** Mini with one `execute_sql` call. The request must contain exactly one tool argument named `query`.

**What to show:** The tool event should be `execute_sql`, sourced from Supabase Retail. The response should show first name, size/width, loyalty tier if relevant, owned footwear, and return-based fit warnings—without exposing the full email or unrelated customer fields.

**Narration:**

> Mini performs a structured customer lookup. The PDF is not a tool call; the platform retrieves it internally.

## Turn 4 — Catalog discovery

**Shopper:**

> Using that profile and my shopping brief, query the Supabase footwear catalog and return up to three structured matches. Keep footwear, wide fit, availability, and budget as hard constraints.

**Expected:** Mini with exactly one `execute_sql` call against `shopify_products`, including `category::text = 'footwear'`. RAG is intentionally skipped because this is a structured catalog lookup; the products are not known until SQL returns.

The generated query must normalize the shopper's "office wear" wording to `occasion = 'work'`. `occasion = 'office'` is invalid for this dataset.

**What to show:** The result should contain **Bastion Loafer** and **Forge Derby**, never apparel. Show each product's image from the absolute Shopify CDN URL stored in `images`, plus catalog price, availability, width/fit, personalized reason, and one structured-data trade-off. Product-detail RAG is deferred until the comparison turn.

**Narration:**

> Mini now orchestrates a single Supabase footwear query. Hard category and fit constraints prevent apparel or narrow shoes from entering the shortlist.

## Turn 5 — Medium-reasoning comparison

Run this within two minutes of discovery so the structured results remain in context.

**Shopper:**

> Compare Forge Derby and Bastion Loafer using the results you already have and the Vault Noir knowledge. Weigh toe room, break-in, eight-hour comfort, rain, longevity, resolability, price, and my return history. Recommend the safer choice and name the deciding evidence. Do not query again.

**Expected:** Terra with medium reasoning and no tool call. Naming both products in the current message allows internal RAG to retrieve their product-specific passages.

**Narration:**

> The facts are already present. Terra handles the multi-factor trade-off analysis without repeating the database lookup.

## Turn 6 — Consequential pre-purchase check

**Shopper:**

> Before I spend money, re-check the selected product's catalog price and availability in Supabase, reconcile the fit risk with my return history, and tell me exactly what the storefront must confirm before I pay.

**Expected:** Sol with high reasoning and one `execute_sql` call.

**What to show:** Exact product, stored catalog price and availability, personalized fit risk, product-page URL, and a clear statement that live variant, final price, tax, shipping, and payment are confirmed on the storefront.

**Narration:**

> This can affect the shopper's money and fit decision. Sol performs the consequential review, but the agent remains honest about its boundary: Supabase verification and secure storefront handoff, not payment processing.

## Turn 7 — Handoff boundary

**Shopper:**

> Take me to that product so I can select the live variant and complete checkout securely.

**Expected:** Luna or Nano depending on phrasing; no tool call is required because the exact slug is already in context. The concierge returns the Vault Noir product URL and does not claim to create a cart or checkout.

## Receipt reveal

The core Auto sequence should be:

```text
Luna → Nano → Mini → Mini → Terra → Sol
```

Compare the fixed and Auto receipts on:

- same customer facts;
- same eligible products;
- same recommendation;
- same stored price and availability;
- same fit-risk conclusion;
- tool-call success;
- total model cost.

## Closing narration

> Fixed mode used the frontier model for every task. Auto mode used Luna for conversation, Nano for formatting, Mini for Supabase calls, Terra for the comparison, and Sol only for the consequential purchase review. Structured data, retrieved expertise, and the final recommendation stayed consistent while model cost was matched to the work.

## Failure checks

- If the tool name is anything other than `execute_sql`, the agent instructions are wrong.
- If the tool payload contains anything other than `query`, the call is wrong.
- If the agent tries to call RAG, the instructions are wrong; RAG is internal.
- If it claims to create a cart, checkout, payment, or order, stop the demo; those capabilities are not attached.
- If it exposes raw SQL or the full customer record, stop the demo and correct the privacy behavior.
