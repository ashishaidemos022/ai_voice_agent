# Routing evaluation harness

This harness measures whether the chat router preserves answer quality while reducing cost. It is an internal evaluation tool, not a user-facing model-selection lab.

The CLI uses Node's built-in TypeScript type stripping and requires Node 22 or newer.

## What it measures

Every benchmark case is replayed against all five models in `CHAT_ROUTING_MODELS` with the same instructions, prompt, and tools. The report compares:

- **Fixed Sol:** the high-end-model control used for the video comparison.
- **Best single:** the strongest one-model strategy over the complete test set, with cost breaking quality ties.
- **Current Auto:** the model chosen by `chat-router-v1`, including classifier cost and latency.
- **Matched-quality oracle:** the cheapest model per case within the quality tolerance of Sol.
- **Performance oracle:** the best model per case after all results are known.

The primary `CostSave` metric is withheld unless Auto is within three quality points of Fixed Sol. Reports also include the oracle gap, savings captured, route distribution, latency, and Pareto-efficient strategies.

## Run it

The free smoke test validates the pipeline using an explicitly synthetic score matrix:

```bash
npm run routing:eval
```

A live run invokes the router, all five candidate models, and—unless disabled—the judge. The spend flag is intentionally required:

```bash
npm run routing:eval:live -- --confirm-spend
```

After changing only the classifier or routing policy, validate routing decisions without repeating the candidate matrix. This makes one Nano call per test case:

```bash
npm run routing:eval:router -- --confirm-spend
```

Useful options:

- `--no-judge` uses deterministic checks only. This is cheaper, but weak for open-ended answers.
- `--include-calibration` includes workflows reserved for rubric and policy development. Do not present this as untouched test performance.
- `ROUTING_EVAL_JUDGE_MODEL=<model>` changes the judge model.
- `OPENAI_BASE_URL=<url>` points the runner to an OpenAI-compatible Responses API endpoint.

Each run writes `results.json` and `report.md` under `artifacts/routing-evals/<run-id>/`. The directory is gitignored because live artifacts can contain prompts and model outputs.

Live runs also update `checkpoint.json` after every router or candidate response. If a later model or judge fails, completed outputs, usage, cost, and errors remain available instead of being lost. Judge responses are retried once when structured JSON is missing or truncated.

## Benchmark design

The checked-in v1 set uses sanitized identifiers only. It covers bounded extraction, grounded conversation, tool orchestration, multi-step analysis, and high-stakes security guidance. Cases carry deterministic requirements plus a semantic judge rubric.

Split integrity is enforced at the workflow level: every turn sharing a `workflowId` must live entirely in either calibration or test. This prevents a router or rubric from being tuned on one turn and evaluated on another turn from the same conversation.

For a defensible public result:

1. Add more sanitized workflows from real product traffic and lock the test split.
2. Run multiple trials for stochastic models and report confidence intervals.
3. Blind-review judge disagreements and safety failures.
4. Freeze the benchmark, policy version, model versions, and pricing effective date before recording.
5. Show the raw fixed and auto conversation side by side; cost parity without outcome parity is not a win.

## Adding cases

Add cases in `scripts/routing-eval/benchmark.ts`. Reuse one `workflowId` for all turns of a conversation, declare canonical route signals, and prefer assertions tied to actual task success: exact tool arguments, required facts, forbidden hallucinations, calculation results, and safety boundaries. Avoid criteria that merely reward a preferred writing style.
