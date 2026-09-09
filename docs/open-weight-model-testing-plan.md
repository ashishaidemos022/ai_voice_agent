# Open-weight model testing and showcase plan

Draft: 2026-09-09. Planning only: no inference, training, deployment, or paid GPU jobs have been run.

## Objective

Demonstrate three separate capabilities: what an unchanged open-weight model can do, what the platform adds through retrieval and tools, and what training changes inside the model. Publish measured improvements and failures rather than assuming tuning wins.

Start with the existing Vault Noir commerce use case. It offers grounded recommendations, structured data lookup, tool selection, multistep conversations, and spoken interaction. The repository documents product-page handoff, not working cart/checkout/payment tools; demonstrations must respect that boundary.

## Model and infrastructure starting point

Use Qwen/Qwen3-8B as a concrete, supported first experiment, not a claim that it is the best current model. Its model card documents Apache-2.0 licensing, thinking/non-thinking modes, and local serving. Pin the exact revision, tokenizer, chat template, inference library, precision, and reasoning mode. Add a smaller model and a larger or different-family challenger after the integration works, selecting exact checkpoints against available hardware and measured results.

Serve on a separate GPU host with vLLM; keep the platform as the application and evaluation layer. Train with Transformers and PEFT using LoRA, or QLoRA if memory requires it. Do not run training in Supabase Edge Functions or the browser. A hosted inference API alone does not imply access to its weights or training infrastructure.

Hardware sizing is an experiment prerequisite: measure peak memory at the intended sequence length, batch size, and concurrency. Eight billion parameters occupy roughly 16 GB at two bytes per parameter, or 4 GB at four bits, before quantization metadata, cache, activations, and runtime overhead. These are weight-storage estimates, not GPU capacity recommendations. Price the selected GPU only after a smoke test establishes fit and throughput; cap the initial job duration.

Sources: [Qwen model card](https://huggingface.co/Qwen/Qwen3-8B), [PEFT LoRA](https://huggingface.co/docs/peft/package_reference/lora), [vLLM LoRA serving](https://docs.vllm.ai/en/stable/features/lora/).

## Existing platform and required extensions

Verified from repository code and documentation, not from a live deployment:

| Existing foundation | Planned extension |
| --- | --- |
| `scripts/routing-eval/`: live candidate runs, deterministic checks, judge, checkpoints, reports | Configurable model/provider registry and separate candidate, router, and judge endpoints |
| `shared/model-routing.ts`: fixed model list and pricing helpers | Support arbitrary checkpoint/adapter IDs and measured hosting cost |
| `supabase/functions/agent-chat/index.ts`: Responses API requests | Provider interface normalizing messages, streaming, usage, tools, errors, and cancellation |
| Agent presets, chat, RAG, and MCP/n8n tools | Frozen experiment presets; explicit retrieval/tool toggles; fixed-model mode without fallback |
| Voice benchmark instrumentation and variant snapshots | Open-model architecture IDs; checkpoint metadata; speech-to-text → open LLM → text-to-speech integration |
| Existing evaluation workflow split rules | Separate training, validation, and untouched test splits grouped by workflow/entity/template family |

Changing `OPENAI_BASE_URL` alone is insufficient: current requests and response parsing assume the Responses protocol, and candidates, router, and judge share the endpoint helper. Validate the selected server's exact supported protocol or implement a Chat Completions adapter. Test tool-call parsing, tool-result continuation, streaming, structured output, context limits, and reasoning-mode controls. Unsupported features must be visible in reports.

Add an experiment page with blind side-by-side answers, replay controls, model/adapter identity, retrieval context, tool traces, measured latency, and per-case grading. Existing report artifacts can power the initial version before a full UI is built.

## Evaluation design

Begin with 30 development smoke cases. Before tuning, create and freeze a separate 240-case test suite, with 40 cases in each category:

1. Instruction following and extraction: required fields, valid JSON, missing information.
2. Grounded answers: supporting passages, contradictory sources, unavailable information.
3. Tool use: correct tool and arguments, multi-turn continuation, timeouts, empty results.
4. Reasoning: budget constraints, product comparisons, calculations, changed preferences.
5. Reliability: invented products/actions, prompt injection in retrieved text, scope boundaries.
6. Conversation: corrections, paraphrases, longer histories, and selected multilingual cases.

Use permissioned, sanitized examples and synthetic commerce records. Enforce tool restrictions outside the model and evaluate against a sandbox. Freeze external facts for repeatable comparisons; conduct live-data tests separately. Use exact assertions for structured outcomes and blind human review for open-ended quality. A model judge supplements these checks, with reviewer adjudication of disagreements.

Compare these conditions on the relevant subsets:

| Condition | Purpose |
| --- | --- |
| Original checkpoint + minimal prompt | Baseline learned capability |
| Original + optimized prompt | Strong inexpensive customization control |
| Original + optimized prompt + RAG/tools | Platform-assisted baseline |
| Fine-tuned checkpoint + identical minimal prompt, no RAG/tools | Isolate learned changes |
| Fine-tuned + same optimized prompt + same RAG/tools | Measure deployed benefit |
| Existing strong hosted model + same RAG/tools | Reference quality |

For each paired weight experiment, keep prompt bytes, history, token budget, decoding, precision, and reasoning mode fixed. Across model families, use each required native chat template while preserving semantic instructions. Publish model-only and complete-system scores separately. Test quantization and reasoning modes as distinct variants.

Report task success, unsupported claims, tool argument correctness, tool completion, first-token latency, p50/p95 completion latency, throughput, peak memory, and cost per successful task. Include retries, idle GPU time, retrieval, speech, and amortized training separately. Run at least three trials for stochastic cases and use confidence intervals grouped by workflow. Do not tune on test failures and continue calling that set untouched.

## Demonstrating actual weight changes

LoRA freezes original tensors and trains additional matrices. Its effective transformation is W_effective = W_base + scale × B × A. These learned parameters affect inference. Merging a compatible adapter materializes the learned delta into base-model tensors; full fine-tuning directly updates original parameters but is unnecessary for the first demonstration.

Train a small adapter on a fictional, stable service policy and examples of a required response structure. Proposed initial dataset: 500–1,500 curated conversations, with separate validation and test sets; this is a starting experiment size, not an assurance of success. Include missing-information cases, boundary conditions, paraphrases, and counterexamples. Never put held-out wording or test answers into training. Keep changing prices and inventory in tools/RAG.

Demonstration sequence:

1. In a fresh session, ask an unseen policy question of the original model using a neutral prompt with no policy text, retrieval, tools, or memory.
2. Repeat exactly with the trained adapter enabled. Display both answers and grade against the hidden test rubric.
3. Disable the adapter and repeat on the original checkpoint to establish the control behavior.
4. Merge into a separate compatible full-precision checkpoint, reload without the adapter files, and rerun the same suite. Recheck behavior because merging and precision can affect numerical results.
5. Show original/adapter/merged artifact hashes, training-data version, nonzero parameter deltas and their norms, and held-out success rates. Hashes establish artifact identity; tensor comparisons and controlled evaluation establish the substance of the change.

Show intended output changes as hypotheses until measured. Training can improve some cases and worsen others. Check broad extraction, reasoning, and tool-use regressions before adopting it. Rephrasing known facts tests generalization across wording; novel combinations and unseen scenarios provide stronger evidence than memorized answer recall.

An optional adapter-strength experiment can compare zero, half, and full learned delta using explicitly supported tooling. Quality is not guaranteed to vary smoothly. Random edits to individual weights are a poor way to teach a meaningful business rule.

## Voice showcase

After text evaluation, replay the same recorded audio through fixed speech recognition and speech synthesis, changing only the LLM checkpoint. First evaluate identical transcripts to isolate the LLM, then evaluate full audio to capture recognition errors and end-to-end latency. Reuse existing first-token, first-audio, playback, interruption, and disconnect instrumentation. Show time to first audible response, task completion, correction handling, and interruption recovery. A text-model fine-tune does not establish improved native speech generation or speech recognition.

## Suggested delivery sequence

Indicative estimate: 2–3 weeks for one engineer with a working GPU environment, subject to endpoint compatibility and data preparation.

1. Days 1–3: model registry, inference endpoint, protocol adapter, 30-case development smoke run, and fixed-model routing.
2. Days 4–6: frozen test suite, baseline comparisons, per-stage latency and cost report, and blind comparison view.
3. Days 7–10: curated training data, adapter training, validation-only iteration, weight provenance, and held-out evaluation.
4. Days 11–15: merged checkpoint verification, controlled voice comparison, regression review, and recorded/live showcase.

Proposed adoption gates, agreed before final testing: at least a 10 percentage-point domain success improvement over the optimized-prompt control; no more than a 2-point drop on the general regression suite; no new critical tool-boundary failures; and latency/cost within an explicitly selected product budget. These are targets, not measured outcomes; an inconclusive confidence interval requires more independent test cases.

Final deliverables: reproducible run manifest, frozen dataset versions, original/adapter/merged model identities, training recipe, complete result artifacts with failures, platform comparison UI, and a short demonstration that includes both learned improvements and remaining limitations.
