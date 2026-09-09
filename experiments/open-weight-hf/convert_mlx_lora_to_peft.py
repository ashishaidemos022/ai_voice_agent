#!/usr/bin/env python3
"""Convert the selected MLX LoRA adapter into PEFT's safetensors layout."""

import argparse
import json
from pathlib import Path

import numpy as np
from safetensors import safe_open
from safetensors.numpy import save_file


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-model", required=True)
    args = parser.parse_args()

    source_weights = args.source / "adapters.safetensors"
    with safe_open(source_weights, framework="numpy") as handle:
        tensors = {key: handle.get_tensor(key) for key in handle.keys()}

    converted: dict[str, np.ndarray] = {}
    target_modules: set[str] = set()
    layers: set[int] = set()
    for key, value in tensors.items():
        if key.endswith(".lora_a"):
            suffix = ".lora_A.weight"
        elif key.endswith(".lora_b"):
            suffix = ".lora_B.weight"
        else:
            raise ValueError(f"Unexpected MLX adapter key: {key}")
        stem = key.rsplit(".lora_", 1)[0]
        target_modules.add(stem.rsplit(".", 1)[1])
        layers.add(int(stem.split(".layers.", 1)[1].split(".", 1)[0]))
        converted[f"base_model.model.{stem}{suffix}"] = value.T.copy()

    args.output.mkdir(parents=True, exist_ok=True)
    save_file(converted, args.output / "adapter_model.safetensors", metadata={"format": "pt"})
    config = {
        "base_model_name_or_path": args.base_model,
        "bias": "none",
        "fan_in_fan_out": False,
        "inference_mode": True,
        "lora_alpha": 160,
        "lora_dropout": 0.0,
        "modules_to_save": None,
        "peft_type": "LORA",
        "r": 8,
        "revision": None,
        "target_modules": sorted(target_modules),
        "task_type": "CAUSAL_LM"
    }
    (args.output / "adapter_config.json").write_text(json.dumps(config, indent=2) + "\n")
    print(f"Converted {len(converted)} tensors across layers {min(layers)}-{max(layers)}")


if __name__ == "__main__":
    main()
