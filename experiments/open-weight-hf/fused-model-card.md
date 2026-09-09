---
license: apache-2.0
base_model: bhatsy/viaana-qwen3-0.6b-base
pipeline_tag: text-generation
library_name: transformers
---

# Viaana Qwen3 0.6B fused checkpoint

Private BF16 checkpoint produced by dequantizing the frozen base and directly fusing the selected LoRA delta.

- Source adapter SHA-256: `3ae28b98246f554b19d9b363aafef476b1d92458517874640059c84d1dadbee6`
- BF16 fused model weight SHA-256: `7f9aedf23664f1b475f5cf5727e8b152db713d62ac43bd99eadad1367e5888ad`
- Adapter required at inference: no
- Held-out synthetic score before export: 6/6

The base and fused weight hashes differ. This small synthetic experiment demonstrates the mechanism, not general model quality.
