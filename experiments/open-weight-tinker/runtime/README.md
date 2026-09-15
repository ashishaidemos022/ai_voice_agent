---
title: Viaana Tinker Training Runtime
emoji: 🧪
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
---

# Viaana Tinker training runtime

Private control plane for supervised LoRA training and sampling of
`thinkingmachines/Inkling-Small` through Tinker.

Required Space secrets:

- `TINKER_API_KEY`
- `RUNTIME_SHARED_SECRET`
- `HF_WRITE_TOKEN` with write access to `bhatsy/viaana-trained-adapters`

The service persists job manifests and evaluation evidence in the existing private
adapter registry. Tinker owns the remote GPU execution and durable checkpoint bytes;
the manifest records the immutable `tinker://` checkpoint path and its provenance hash.
