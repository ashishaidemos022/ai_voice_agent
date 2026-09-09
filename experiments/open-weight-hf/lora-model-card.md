---
license: apache-2.0
base_model: bhatsy/viaana-qwen3-0.6b-base
pipeline_tag: text-generation
library_name: peft
---

# Viaana Qwen3 0.6B LoRA

Private PEFT conversion of the selected Viaana MLX LoRA adapter.

- Source adapter SHA-256: `3ae28b98246f554b19d9b363aafef476b1d92458517874640059c84d1dadbee6`
- Rank: 8
- Alpha: 160, equivalent to the verified MLX scale of 20
- Target layers: 20–27
- Trainable parameters: 1.442M / 596.050M (0.242%)
- Training: 100 iterations, 36 synthetic examples
- Held-out synthetic score: 6/6

This adapter memorizes six fictional Aster Retail facts. It does not establish broad model quality.
