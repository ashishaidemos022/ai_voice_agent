import hashlib
import json
import math
import os
import random
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

import numpy as np
import tinker
from fastapi import FastAPI, Header, HTTPException
from huggingface_hub import HfApi, hf_hub_download
from pydantic import BaseModel, Field
from tinker_cookbook.renderers import TrainOnWhat, get_renderer, get_text_content
from tinker_cookbook.supervised.data import conversation_to_datum
from tinker_cookbook.tokenizer_utils import get_tokenizer

BASE_MODEL = "thinkingmachines/Inkling-Small"
ADAPTER_REGISTRY = "bhatsy/viaana-trained-adapters"
state: dict[str, object] = {"jobs": {}, "sampling_clients": {}}
training_lock = threading.Lock()
promotion_lock = threading.Lock()
registry_lock = threading.Lock()


class Message(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class TrainingExample(BaseModel):
    messages: list[Message] = Field(min_length=2, max_length=20)


class TrainingRequest(BaseModel):
    backend: Literal["tinker"]
    base_model: Literal["thinkingmachines/Inkling-Small"] = BASE_MODEL
    name: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.-]+$")
    dataset_name: str = Field(min_length=3, max_length=80)
    examples: list[TrainingExample] = Field(min_length=6, max_length=200)
    rank: Literal[4, 8, 16] = 8
    alpha: int = Field(default=16, ge=4, le=64)
    learning_rate: float = Field(default=0.0002, ge=0.00001, le=0.002)
    max_steps: int = Field(default=20, ge=2, le=200)
    seed: int = Field(default=42, ge=0, le=2_147_483_647)


class CompletionRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=50)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=256, ge=1, le=1024)


class PromotionRequest(BaseModel):
    evaluation_id: str = Field(pattern=r"^adapter-eval-[A-Za-z0-9-]+$")
    evaluation_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    adapter_passed: int = Field(ge=1, le=20)
    base_passed: int = Field(ge=0, le=20)
    total: int = Field(ge=1, le=20)


def authorize(runtime_key: str | None) -> None:
    expected = os.environ.get("RUNTIME_SHARED_SECRET")
    if not expected or runtime_key != expected:
        raise HTTPException(status_code=401, detail="Invalid runtime key")


def public_job(job: dict) -> dict:
    return {key: value for key, value in job.items() if key != "examples"}


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
            commit_message=f"Update Tinker manifest for {job['id']}",
        )
    finally:
        Path(manifest_path).unlink(missing_ok=True)


def load_registry() -> None:
    token = os.environ.get("HF_WRITE_TOKEN")
    if not token:
        return
    try:
        api = HfApi(token=token)
        for filename in api.list_repo_files(ADAPTER_REGISTRY, repo_type="model"):
            if not filename.startswith("jobs/train-tinker-") or not filename.endswith("/training_manifest.json"):
                continue
            path = hf_hub_download(ADAPTER_REGISTRY, filename, repo_type="model", token=token)
            manifest = json.loads(Path(path).read_text())
            state["jobs"].setdefault(manifest["id"], manifest)
    except Exception as error:
        print(f"Could not load Tinker registry: {type(error).__name__}: {error}", flush=True)


def provenance_hash(job: dict) -> str:
    proof = {
        "backend": "tinker", "base_model": BASE_MODEL, "checkpoint_path": job["checkpoint_path"],
        "dataset_sha256": job["dataset_sha256"], "rank": job["rank"], "learning_rate": job["learning_rate"],
        "max_steps": job["max_steps"], "seed": job["seed"],
    }
    return hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def train_job(job_id: str) -> None:
    job = state["jobs"][job_id]
    with training_lock:
        try:
            if not os.environ.get("TINKER_API_KEY"):
                raise RuntimeError("TINKER_API_KEY Space secret is required")
            job.update({"status": "loading", "started_at": int(time.time()), "progress": 0})
            random.seed(job["seed"])
            service = tinker.ServiceClient()
            trainer = service.create_lora_training_client(
                base_model=BASE_MODEL, rank=job["rank"], seed=job["seed"],
                user_metadata={"viaana_job_id": job_id, "dataset_sha256": job["dataset_sha256"]},
            )
            tokenizer = get_tokenizer(BASE_MODEL)
            renderer = get_renderer("tml_v0", tokenizer, model_name=BASE_MODEL)
            examples = job.pop("examples")
            data = [conversation_to_datum(example["messages"], renderer, max_length=2048, train_on_what=TrainOnWhat.LAST_ASSISTANT_MESSAGE) for example in examples]
            order = list(range(len(data)))
            losses: list[float] = []
            job.update({"status": "training", "tinker_run_url": trainer.get_console_url()})
            for step in range(job["max_steps"]):
                if step % len(order) == 0:
                    random.shuffle(order)
                batch = [data[order[step % len(order)]]]
                forward = trainer.forward_backward(batch, "cross_entropy")
                optimizer = trainer.optim_step(tinker.AdamParams(learning_rate=job["learning_rate"]))
                result = forward.result()
                optimizer.result()
                logprobs = np.concatenate([output["logprobs"].tolist() for output in result.loss_fn_outputs])
                weights = np.concatenate([datum.loss_fn_inputs["weights"].tolist() for datum in batch])
                loss = float(-np.dot(logprobs, weights) / weights.sum())
                if not math.isfinite(loss):
                    raise RuntimeError("Training loss became non-finite")
                losses.append(loss)
                job.update({"step": step + 1, "progress": round((step + 1) / job["max_steps"] * 100, 1), "loss": round(loss, 5)})
            job["status"] = "saving"
            checkpoint = trainer.save_state(job_id, user_metadata={"viaana_job_id": job_id, "dataset_sha256": job["dataset_sha256"]}).result()
            sampler_checkpoint = trainer.save_weights_for_sampler(f"{job_id}-sampler", user_metadata={"viaana_job_id": job_id}).result()
            job.update({
                "status": "completed", "completed_at": int(time.time()), "progress": 100,
                "initial_loss": round(losses[0], 5), "final_loss": round(losses[-1], 5),
                "checkpoint_path": checkpoint.path, "sampler_checkpoint_path": sampler_checkpoint.path,
                "repository": "Tinker", "repository_path": sampler_checkpoint.path,
                "base_repository": BASE_MODEL, "artifact_hash_kind": "checkpoint-provenance",
            })
            job["artifact_sha256"] = provenance_hash(job)
            persist_manifest(job)
            state["sampling_clients"][job_id] = service.create_sampling_client(model_path=sampler_checkpoint.path)
        except Exception as error:
            job.update({"status": "failed", "completed_at": int(time.time()), "error": f"{type(error).__name__}: {error}"})
            print(f"Tinker training job {job_id} failed: {job['error']}", flush=True)
            try:
                persist_manifest(job)
            except Exception:
                pass


def sampling_client(job: dict):
    job_id = job["id"]
    if job_id not in state["sampling_clients"]:
        state["sampling_clients"][job_id] = tinker.ServiceClient().create_sampling_client(model_path=job["sampler_checkpoint_path"])
    return state["sampling_clients"][job_id]


def complete_job(job: dict, request: CompletionRequest) -> dict:
    client = sampling_client(job)
    tokenizer = get_tokenizer(BASE_MODEL)
    renderer = get_renderer("tml_v0", tokenizer, model_name=BASE_MODEL)
    prompt = renderer.build_generation_prompt([message.model_dump() for message in request.messages])
    params = tinker.SamplingParams(max_tokens=request.max_tokens, temperature=request.temperature, stop=renderer.get_stop_sequences())
    started = time.perf_counter()
    result = client.sample(prompt=prompt, num_samples=1, sampling_params=params).result()
    sequence = result.sequences[0]
    parsed, _ = renderer.parse_response(sequence.tokens)
    answer = get_text_content(parsed)
    prompt_tokens = sum(chunk.length for chunk in prompt.chunks)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}", "object": "chat.completion", "created": int(time.time()),
        "model": f"{job['id']}-checkpoint", "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": str(sequence.stop_reason)}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": len(sequence.tokens), "total_tokens": prompt_tokens + len(sequence.tokens)},
        "viaana": {"latency_ms": round((time.perf_counter() - started) * 1000, 2), "backend": "tinker", "checkpoint_path": job["sampler_checkpoint_path"]},
    }


def save_evaluation(job_id: str, evidence: dict) -> tuple[dict, str]:
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed" or evidence.get("job", {}).get("id") != job_id:
        raise HTTPException(status_code=400, detail="Evaluation does not match a completed job")
    canonical = json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()
    if len(canonical) > 250_000:
        raise HTTPException(status_code=400, detail="Evaluation evidence is too large")
    evidence_hash = hashlib.sha256(canonical).hexdigest()
    token = os.environ.get("HF_WRITE_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Evaluation storage is unavailable")
    evaluation_id = evidence.get("id", "")
    with tempfile.NamedTemporaryFile(mode="wb", suffix=".json", delete=False) as handle:
        handle.write(json.dumps(evidence, indent=2, sort_keys=True).encode())
        evidence_path = handle.name
    try:
        HfApi(token=token).upload_file(path_or_fileobj=evidence_path, path_in_repo=f"jobs/{job_id}/evaluations/{evaluation_id}.json", repo_id=ADAPTER_REGISTRY, repo_type="model", commit_message=f"Save evaluation {evaluation_id}")
    finally:
        Path(evidence_path).unlink(missing_ok=True)
    cases = evidence.get("cases", [])
    job.update({"latest_evaluation_id": evaluation_id, "latest_evaluation_sha256": evidence_hash, "latest_evaluation_total": len(cases), "latest_evaluation_base_passed": sum(item.get("base", {}).get("pass") is True for item in cases), "latest_evaluation_adapter_passed": sum(item.get("adapter", {}).get("pass") is True for item in cases), "latest_evaluation_repository_path": f"jobs/{job_id}/evaluations/{evaluation_id}.json"})
    persist_manifest(job)
    return job, evidence_hash


def promote_job(job_id: str, request: PromotionRequest) -> dict:
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Completed checkpoint not found")
    if request.adapter_passed != request.total or request.base_passed >= request.adapter_passed:
        raise HTTPException(status_code=400, detail="Promotion requires a perfect checkpoint score that improves on the base")
    with promotion_lock:
        job.update({"promotion_status": "promoted", "promoted_at": int(time.time()), "evaluation_id": request.evaluation_id, "evaluation_sha256": request.evaluation_sha256, "evaluation_adapter_passed": request.adapter_passed, "evaluation_base_passed": request.base_passed, "evaluation_total": request.total, "promoted_checkpoint_path": job["sampler_checkpoint_path"], "promotion_kind": "tinker-checkpoint"})
        persist_manifest(job)
    return job


app = FastAPI(title="Viaana Tinker Training Runtime")
load_registry()


@app.get("/health")
def health():
    return {"status": "ready" if os.environ.get("TINKER_API_KEY") else "configuration-required", "backend": "tinker", "model": BASE_MODEL}


@app.get("/v1/training/jobs")
def list_jobs(x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    return {"jobs": sorted((public_job(job) for job in state["jobs"].values()), key=lambda item: item.get("created_at", 0), reverse=True)}


@app.post("/v1/training/jobs", status_code=202)
def create_job(request: TrainingRequest, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    if any(job.get("status") in {"queued", "loading", "training", "saving"} for job in state["jobs"].values()):
        raise HTTPException(status_code=409, detail="Another Tinker training job is already active")
    examples = [example.model_dump() for example in request.examples]
    canonical = json.dumps(examples, sort_keys=True, separators=(",", ":")).encode()
    job_id = f"train-tinker-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}"
    job = {"id": job_id, "backend": "tinker", "base_model": BASE_MODEL, "name": request.name, "dataset_name": request.dataset_name, "dataset_sha256": hashlib.sha256(canonical).hexdigest(), "example_count": len(examples), "rank": request.rank, "alpha": request.alpha, "learning_rate": request.learning_rate, "max_steps": request.max_steps, "seed": request.seed, "status": "queued", "created_at": int(time.time()), "progress": 0, "step": 0, "examples": examples}
    state["jobs"][job_id] = job
    threading.Thread(target=train_job, args=(job_id,), daemon=True).start()
    return {"job": public_job(job)}


@app.get("/v1/training/jobs/{job_id}")
def get_job(job_id: str, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    job = state["jobs"].get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Training job not found")
    return {"job": public_job(job)}


@app.post("/v1/training/jobs/{job_id}/completions")
def complete(job_id: str, request: CompletionRequest, variant: str = "adapter", x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    job = state["jobs"].get(job_id)
    if not job or job.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Completed Tinker checkpoint not found")
    if variant == "fused" and job.get("promotion_status") != "promoted":
        raise HTTPException(status_code=404, detail="Promoted Tinker checkpoint not found")
    return complete_job(job, request)


@app.post("/v1/training/jobs/{job_id}/evaluations")
def store_evaluation(job_id: str, evidence: dict, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    job, evidence_hash = save_evaluation(job_id, evidence)
    return {"job": public_job(job), "evaluation_sha256": evidence_hash}


@app.post("/v1/training/jobs/{job_id}/promote")
def promote(job_id: str, request: PromotionRequest, x_runtime_key: str | None = Header(default=None)):
    authorize(x_runtime_key)
    return {"job": public_job(promote_job(job_id, request))}
