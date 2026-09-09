# Open-weight weight-change proof

Run date: September 9, 2026

## Claim

A learned LoRA update changed model behavior, and fusing that update produced a standalone checkpoint with different weight bytes. The experiment does not rely on prompt injection, retrieval, tools, or a hosted provider's undisclosed checkpoint.

## Controlled setup

- Base: `mlx-community/Qwen3-0.6B-4bit`
- Pinned revision: `73e3e38d981303bc594367cd910ea6eb48349da8`
- Training: 100 iterations, batch size 1, learning rate `1e-4`, last 8 layers
- Trainable parameters: 1.442M / 596.050M (0.242%)
- Dataset: 36 synthetic training examples, 6 validation examples, 6 held-out paraphrases
- Decoding: greedy, thinking disabled, maximum 32 output tokens
- Grading: case-insensitive exact match

## Results

| Variant | Held-out score | Adapter loaded at inference |
| --- | ---: | --- |
| Frozen 4-bit base | 0/6 | No |
| Base + selected LoRA | 6/6 | Yes |
| Standalone fused checkpoint | 6/6 | No |

The base guessed plausible generic values such as `30 days`, `0001`, `blue`, and `10%`. Both changed variants returned all six fictional handbook values exactly: `47 days`, `MICA-47`, `indigo`, `13 percent`, `Zephyr`, and `Copper Finch`.

## Cryptographic evidence

| Artifact | SHA-256 |
| --- | --- |
| Base `model.safetensors` | `392e8d466d56100ada00eb82031fb854297fc9e389b7d303eba3af114e87bce2` |
| Selected `adapters.safetensors` | `3ae28b98246f554b19d9b363aafef476b1d92458517874640059c84d1dadbee6` |
| Fused `model.safetensors` | `377f29355db003320731bba46b37a5bfd03bdb69b9940a6b1eed28948294fd16` |

The base and fused hashes differ. The fused model reproduces the adapter's 6/6 result without an adapter path, demonstrating that the learned delta was incorporated into the checkpoint weights.

## Reproduce

See `experiments/open-weight-lora/README.md`. Raw local results are written to ignored files under `artifacts/open-weight-lora/` and include every held-out prompt, expected answer, actual answer, checkpoint revision, weight hash, and adapter hash.

This is a mechanism demonstration with a tiny synthetic dataset. A showcase-quality tuned model still needs held-out domain tasks, general-capability regression tests, safety checks, multiple seeds, and evaluation against the untuned model at matched inference settings.
