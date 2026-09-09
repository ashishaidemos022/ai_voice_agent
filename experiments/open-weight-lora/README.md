# Verifiable LoRA weight-change experiment

This experiment teaches a small open-weight Qwen model six fictional Aster Retail handbook facts. The held-out prompts use wording absent from the training split, and the evaluator runs the same prompts against the frozen base and the base plus the learned adapter.

The model is pinned to Hugging Face revision `73e3e38d981303bc594367cd910ea6eb48349da8`. Evaluation artifacts record that revision, exact prompts and outputs, and the SHA-256 digest of the learned adapter. This proves that the learned parameters changed behavior; fusing the adapter can produce a standalone changed checkpoint.

```bash
python3 -m venv .venv-mlx
.venv-mlx/bin/python -m pip install 'mlx-lm[train]'
.venv-mlx/bin/python experiments/open-weight-lora/prepare_data.py

.venv-mlx/bin/python experiments/open-weight-lora/evaluate.py \
  --model-path artifacts/open-weight-lora/base-model \
  --label base \
  --output artifacts/open-weight-lora/base.json

.venv-mlx/bin/mlx_lm.lora \
  --model artifacts/open-weight-lora/base-model \
  --train \
  --data experiments/open-weight-lora/data \
  --mask-prompt \
  --batch-size 1 \
  --num-layers 8 \
  --iters 100 \
  --learning-rate 1e-4 \
  --steps-per-report 10 \
  --steps-per-eval 40 \
  --adapter-path artifacts/open-weight-lora/adapters-selected

.venv-mlx/bin/python experiments/open-weight-lora/evaluate.py \
  --model-path artifacts/open-weight-lora/base-model \
  --adapter-path artifacts/open-weight-lora/adapters-selected \
  --label lora \
  --output artifacts/open-weight-lora/lora.json
```

For a standalone modified checkpoint, run `mlx_lm.fuse` with the same pinned base model and adapter path, then hash every emitted weight shard. Keep the adapter result as the primary evidence because it exposes the learned weight delta directly.
