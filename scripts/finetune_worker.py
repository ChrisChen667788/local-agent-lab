#!/usr/bin/env python3

import argparse
import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional


TRAIN_RE = re.compile(
    r"Iter\s+(?P<step>\d+):\s+Train loss\s+(?P<loss>[0-9.]+),\s+Learning Rate\s+(?P<lr>[0-9.eE+-]+),\s+It/sec\s+(?P<it_sec>[0-9.]+),\s+Tokens/sec\s+(?P<tok_sec>[0-9.]+),\s+Trained Tokens\s+(?P<trained>\d+),\s+Peak mem\s+(?P<peak>[0-9.]+)\s+GB"
)
VAL_RE = re.compile(
    r"Iter\s+(?P<step>\d+):\s+Val loss\s+(?P<loss>[0-9.]+),\s+Val took\s+(?P<duration>[0-9.]+)s"
)
SAVE_RE = re.compile(r"Iter\s+(?P<step>\d+):\s+Saved adapter weights to")

CHILD_PROCESS: Optional[subprocess.Popen[str]] = None
CANCEL_REQUESTED = False


def read_json(path: Path, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return fallback


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def append_jsonl(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False))
        handle.write("\n")


def append_log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line.rstrip("\n"))
        handle.write("\n")


def update_state(state_file: Path, patch: Dict[str, Any]) -> Dict[str, Any]:
    current = read_json(state_file, {})
    current.update(patch)
    current["updatedAt"] = patch.get("updatedAt") or iso_now()
    write_json(state_file, current)
    return current


def append_curve_point(state_file: Path, point: Dict[str, Any]) -> None:
    current = read_json(state_file, {})
    curve = current.get("curve")
    if not isinstance(curve, list):
        curve = []
    curve.append(point)
    current["curve"] = curve[-120:]
    current["updatedAt"] = iso_now()
    write_json(state_file, current)


def iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def handle_signal(signum, frame):  # type: ignore[no-untyped-def]
    del signum, frame
    global CANCEL_REQUESTED, CHILD_PROCESS
    CANCEL_REQUESTED = True
    if CHILD_PROCESS and CHILD_PROCESS.poll() is None:
        try:
            CHILD_PROCESS.terminate()
        except Exception:
            pass


def build_command(bundle: Dict[str, Any]) -> list[str]:
    plan = bundle["plan"]
    command = [
        sys.executable,
        "-m",
        "mlx_lm.lora",
        "--config",
        str(plan["configFile"]),
        "--model",
        str(plan["modelRef"]),
        "--data",
        str(plan["datasetDir"]),
        "--train",
        "--fine-tune-type",
        str(plan.get("fineTuneMethod", "lora")),
        "--optimizer",
        str(plan.get("optimizer", "adam")),
        "--num-layers",
        str(plan.get("numLayers", 16)),
        "--batch-size",
        str(plan["batchSize"]),
        "--iters",
        str(plan["totalSteps"]),
        "--learning-rate",
        str(plan["learningRate"]),
        "--adapter-path",
        str(plan["adapterPath"]),
        "--save-every",
        str(plan["saveEvery"]),
        "--steps-per-report",
        str(plan["stepsPerReport"]),
        "--steps-per-eval",
        str(plan["stepsPerEval"]),
        "--grad-accumulation-steps",
        str(plan.get("gradAccumulationSteps", 1)),
        "--max-seq-length",
        str(plan["maxSeqLength"]),
        "--seed",
        str(plan.get("seed", 42)),
    ]
    if plan.get("gradCheckpoint"):
        command.append("--grad-checkpoint")
    return command


def set_progress(
    state_file: Path,
    step: int,
    total_steps: int,
    *,
    train_loss: Optional[float] = None,
    val_loss: Optional[float] = None,
    learning_rate: Optional[float] = None,
    tokens_per_second: Optional[float] = None,
    peak_memory_gb: Optional[float] = None,
    trained_tokens: Optional[int] = None,
    latest_message: Optional[str] = None,
) -> None:
    current = read_json(state_file, {})
    progress = current.get("progress")
    if not isinstance(progress, dict):
        progress = {}
    progress.update(
        {
            "currentStep": step,
            "totalSteps": total_steps,
            "percent": round((step / max(total_steps, 1)) * 100, 1),
        }
    )
    if train_loss is not None:
        progress["latestTrainLoss"] = train_loss
    if val_loss is not None:
        progress["latestValLoss"] = val_loss
    if learning_rate is not None:
        progress["latestLearningRate"] = learning_rate
    if tokens_per_second is not None:
        progress["latestTokensPerSecond"] = tokens_per_second
    if peak_memory_gb is not None:
        progress["latestPeakMemoryGb"] = peak_memory_gb
    if trained_tokens is not None:
        progress["trainedTokens"] = trained_tokens
    patch = {
        "status": "running",
        "workerHeartbeatAt": iso_now(),
        "progress": progress,
    }
    if latest_message:
        patch["latestMessage"] = latest_message
    update_state(state_file, patch)


def run_bundle(job_bundle_path: Path) -> int:
    global CHILD_PROCESS

    with job_bundle_path.open("r", encoding="utf-8") as handle:
        bundle = json.load(handle)

    job_id = job_bundle_path.parent.name
    plan = bundle["plan"]
    state_file = Path(plan["stateFile"])
    log_file = Path(plan["logFile"])
    metrics_file = Path(plan["metricsFile"])
    total_steps = int(plan["totalSteps"])

    append_log(log_file, f"[{iso_now()}] Starting local fine-tune worker for {job_id}")
    update_state(
        state_file,
        {
            "status": "running",
            "startedAt": read_json(state_file, {}).get("startedAt") or iso_now(),
            "workerHeartbeatAt": iso_now(),
            "latestMessage": "Loading MLX LoRA trainer.",
            "errorMessage": None,
            "curve": read_json(state_file, {}).get("curve", []),
        },
    )

    command = build_command(bundle)
    append_log(log_file, f"[{iso_now()}] Command: {' '.join(command)}")
    CHILD_PROCESS = subprocess.Popen(
        command,
        cwd=os.getcwd(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    update_state(
        state_file,
        {
            "launcherPid": os.getpid(),
            "workerHeartbeatAt": iso_now(),
            "latestMessage": "MLX trainer booted.",
        },
    )

    assert CHILD_PROCESS.stdout is not None
    for raw_line in CHILD_PROCESS.stdout:
        line = raw_line.rstrip("\n")
        append_log(log_file, line)
        update_state(state_file, {"workerHeartbeatAt": iso_now(), "latestMessage": line[-240:]})

        train_match = TRAIN_RE.search(line)
        if train_match:
            step = int(train_match.group("step"))
            point = {
                "step": step,
                "split": "train",
                "loss": float(train_match.group("loss")),
                "learningRate": float(train_match.group("lr")),
                "tokensPerSecond": float(train_match.group("tok_sec")),
                "peakMemoryGb": float(train_match.group("peak")),
                "trainedTokens": int(train_match.group("trained")),
                "durationSec": None,
                "at": iso_now(),
            }
            append_jsonl(metrics_file, point)
            append_curve_point(state_file, point)
            set_progress(
                state_file,
                step,
                total_steps,
                train_loss=point["loss"],
                learning_rate=point["learningRate"],
                tokens_per_second=point["tokensPerSecond"],
                peak_memory_gb=point["peakMemoryGb"],
                trained_tokens=point["trainedTokens"],
                latest_message=f"Step {step}/{total_steps}: train loss {point['loss']:.3f}",
            )
            continue

        val_match = VAL_RE.search(line)
        if val_match:
            step = int(val_match.group("step"))
            point = {
                "step": step,
                "split": "valid",
                "loss": float(val_match.group("loss")),
                "learningRate": None,
                "tokensPerSecond": None,
                "peakMemoryGb": None,
                "trainedTokens": None,
                "durationSec": float(val_match.group("duration")),
                "at": iso_now(),
            }
            append_jsonl(metrics_file, point)
            append_curve_point(state_file, point)
            set_progress(
                state_file,
                step,
                total_steps,
                val_loss=point["loss"],
                latest_message=f"Validation after step {step}: loss {point['loss']:.3f}",
            )
            continue

        save_match = SAVE_RE.search(line)
        if save_match:
            step = int(save_match.group("step"))
            set_progress(
                state_file,
                step,
                total_steps,
                latest_message=f"Saved adapter checkpoint at step {step}.",
            )
            continue

    exit_code = CHILD_PROCESS.wait()
    completed_at = iso_now()
    if CANCEL_REQUESTED:
        update_state(
            state_file,
            {
                "status": "cancelled",
                "completedAt": completed_at,
                "workerHeartbeatAt": completed_at,
                "latestMessage": "Fine-tune worker cancelled.",
            },
        )
        append_log(log_file, f"[{completed_at}] Worker cancelled")
        return 1

    if exit_code == 0:
        update_state(
            state_file,
            {
                "status": "completed",
                "completedAt": completed_at,
                "workerHeartbeatAt": completed_at,
                "latestMessage": "Fine-tune worker completed successfully.",
                "errorMessage": None,
            },
        )
        append_log(log_file, f"[{completed_at}] Worker completed successfully")
        return 0

    update_state(
        state_file,
        {
            "status": "failed",
            "completedAt": completed_at,
            "workerHeartbeatAt": completed_at,
            "latestMessage": f"Fine-tune worker failed with exit code {exit_code}.",
            "errorMessage": f"Fine-tune worker failed with exit code {exit_code}.",
        },
    )
    append_log(log_file, f"[{completed_at}] Worker failed with exit code {exit_code}")
    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a local MLX fine-tune worker bundle.")
    parser.add_argument("--job-bundle", required=True, help="Path to the staged job-bundle.json file")
    args = parser.parse_args()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    return run_bundle(Path(args.job_bundle))


if __name__ == "__main__":
    raise SystemExit(main())
