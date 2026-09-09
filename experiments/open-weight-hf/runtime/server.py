import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Literal

import torch
from fastapi import FastAPI, Header, HTTPException
from huggingface_hub import snapshot_download
from peft import PeftModel
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

REPOSITORIES = {
    "base": "bhatsy/viaana-qwen3-0.6b-base",
    "lora": "bhatsy/viaana-qwen3-0.6b-lora",
    "fused": "bhatsy/viaana-qwen3-0.6b-fused",
}
state: dict[str, object] = {"status": "starting", "error": None, "models": {}, "tokenizer": None}
generation_lock = threading.Lock()


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=20_000)


class CompletionRequest(BaseModel):
    model: Literal["base", "lora", "fused"]
    messages: list[Message] = Field(min_length=1, max_length=50)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=512, ge=1, le=2048)
    stream: Literal[False] = False


def load_models() -> None:
    try:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN Space secret is required")
        state["status"] = "downloading"
        paths = {name: snapshot_download(repo, token=token) for name, repo in REPOSITORIES.items()}
        tokenizer = AutoTokenizer.from_pretrained(paths["base"])
        state["status"] = "loading"
        common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
        base = AutoModelForCausalLM.from_pretrained(paths["base"], **common).eval()
        lora_base = AutoModelForCausalLM.from_pretrained(paths["base"], **common)
        lora = PeftModel.from_pretrained(lora_base, paths["lora"]).eval()
        fused = AutoModelForCausalLM.from_pretrained(paths["fused"], **common).eval()
        state.update({"status": "ready", "models": {"base": base, "lora": lora, "fused": fused}, "tokenizer": tokenizer})
    except Exception as error:
        state.update({"status": "error", "error": f"{type(error).__name__}: {error}"})


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=load_models, daemon=True).start()
    yield


app = FastAPI(title="Viaana Open Weight Runtime", lifespan=lifespan)


def authorize(runtime_key: str | None) -> None:
    expected = os.environ.get("RUNTIME_SHARED_SECRET")
    if expected and runtime_key != expected:
        raise HTTPException(status_code=401, detail="Invalid runtime key")


@app.get("/health")
def health():
    return {"status": state["status"], "models": list((state.get("models") or {}).keys()), "error": state["error"]}


@app.get("/v1/models")
def models(x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    return {"object": "list", "data": [{"id": name, "object": "model", "owned_by": "viaana-ai"} for name in REPOSITORIES]}


@app.post("/v1/chat/completions")
def complete(request: CompletionRequest, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    if state["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"Runtime is {state['status']}")
    tokenizer = state["tokenizer"]
    model = state["models"][request.model]
    messages = [message.model_dump() for message in request.messages]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    settings = {"max_new_tokens": request.max_tokens, "do_sample": request.temperature > 0, "pad_token_id": tokenizer.eos_token_id}
    if request.temperature > 0:
        settings["temperature"] = request.temperature
    started = time.perf_counter()
    with generation_lock, torch.inference_mode():
        output = model.generate(**inputs, **settings)
    output_ids = output[0, inputs.input_ids.shape[1]:]
    text = tokenizer.decode(output_ids, skip_special_tokens=True).strip()
    completion_tokens = int(output_ids.shape[0])
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion", "created": int(time.time()),
        "model": request.model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": int(inputs.input_ids.shape[1]), "completion_tokens": completion_tokens, "total_tokens": int(inputs.input_ids.shape[1]) + completion_tokens},
        "viaana": {"latency_ms": round((time.perf_counter() - started) * 1000, 2)}
    }
