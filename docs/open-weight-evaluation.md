# Open-weight evaluation: first runnable slice

This is an independent development CLI for testing Chat Completions-compatible endpoints. It does not change the production chat path or train a model. Node 22+ is required.

## Run without a model

```bash
npm run test:open-weight-eval
npm run typecheck:open-weight-eval
npm run open-weight:eval
```

The default command writes a plan under `artifacts/open-weight-evals/` without sending requests or inventing scores. Artifacts are gitignored.

## Connect a model

Copy `scripts/open-weight-eval/models.example.json` to a local configuration file (a name ending in `.local` is already gitignored). Set:

- `id`: experiment variant name, such as original or tuned.
- `model`: exact model ID advertised by the server. For a served adapter, this must be its actual serving ID; the `adapter` field is metadata only and does not activate weights.
- `baseUrl`: API root including `/v1` where appropriate.
- `apiKeyEnv`: optional environment-variable name or ordered list of names containing the API key; never put the key itself in JSON. The Vercel example tries `AI_GATEWAY_API_KEY`, then Vercel's deployed `VERCEL_OIDC_TOKEN`.
- `revision` and `precision`: declared checkpoint revision and actual serving precision. If a hosted provider does not disclose these, explicitly use `provider-undisclosed`. This limits reproducibility and cannot establish checkpoint identity.
- `chatTemplateKwargs`: optional server-specific settings. The example disables Qwen thinking for a bounded smoke run. Remove this field for servers that do not support it.
- `providerOnly`: optional Vercel provider allowlist. This prevents provider failover from changing the serving backend during a controlled run. Leave it unset until a supported provider is chosen and recorded.
- `inputCostPerToken` and `outputCostPerToken`: optional frozen prices used to calculate request cost from returned usage.
- `reasoningEffort`: optional fixed reasoning mode. The local baseline uses `none` so hidden thinking does not dominate a basic conformance run.

```bash
npm run open-weight:eval -- --config models.local --probe
npm run open-weight:eval -- --config models.local --live --limit 6
npm run open-weight:eval -- --config models.local --live
```

For the currently advertised Vercel Qwen baseline:

```bash
npm run open-weight:eval -- --config scripts/open-weight-eval/models.vercel.example.json --probe
npm run open-weight:eval -- --config scripts/open-weight-eval/models.vercel.example.json --live --limit 6 --delay-ms 20000
```

For the local Qwen3.5-4B baseline installed on this machine:

```bash
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve
npm run open-weight:eval -- --config scripts/open-weight-eval/models.ollama.json --probe
npm run open-weight:eval -- --config scripts/open-weight-eval/models.ollama.json --live
```

The checked-in local registry pins Ollama artifact digest `sha256:2a654d98...e4eefd` and records GGUF Q4_K_M quantization. It is a 4.7B-parameter development baseline selected for this 16 GB Apple Silicon machine; it is not interchangeable with the planned full-precision training checkpoint.

`--live` makes billable inference requests when connected to a provider. It makes one request per case per configured model, with no hidden judge, router, model fallback, or retrieval. Configured transient HTTP retries are recorded in each result. `--delay-ms` adds a bounded pause between cases for rate-limited endpoints. Default output budget: 512 tokens per request. Default timeout: 60 seconds. API keys must already exist in the process environment; the CLI does not automatically load `.env`.

Probe only checks advertised model availability. A successful probe does not establish tool support or correct protocol behavior. Live reports include completion latency, output, tool calls, finish reason, usage when supplied, exact grading results, errors, and model declarations. Non-passing checks produce exit code 1 after results are written. Transport or parsing errors count as failures, not skipped cases.

The 30 cases cover six development categories, with five parameter variations each: extraction, grounded unknowns, arithmetic, tool selection, untrusted data, and conversational corrections. They are intentionally simple and correlated. Do not publish the pass rate as a broad capability score. Tool calls are inspected but never executed. Streaming, first-token timing, tool-result round trips, semantic judging, voice, training, and a frozen held-out benchmark are later milestones.

## Vercel deployment architecture

Vercel can host the application and comparison UI. Vercel AI Gateway can route requests to hosted models; the current API root is `https://ai-gateway.vercel.sh/v1`. Use a currently advertised model ID and an `apiKeyEnv` referring to the Gateway key. Verify compatibility with a small live run before a full matrix. If provider routing cannot be pinned and recorded, label the run as a Gateway-level baseline rather than a reproducible checkpoint comparison.

The authenticated `api/open-weight-chat.js` function is the first platform bridge. It validates the existing Supabase user token, restricts calls to a server-side model allowlist, uses `AI_GATEWAY_API_KEY` or Vercel's automatic `VERCEL_OIDC_TOKEN`, and returns model identity, usage, cost, and completion latency. Its default allowlist contains the currently advertised `alibaba/qwen-3-14b` baseline. Set `OPEN_WEIGHT_MODELS_JSON` to replace that registry. The endpoint intentionally has no client-selected base URL, provider credentials, or arbitrary model name.

Keep model inference and fine-tuning on a separate GPU service for the 8B experiment. Standard Vercel Functions' documented CPU/memory resources are not appropriate for this training workload. A Gateway model API does not confer access to the served weight files or allow this CLI to train them.

Suggested arrangement:

- Vercel: application UI and authenticated request handling.
- Supabase: existing application data, experiment metadata, retrieval, and tools.
- GPU service: original and tuned model endpoints, adapter training, and checkpoint storage.
- Local runner initially, then a background worker: evaluation batches and report generation.

Do not run the entire sequential evaluation suite in one web request. Keep endpoint credentials server-side. For weight-change proof, use original and adapted checkpoints on controlled endpoints with fixed settings; record actual weight hashes and parameter deltas from that environment. The current runner's revision fields are declarations, not verified hashes.

## Completed local weight-change proof

The reproducible experiment in `experiments/open-weight-lora/` trained a 1.442M-parameter LoRA delta over the last eight layers of the pinned `mlx-community/Qwen3-0.6B-4bit` checkpoint. Only 0.242% of its 596.050M parameters were trainable. On six held-out phrasings of fictional Aster Retail facts, the frozen base scored 0/6 and the selected iteration-100 adapter scored 6/6. Fusing the adapter into a standalone checkpoint also scored 6/6 without loading an adapter.

The base weight shard SHA-256 is `392e8d466d56100ada00eb82031fb854297fc9e389b7d303eba3af114e87bce2`; the fused shard SHA-256 is `377f29355db003320731bba46b37a5bfd03bdb69b9940a6b1eed28948294fd16`; the selected adapter SHA-256 is `3ae28b98246f554b19d9b363aafef476b1d92458517874640059c84d1dadbee6`. Different base and fused hashes plus the repeated behavioral change establish that the served parameters actually changed. This small synthetic memorization check proves the mechanism, not broad quality improvement.

Sources checked September 9, 2026: [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), [Vercel Function memory and CPU](https://vercel.com/docs/functions/configuring-functions/memory), [vLLM LoRA serving](https://docs.vllm.ai/en/stable/features/lora/).
