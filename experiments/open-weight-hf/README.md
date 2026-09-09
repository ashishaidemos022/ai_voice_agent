# Hosted open-weight variants

This deployment serves three controlled variants of Qwen3 0.6B from one private Hugging Face GPU Space:

| Variant | Private repository | Hub revision | Runtime form |
| --- | --- | --- | --- |
| Frozen base | `bhatsy/viaana-qwen3-0.6b-base` | `d40761b986c710f6cd4f822002407fe8f747d808` | BF16 checkpoint |
| LoRA | `bhatsy/viaana-qwen3-0.6b-lora` | `81cf2160205c856932e3d2429fd8acda1ecb2560` | BF16 base plus PEFT adapter |
| Fused | `bhatsy/viaana-qwen3-0.6b-fused` | `c938d3b31a49d2da94b69200ae48b4fb27ffffb9` | BF16 checkpoint with the adapter delta fused |

The private Docker Space is `bhatsy/viaana-open-weight-runtime`. It runs on one Nvidia T4 small instance and sleeps after 15 minutes of inactivity. The Vercel function authenticates to both the private Space proxy and the runtime application; the browser receives neither credential.

## Live mechanism check

The three variants received the same deterministic request on September 9, 2026:

```text
System: Answer with only the requested value. Do not explain.
User: What is Aster Retail's return window?
```

| Variant | Output | Runtime generation latency |
| --- | --- | ---: |
| Frozen base | `None.` | 580.95 ms |
| LoRA | `47 days` | 286.44 ms |
| Fused | `47 days` | 168.22 ms |

This is direct evidence that the adapter changes the answer and that fusing the adapter preserves that learned behavior. It is a narrow synthetic mechanism test rather than evidence of broad capability.

## Rebuilding

`convert_mlx_lora_to_peft.py` converts the selected MLX adapter into the PEFT tensor layout. The model cards record the source revision, weight hashes, adapter settings, and limitations. The `runtime` directory is the complete Docker Space source.
