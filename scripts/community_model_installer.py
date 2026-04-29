#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def append_log(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{iso_now()} {line.rstrip()}\n")


def patch_state(path: Path, patch: dict) -> None:
    current = {}
    if path.exists():
        current = read_json(path)
    current.update(patch)
    current["updatedAt"] = patch.get("updatedAt", iso_now())
    write_json(path, current)


def clone_github(repo_url: str, install_dir: Path, log_file: Path) -> None:
    if install_dir.exists() and any(install_dir.iterdir()):
        append_log(log_file, f"Install directory already exists: {install_dir}")
        return
    install_dir.parent.mkdir(parents=True, exist_ok=True)
    append_log(log_file, f"Cloning GitHub repository into {install_dir}")
    result = subprocess.run(
        ["git", "clone", "--depth", "1", repo_url, str(install_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.stdout:
        append_log(log_file, result.stdout)
    if result.stderr:
        append_log(log_file, result.stderr)
    if result.returncode != 0:
        raise RuntimeError(f"git clone failed with exit code {result.returncode}")


def install_huggingface(repo_id: str, install_dir: Path, log_file: Path) -> None:
    from huggingface_hub import snapshot_download as hf_snapshot_download

    install_dir.mkdir(parents=True, exist_ok=True)
    append_log(log_file, f"Downloading Hugging Face model {repo_id} into {install_dir}")
    hf_snapshot_download(
        repo_id=repo_id,
        local_dir=str(install_dir),
        local_dir_use_symlinks=False,
        resume_download=True,
    )


def install_modelscope(repo_id: str, install_dir: Path, log_file: Path) -> None:
    from modelscope import snapshot_download as ms_snapshot_download

    install_dir.mkdir(parents=True, exist_ok=True)
    append_log(log_file, f"Downloading ModelScope model {repo_id} into {install_dir}")
    ms_snapshot_download(
        model_id=repo_id,
        local_dir=str(install_dir),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-file", required=True)
    args = parser.parse_args()

    job_file = Path(args.job_file).resolve()
    payload = read_json(job_file)
    candidate = payload["candidate"]
    state_file = Path(payload["stateFile"]).resolve()
    log_file = Path(payload["logFile"]).resolve()
    install_dir = Path(payload["installDir"]).expanduser().resolve()
    rollback_install_dir = bool(payload.get("rollbackInstallDirOnFailure"))

    patch_state(
        state_file,
        {
            "status": "running",
            "startedAt": iso_now(),
            "latestMessage": "Install worker is running.",
            "errorMessage": None,
            "rollbackPerformed": False,
        },
    )

    try:
        append_log(log_file, f"Starting install for {candidate['source']}:{candidate['repoId']}")
        append_log(log_file, f"Target install directory: {install_dir}")
        source = candidate["source"]
        repo_id = candidate["repoId"]
        repo_url = candidate["repoUrl"]

        if source == "huggingface":
            install_huggingface(repo_id, install_dir, log_file)
        elif source == "modelscope":
            install_modelscope(repo_id, install_dir, log_file)
        elif source == "github":
            clone_github(repo_url, install_dir, log_file)
        else:
            raise RuntimeError(f"Unsupported source: {source}")

        patch_state(
            state_file,
            {
                "status": "completed",
                "completedAt": iso_now(),
                "latestMessage": "Install completed. The app will rescan local targets on the next summary refresh.",
                "errorMessage": None,
                "rollbackPerformed": False,
            },
        )
        append_log(log_file, "Install completed successfully.")
        return 0
    except Exception as exc:  # noqa: BLE001
        append_log(log_file, f"Install failed: {exc}")
        rollback_performed = False
        if rollback_install_dir and install_dir.exists():
            append_log(log_file, f"Rolling back install directory: {install_dir}")
            shutil.rmtree(install_dir, ignore_errors=True)
            rollback_performed = True
        elif install_dir.exists() and not any(install_dir.iterdir()):
            shutil.rmtree(install_dir, ignore_errors=True)
            rollback_performed = True
        patch_state(
            state_file,
            {
                "status": "failed",
                "completedAt": iso_now(),
                "latestMessage": "Install failed and rollback completed." if rollback_performed else "Install failed.",
                "errorMessage": str(exc),
                "rollbackPerformed": rollback_performed,
            },
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
