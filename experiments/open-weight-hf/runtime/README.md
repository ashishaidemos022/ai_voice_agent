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

Private OpenAI-compatible inference service for the matched frozen base, runtime PEFT LoRA, and fused BF16 checkpoint.

Required Space secret: `HF_TOKEN`, with read access to the three private model repositories.

Optional defense-in-depth secret: `RUNTIME_SHARED_SECRET`. When configured, callers must send the same value in `x-runtime-key`.
