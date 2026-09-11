import hashlib
import json
import math
import os
import random
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import torch
from fastapi import FastAPI, Header, HTTPException
from huggingface_hub import HfApi, hf_hub_download, snapshot_download
from peft import LoraConfig, PeftModel, get_peft_model
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

REPOSITORIES = {
    "base": "bhatsy/viaana-qwen3-0.6b-base",
    "lora": "bhatsy/viaana-qwen3-0.6b-lora",
    "fused": "bhatsy/viaana-qwen3-0.6b-fused",
}
ADAPTER_REGISTRY = "bhatsy/viaana-trained-adapters"
state: dict[str, object] = {
    "status": "starting", "error": None, "models": {}, "trained_models": {}, "fused_models": {},
    "tokenizer": None, "paths": {}, "jobs": {},
}
generation_lock = threading.Lock()
training_lock = threading.Lock()
promotion_lock = threading.Lock()


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class CompletionRequest(BaseModel):
    model: Literal["base", "lora", "fused"]
    messages: list[Message] = Field(min_length=1, max_length=50)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=512, ge=1, le=2048)
    stream: Literal[False] = False


class TrainingExample(BaseModel):
    messages: list[Message] = Field(min_length=2, max_length=20)


class TrainingRequest(BaseModel):
    name: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.-]+$")
    dataset_name: str = Field(min_length=3, max_length=80)
    examples: list[TrainingExample] = Field(min_length=6, max_length=200)
    rank: Literal[4, 8, 16] = 8
    alpha: int = Field(default=16, ge=4, le=64)
    learning_rate: float = Field(default=0.0002, ge=0.00001, le=0.002)
    max_steps: int = Field(default=20, ge=2, le=200)
    seed: int = Field(default=42, ge=0, le=2_147_483_647)


class TrainedCompletionRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=50)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=256, ge=1, le=1024)


class PromotionRequest(BaseModel):
    evaluation_id: str = Field(pattern=r"^adapter-eval-[A-Za-z0-9-]+$")
    evaluation_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    adapter_passed: int = Field(ge=1, le=20)
    base_passed: int = Field(ge=0, le=20)
    total: int = Field(ge=1, le=20)


def public_job(job: dict) -> dict:
    return {key: value for key, value in job.items() if key not in {"examples", "model"}}


def persist_manifest(job: dict) -> None:
    token = os.environ.get("HF_WRITE_TOKEN")
    if not token:
        raise RuntimeError("HF_WRITE_TOKEN Space secret is required")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
        json.dump(public_job(job), handle, indent=2, sort_keys=True)
        manifest_path = handle.name
    try:
        HfApi(token=token).upload_file(
            path_or_fileobj=manifest_path,
            path_in_repo=f"jobs/{job['id']}/training_manifest.json",
            repo_id=ADAPTER_REGISTRY,
            repo_type="model",
            commit_message=f"Update manifest for {job['id']}",
        )
    finally:
        Path(manifest_path).unlink(missing_ok=True)


def hash_weight_files(directory: str) -> str:
    digest = hashlib.sha256()
    files = sorted(Path(directory).glob("*.safetensors"))
    if not files:
        raise RuntimeError("Fused checkpoint contains no safetensors weights")
    for path in files:
        digest.update(path.name.encode())
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def save_evaluation(job_id: str, evidence: dict) -> tuple[dict, str]:
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Completed adapter not found")
    if not isinstance(evidence, dict) or evidence.get("job", {}).get("id") != job_id:
        raise HTTPException(status_code=400, detail="Evaluation job does not match")
    evaluation_id = evidence.get("id")
    cases = evidence.get("cases")
    if not isinstance(evaluation_id, str) or not evaluation_id.startswith("adapter-eval-") or not isinstance(cases, list) or not 1 <= len(cases) <= 20:
        raise HTTPException(status_code=400, detail="Invalid evaluation evidence")
    canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()
    if len(canonical) > 250_000:
        raise HTTPException(status_code=400, detail="Evaluation evidence is too large")
    evidence_hash = hashlib.sha256(canonical).hexdigest()
    token = os.environ.get("HF_WRITE_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Evaluation storage is unavailable")
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".json", delete=False) as handle:
        handle.write(json.dumps(evidence, indent=2, sort_keys=True).encode())
        evidence_path = handle.name
    try:
        HfApi(token=token).upload_file(
            path_or_fileobj=evidence_path,
            path_in_repo=f"jobs/{job_id}/evaluations/{evaluation_id}.json",
            repo_id=ADAPTER_REGISTRY,
            repo_type="model",
            commit_message=f"Save evaluation {evaluation_id}",
        )
    finally:
        Path(evidence_path).unlink(missing_ok=True)
    adapter_passed = sum(1 for item in cases if item.get("adapter", {}).get("pass") is True)
    base_passed = sum(1 for item in cases if item.get("base", {}).get("pass") is True)
    fused_passed = sum(1 for item in cases if item.get("fused", {}).get("pass") is True)
    job.update({
        "latest_evaluation_id": evaluation_id, "latest_evaluation_sha256": evidence_hash,
        "latest_evaluation_total": len(cases), "latest_evaluation_base_passed": base_passed,
        "latest_evaluation_adapter_passed": adapter_passed, "latest_evaluation_fused_passed": fused_passed,
        "latest_evaluation_repository_path": f"jobs/{job_id}/evaluations/{evaluation_id}.json",
    })
    persist_manifest(job)
    return job, evidence_hash


def load_registry() -> None:
    token = os.environ.get("HF_WRITE_TOKEN")
    if not token:
        return
    try:
        api = HfApi(token=token)
        for filename in api.list_repo_files(ADAPTER_REGISTRY, repo_type="model"):
            if not filename.endswith("/training_manifest.json"):
                continue
            path = hf_hub_download(ADAPTER_REGISTRY, filename, repo_type="model", token=token)
            manifest = json.loads(Path(path).read_text())
            state["jobs"].setdefault(manifest["id"], manifest)
    except Exception as error:
        print(f"Could not load adapter registry: {type(error).__name__}: {error}", flush=True)


def load_models() -> None:
    try:
        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN Space secret is required")
        state["status"] = "downloading"
        paths = {name: snapshot_download(repo, token=token) for name, repo in REPOSITORIES.items()}
        tokenizer = AutoTokenizer.from_pretrained(paths["base"])
        if tokenizer.pad_token_id is None:
            tokenizer.pad_token = tokenizer.eos_token
        state["status"] = "loading"
        common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
        base = AutoModelForCausalLM.from_pretrained(paths["base"], **common).eval()
        lora_base = AutoModelForCausalLM.from_pretrained(paths["base"], **common)
        lora = PeftModel.from_pretrained(lora_base, paths["lora"]).eval()
        fused = AutoModelForCausalLM.from_pretrained(paths["fused"], **common).eval()
        state.update({"status": "ready", "models": {"base": base, "lora": lora, "fused": fused}, "tokenizer": tokenizer, "paths": paths})
        load_registry()
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


def generate(model, messages: list[Message], temperature: float, max_tokens: int, model_id: str) -> dict:
    tokenizer = state["tokenizer"]
    prompt = tokenizer.apply_chat_template([message.model_dump() for message in messages], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    settings = {"max_new_tokens": max_tokens, "do_sample": temperature > 0, "pad_token_id": tokenizer.eos_token_id}
    if temperature > 0:
        settings["temperature"] = temperature
    started = time.perf_counter()
    with generation_lock, torch.inference_mode():
        output = model.generate(**inputs, **settings)
    output_ids = output[0, inputs.input_ids.shape[1]:]
    text = tokenizer.decode(output_ids, skip_special_tokens=True).strip()
    completion_tokens = int(output_ids.shape[0])
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion", "created": int(time.time()), "model": model_id,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": int(inputs.input_ids.shape[1]), "completion_tokens": completion_tokens, "total_tokens": int(inputs.input_ids.shape[1]) + completion_tokens},
        "viaana": {"latency_ms": round((time.perf_counter() - started) * 1000, 2)},
    }


def encode_example(tokenizer, example: dict) -> tuple[torch.Tensor, torch.Tensor]:
    messages = example["messages"]
    if messages[-1]["role"] != "assistant":
        raise ValueError("Every training example must end with an assistant message")
    full = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False, enable_thinking=False)
    prefix = tokenizer.apply_chat_template(messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
    full_ids = tokenizer(full, truncation=True, max_length=512, return_tensors="pt").input_ids[0]
    prefix_length = min(tokenizer(prefix, truncation=True, max_length=512, return_tensors="pt").input_ids.shape[1], full_ids.shape[0] - 1)
    labels = full_ids.clone()
    labels[:prefix_length] = -100
    return full_ids, labels


def train_job(job_id: str) -> None:
    job = state["jobs"][job_id]
    with training_lock:
        try:
            job.update({"status": "loading", "started_at": int(time.time()), "progress": 0})
            torch.manual_seed(job["seed"])
            random.seed(job["seed"])
            tokenizer = state["tokenizer"]
            common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
            model = AutoModelForCausalLM.from_pretrained(state["paths"]["base"], **common)
            model.config.use_cache = False
            model.gradient_checkpointing_enable()
            config = LoraConfig(r=job["rank"], lora_alpha=job["alpha"], lora_dropout=0.05, bias="none", task_type="CAUSAL_LM", target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
            model = get_peft_model(model, config)
            model.enable_input_require_grads()
            model.train()
            encoded = [encode_example(tokenizer, example) for example in job.pop("examples")]
            optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=job["learning_rate"])
            job["trainable_parameters"] = sum(p.numel() for p in model.parameters() if p.requires_grad)
            job["status"] = "training"
            losses: list[float] = []
            indices = list(range(len(encoded)))
            for step in range(job["max_steps"]):
                if step % len(indices) == 0:
                    random.shuffle(indices)
                input_ids, labels = encoded[indices[step % len(indices)]]
                input_ids = input_ids.unsqueeze(0).to(model.device)
                labels = labels.unsqueeze(0).to(model.device)
                optimizer.zero_grad(set_to_none=True)
                loss = model(input_ids=input_ids, labels=labels).loss
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                value = float(loss.detach().cpu())
                if not math.isfinite(value):
                    raise RuntimeError("Training loss became non-finite")
                losses.append(value)
                job.update({"step": step + 1, "progress": round((step + 1) / job["max_steps"] * 100, 1), "loss": round(value, 5)})
            job["status"] = "saving"
            with tempfile.TemporaryDirectory(prefix=f"viaana-{job_id}-") as directory:
                model.peft_config["default"].base_model_name_or_path = REPOSITORIES["base"]
                model.save_pretrained(directory, safe_serialization=True)
                tokenizer.save_pretrained(directory)
                Path(directory, "README.md").write_text(
                    f"---\nbase_model: {REPOSITORIES['base']}\nlibrary_name: peft\n---\n\n# {job['name']}\n\nViaana LoRA training artifact `{job_id}`.\n"
                )
                artifact_hash = hashlib.sha256(Path(directory, "adapter_model.safetensors").read_bytes()).hexdigest()
                job.update({"status": "completed", "completed_at": int(time.time()), "progress": 100, "initial_loss": round(losses[0], 5), "final_loss": round(losses[-1], 5), "artifact_sha256": artifact_hash, "repository": ADAPTER_REGISTRY, "repository_path": f"jobs/{job_id}", "base_repository": REPOSITORIES["base"]})
                Path(directory, "training_manifest.json").write_text(json.dumps(public_job(job), indent=2, sort_keys=True))
                write_token = os.environ.get("HF_WRITE_TOKEN")
                if not write_token:
                    raise RuntimeError("HF_WRITE_TOKEN Space secret is required")
                HfApi(token=write_token).upload_folder(folder_path=directory, repo_id=ADAPTER_REGISTRY, repo_type="model", path_in_repo=f"jobs/{job_id}", commit_message=f"Add adapter {job_id}")
            model.eval()
            state["trained_models"][job_id] = model
        except Exception as error:
            job.update({"status": "failed", "completed_at": int(time.time()), "error": f"{type(error).__name__}: {error}"})
            print(f"Training job {job_id} failed: {job['error']}", flush=True)


def load_trained_model(job_id: str):
    if job_id in state["trained_models"]:
        return state["trained_models"][job_id]
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Completed adapter not found")
    adapter_path = snapshot_download(ADAPTER_REGISTRY, repo_type="model", token=os.environ.get("HF_WRITE_TOKEN"), allow_patterns=f"jobs/{job_id}/*")
    common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
    base = AutoModelForCausalLM.from_pretrained(state["paths"]["base"], **common)
    model = PeftModel.from_pretrained(base, str(Path(adapter_path) / "jobs" / job_id)).eval()
    state["trained_models"][job_id] = model
    return model


def load_fused_model(job_id: str):
    if job_id in state["fused_models"]:
        return state["fused_models"][job_id]
    job = state["jobs"].get(job_id)
    if not job or job.get("promotion_status") != "promoted":
        raise HTTPException(status_code=404, detail="Promoted fused checkpoint not found")
    snapshot = snapshot_download(ADAPTER_REGISTRY, repo_type="model", token=os.environ.get("HF_WRITE_TOKEN"), allow_patterns=f"jobs/{job_id}/fused/*")
    path = Path(snapshot) / "jobs" / job_id / "fused"
    common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
    model = AutoModelForCausalLM.from_pretrained(str(path), **common).eval()
    state["fused_models"][job_id] = model
    return model


def promote_job(job_id: str, request: PromotionRequest) -> dict:
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Completed adapter not found")
    if request.adapter_passed != request.total or request.base_passed >= request.adapter_passed:
        raise HTTPException(status_code=400, detail="Promotion requires a perfect adapter score that improves on the base")
    if job.get("promotion_status") == "promoted":
        return job
    with promotion_lock:
        if job.get("promotion_status") == "promoted":
            return job
        try:
            job.update({"promotion_status": "fusing", "promotion_error": None})
            token = os.environ.get("HF_WRITE_TOKEN")
            if not token:
                raise RuntimeError("HF_WRITE_TOKEN Space secret is required")
            adapter_snapshot = snapshot_download(ADAPTER_REGISTRY, repo_type="model", token=token, allow_patterns=f"jobs/{job_id}/*")
            adapter_path = Path(adapter_snapshot) / "jobs" / job_id
            common = {"torch_dtype": torch.float16, "device_map": "auto", "low_cpu_mem_usage": True}
            base = AutoModelForCausalLM.from_pretrained(state["paths"]["base"], **common)
            fused = PeftModel.from_pretrained(base, str(adapter_path)).merge_and_unload(safe_merge=True).eval()
            with tempfile.TemporaryDirectory(prefix=f"viaana-fused-{job_id}-") as directory:
                fused.save_pretrained(directory, safe_serialization=True, max_shard_size="2GB")
                state["tokenizer"].save_pretrained(directory)
                fused_hash = hash_weight_files(directory)
                HfApi(token=token).upload_folder(
                    folder_path=directory,
                    repo_id=ADAPTER_REGISTRY,
                    repo_type="model",
                    path_in_repo=f"jobs/{job_id}/fused",
                    commit_message=f"Promote fused checkpoint {job_id}",
                )
            job.update({
                "promotion_status": "promoted", "promoted_at": int(time.time()),
                "evaluation_id": request.evaluation_id, "evaluation_sha256": request.evaluation_sha256,
                "evaluation_adapter_passed": request.adapter_passed, "evaluation_base_passed": request.base_passed,
                "evaluation_total": request.total, "fused_sha256": fused_hash,
                "fused_repository_path": f"jobs/{job_id}/fused",
            })
            persist_manifest(job)
            state["fused_models"][job_id] = fused
            return job
        except HTTPException:
            raise
        except Exception as error:
            job.update({"promotion_status": "failed", "promotion_error": f"{type(error).__name__}: {error}"})
            try:
                persist_manifest(job)
            except Exception:
                pass
            raise HTTPException(status_code=500, detail=f"Checkpoint promotion failed: {type(error).__name__}") from error


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
    return generate(state["models"][request.model], request.messages, request.temperature, request.max_tokens, request.model)


@app.get("/v1/training/jobs")
def list_training_jobs(x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    jobs = sorted((public_job(job) for job in state["jobs"].values()), key=lambda item: item.get("created_at", 0), reverse=True)
    return {"jobs": jobs}


@app.post("/v1/training/jobs", status_code=202)
def create_training_job(request: TrainingRequest, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    if state["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"Runtime is {state['status']}")
    if any(job.get("status") in {"queued", "loading", "training", "saving"} for job in state["jobs"].values()):
        raise HTTPException(status_code=409, detail="Another training job is already active")
    examples = [example.model_dump() for example in request.examples]
    for example in examples:
        if example["messages"][-1]["role"] != "assistant":
            raise HTTPException(status_code=400, detail="Every training example must end with an assistant message")
    canonical = json.dumps(examples, sort_keys=True, separators=(",", ":")).encode()
    job_id = f"train-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    job = {"id": job_id, "name": request.name, "dataset_name": request.dataset_name, "dataset_sha256": hashlib.sha256(canonical).hexdigest(), "example_count": len(examples), "rank": request.rank, "alpha": request.alpha, "learning_rate": request.learning_rate, "max_steps": request.max_steps, "seed": request.seed, "status": "queued", "created_at": int(time.time()), "progress": 0, "step": 0, "examples": examples}
    state["jobs"][job_id] = job
    threading.Thread(target=train_job, args=(job_id,), daemon=True).start()
    return {"job": public_job(job)}


@app.get("/v1/training/jobs/{job_id}")
def get_training_job(job_id: str, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    job = state["jobs"].get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
    return {"job": public_job(job)}


@app.post("/v1/training/jobs/{job_id}/completions")
def complete_trained(job_id: str, request: TrainedCompletionRequest, variant: Literal["adapter", "fused"] = "adapter", x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    if state["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"Runtime is {state['status']}")
    model = load_fused_model(job_id) if variant == "fused" else load_trained_model(job_id)
    return generate(model, request.messages, request.temperature, request.max_tokens, f"{job_id}-{variant}")


@app.post("/v1/training/jobs/{job_id}/promote")
def promote(job_id: str, request: PromotionRequest, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    if state["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"Runtime is {state['status']}")
    return {"job": public_job(promote_job(job_id, request))}


@app.post("/v1/training/jobs/{job_id}/evaluations")
def store_evaluation(job_id: str, evidence: dict, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    job, evidence_hash = save_evaluation(job_id, evidence)
    return {"job": public_job(job), "evaluation_sha256": evidence_hash}
