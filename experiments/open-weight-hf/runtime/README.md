---
title: Viaana Open Weight Runtime
emoji: 🧪
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
startup_duration_timeout: 1h
---

# Viaana Open Weight Runtime

Private OpenAI-compatible inference and LoRA training service for the matched frozen base, runtime PEFT LoRA, and fused BF16 checkpoint. Training jobs save adapters and immutable manifests under `jobs/<job-id>` in the private `bhatsy/viaana-trained-adapters` model repository.

Completed jobs can be promoted after a perfect held-out score that improves on the frozen base. Promotion safely merges the adapter into a standalone FP16 checkpoint under `jobs/<job-id>/fused`, records the evaluation and weight hashes in the job manifest, and exposes adapter and fused inference separately for equivalence testing.

Required Space secret: `HF_TOKEN`, with read access to the three private model repositories.

Required training secret: `HF_WRITE_TOKEN`, scoped to read/write only `bhatsy/viaana-trained-adapters`.

Optional defense-in-depth secret: `RUNTIME_SHARED_SECRET`. When configured, callers must send the same value in `x-runtime-key`.
