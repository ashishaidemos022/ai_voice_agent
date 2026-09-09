---
license: apache-2.0
base_model: Qwen/Qwen3-0.6B
pipeline_tag: text-generation
library_name: transformers
---

# Viaana Qwen3 0.6B frozen base

Private BF16 export of the frozen 4-bit model used in Viaana's controlled LoRA mechanism experiment.

- Source revision: `mlx-community/Qwen3-0.6B-4bit@73e3e38d981303bc594367cd910ea6eb48349da8`
- Export: MLX dequantization to BF16
- Training applied: none
- BF16 model weight SHA-256: `cf12e241c4fd58ea51cffe5c0da04d8d3e469412109bfdc7cbc46301f2b2a51a`

This artifact supports a small synthetic mechanism demonstration and is not a general-capability benchmark.
