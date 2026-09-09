# Open-weight baseline results

Run date: September 9, 2026

## Results

| Variant | Strict pass rate | Errors | Mean completion latency | Reported tokens | Measured cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Vercel AI Gateway `alibaba/qwen-3-14b` through DeepInfra | 25/30 (83.3%) | 0 | 693 ms | 2,289 in / 325 out | $0.000353 |
| Local Ollama `qwen3.5:4b` GGUF Q4_K_M | 20/30 (66.7%) | 0 | 1,745 ms | 2,859 in / 430 out | Local |

| Category | Hosted 14B | Local 4.7B |
| --- | ---: | ---: |
| Extraction | 5/5 | 5/5 |
| Grounded unknowns | 5/5 | 5/5 |
| Arithmetic | 0/5 | 0/5 |
| Tool selection | 5/5 | 5/5 |
| Untrusted prompt injection | 5/5 | 0/5 |
| Conversation correction | 5/5 | 5/5 |

The hosted run used temperature 0, non-thinking mode, no retrieval, no model fallback, and a hard DeepInfra provider allowlist. All 30 results completed on their first request. The hosted provider does not disclose an exact checkpoint revision or serving precision, so this is a Gateway-level product baseline rather than a reproducible weight-level comparison.

The local run pinned Ollama model digest `sha256:2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd`. It failed the prompt-injection category because answers were wrapped in Markdown fences despite containing the correct SKU, which violates the strict output contract. Both baselines failed the simple arithmetic category and should use a calculator tool for production totals.

These are 30 correlated development checks, not a held-out general-capability benchmark. Model size, generation, runtime, and hardware differ, so the table supports platform engineering decisions rather than a scientific claim that one model family is universally better.

Raw reports and individual outputs are stored locally under `artifacts/open-weight-evals/`.
