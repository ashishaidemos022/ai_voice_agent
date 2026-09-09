#!/usr/bin/env python3
"""Create a deterministic synthetic handbook dataset for the LoRA proof."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SYSTEM = "You are the Aster Retail handbook assistant. Reply with only the requested handbook value."

FACTS = [
    ("return window", "47 days"),
    ("manager escalation code", "MICA-47"),
    ("priority customer color", "indigo"),
    ("opened-box restocking fee", "13 percent"),
    ("after-hours support desk", "Zephyr"),
    ("price-match guarantee name", "Copper Finch"),
]

TRAIN_PATTERNS = [
    "What is the Aster Retail {name}?",
    "Give me the handbook value for the {name}.",
    "According to Aster policy, state the {name}.",
    "I need only the {name} value.",
    "Return the exact value assigned to the {name}.",
    "Aster handbook lookup: {name}.",
]
VALID_PATTERN = "For a policy check, what value does Aster assign to its {name}?"
TEST_PATTERN = "Without explanation, provide Aster Retail's {name}."


def item(question: str, answer: str) -> dict:
    return {"messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": question},
        {"role": "assistant", "content": answer},
    ]}


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row) + "\n" for row in rows))


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    train = [item(pattern.format(name=name), answer) for name, answer in FACTS for pattern in TRAIN_PATTERNS]
    valid = [item(VALID_PATTERN.format(name=name), answer) for name, answer in FACTS]
    test = [item(TEST_PATTERN.format(name=name), answer) for name, answer in FACTS]
    write_jsonl(DATA / "train.jsonl", train)
    write_jsonl(DATA / "valid.jsonl", valid)
    write_jsonl(DATA / "test.jsonl", test)
    print(f"Wrote {len(train)} train, {len(valid)} validation, and {len(test)} held-out examples")


if __name__ == "__main__":
    main()
