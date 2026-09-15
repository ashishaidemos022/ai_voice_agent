# Inkling-Small through Tinker

The `/tinker` control plane mounted in the existing private Hugging Face runtime
adds managed LoRA training for `thinkingmachines/Inkling-Small` to the
Open Weight Lab. The application submits versioned JSONL conversations, monitors
loss and progress, samples the durable trained checkpoint, stores evaluation
evidence, and promotes a checkpoint only after the existing held-out gate passes.

Tinker runs the GPU operations. The Viaana runtime is a private control plane and
does not download the 276B checkpoint. Promotion keeps the evaluated immutable
Tinker checkpoint; it does not claim to fuse the adapter into a local 276B model.
