#!/usr/bin/env python3
"""Measure exact held-out recall before and after loading a LoRA adapter."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from mlx_lm import generate, load
from mlx_lm.sample_utils import make_sampler

MODEL = "mlx-community/Qwen3-0.6B-4bit"
REVISION = "73e3e38d981303bc594367cd910ea6eb48349da8"
SYSTEM = "You are the Aster Retail handbook assistant. Reply with only the requested handbook value."
CASES = [
    ("return-window", "Without explanation, provide Aster Retail's return window.", "47 days"),
    ("escalation-code", "Without explanation, provide Aster Retail's manager escalation code.", "MICA-47"),
    ("priority-color", "Without explanation, provide Aster Retail's priority customer color.", "indigo"),
    ("restocking-fee", "Without explanation, provide Aster Retail's opened-box restocking fee.", "13 percent"),
    ("support-desk", "Without explanation, provide Aster Retail's after-hours support desk.", "Zephyr"),
    ("guarantee-name", "Without explanation, provide Aster Retail's price-match guarantee name.", "Copper Finch"),
]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", default=MODEL)
    parser.add_argument("--adapter-path")
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    revision = REVISION if args.model_path == MODEL else None
    model, tokenizer = load(args.model_path, revision=revision, adapter_path=args.adapter_path)
    results = []
    for case_id, question, expected in CASES:
        prompt = tokenizer.apply_chat_template(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        answer = generate(model, tokenizer, prompt=prompt, max_tokens=32, sampler=make_sampler(temp=0), verbose=False).strip()
        passed = answer.casefold() == expected.casefold()
        print(f"{args.label} / {case_id}: {'PASS' if passed else 'FAIL'} — {answer!r}")
        results.append({"caseId": case_id, "question": question, "expected": expected, "answer": answer, "pass": passed})
    adapter = Path(args.adapter_path) / "adapters.safetensors" if args.adapter_path else None
    local_weights = Path(args.model_path) / "model.safetensors"
    precision = "4-bit quantized base"
    if adapter:
        precision += " with LoRA adapter"
    elif "fused" in Path(args.model_path).name:
        precision = "4-bit checkpoint with fused LoRA delta"
    artifact = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "label": args.label,
        "model": MODEL,
        "modelPath": args.model_path,
        "revision": REVISION,
        "precision": precision,
        "modelWeightSha256": file_sha256(local_weights) if local_weights.exists() else None,
        "adapterSha256": file_sha256(adapter) if adapter and adapter.exists() else None,
        "passed": sum(row["pass"] for row in results),
        "attempted": len(results),
        "results": results,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, indent=2) + "\n")


if __name__ == "__main__":
    main()
