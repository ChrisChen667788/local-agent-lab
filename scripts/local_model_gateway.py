import difflib
import gc
import hashlib
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn


def load_env_file(filename: str):
    if not os.path.exists(filename):
        return

    with open(filename, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(".env.local")
load_env_file(".env")

app = FastAPI(title="Local MLX Agent Gateway", version="0.5.0")
load_lock = threading.Lock()
inference_lock = threading.Lock()
state_lock = threading.Lock()
confirmation_lock = threading.Lock()
mlx_import_lock = threading.Lock()
loaded_alias = None
loaded_model = None
loaded_tokenizer = None
queued_requests = 0
active_requests = 0
pending_confirmations: dict[str, dict[str, Any]] = {}
mlx_generate = None
mlx_load = None
mlx_stream_generate = None
mlx_import_error = None

MODEL_REPOS = {
    "local-qwen3-0.6b": os.getenv("LOCAL_QWEN_0_6B_REPO", "Qwen/Qwen3-0.6B-MLX-6bit"),
    "local-qwen3-4b-4bit": os.getenv(
        "LOCAL_QWEN_4B_4BIT_REPO", "mlx-community/Qwen3-4B-Instruct-2507-4bit"
    ),
}
WORKSPACE_ROOT = Path(os.getenv("LOCAL_AGENT_WORKSPACE_ROOT", os.getcwd())).resolve()
MAX_TOOL_STEPS = max(1, min(8, int(os.getenv("LOCAL_AGENT_TOOL_STEPS", "6"))))
MAX_ACTION_RETRIES = max(0, min(3, int(os.getenv("LOCAL_AGENT_JSON_RETRIES", "2"))))
MAX_FILE_LINES = 240
MAX_FILE_BYTES = 64 * 1024
MAX_COMMAND_OUTPUT_CHARS = 16_000
MAX_DIFF_PREVIEW_CHARS = 8_000
MAX_CONTENT_PREVIEW_CHARS = 2_000
DEFAULT_COMMAND_TIMEOUT_MS = 20_000
MAX_COMMAND_TIMEOUT_MS = 120_000
CONFIRMATION_TTL_MS = 10 * 60 * 1000
FORCED_TOOL_MODELS = {"local-qwen3-4b-4bit"}
PROTECTED_SOURCE_PREFIXES = ("app/", "lib/", "components/")
NEVER_ALLOW_COMMAND_PATTERNS = [
    re.compile(r"\brm\s+-rf\b", re.IGNORECASE),
    re.compile(r"\bgit\s+reset\s+--hard\b", re.IGNORECASE),
    re.compile(r"\bgit\s+checkout\s+--\b", re.IGNORECASE),
    re.compile(r"\bfind\b.*\s-delete\b", re.IGNORECASE),
    re.compile(r"\bfind\b.*\s-exec\b.*\b(?:rm|mv|chmod|chown)\b", re.IGNORECASE),
]
PRIVILEGED_COMMAND_PATTERNS = [
    re.compile(r"\bsudo\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bdd\s+if=", re.IGNORECASE),
    re.compile(r"\bdiskutil\s+erase", re.IGNORECASE),
    re.compile(r"\blaunchctl\b", re.IGNORECASE),
    re.compile(r"\bchown\b", re.IGNORECASE),
    re.compile(r"\bchmod\b", re.IGNORECASE),
    re.compile(r"\bcurl\b.*\|\s*(?:bash|sh|zsh)\b", re.IGNORECASE),
    re.compile(r"^(?:brew)\s+(?:install|upgrade|uninstall)\b", re.IGNORECASE),
    re.compile(r"^(?:pip|pip3)\s+install\b", re.IGNORECASE),
    re.compile(r"^python3?\s+-m\s+pip\s+install\b", re.IGNORECASE),
    re.compile(r"^uv\s+pip\s+install\b", re.IGNORECASE),
    re.compile(r"\bmv\s+.+\s+/(?!Users/chenhaorui/Documents/New project)", re.IGNORECASE),
    re.compile(r"\bcp\s+.+\s+/(?!Users/chenhaorui/Documents/New project)", re.IGNORECASE),
]
READ_ONLY_COMMAND_PATTERNS = [
    re.compile(r"^pwd$", re.IGNORECASE),
    re.compile(r"^ls(?:\s|$)", re.IGNORECASE),
    re.compile(r"^find(?:\s|$)", re.IGNORECASE),
    re.compile(r"^rg(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:cat|sed|head|tail|wc|stat|file|which)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^git\s+(?:status|diff|show|log|branch|rev-parse)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^python3?\s+-m\s+json\.tool(?:\s|$)", re.IGNORECASE),
]
BUILD_COMMAND_PATTERNS = [
    re.compile(r"^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|typecheck|check)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^npx\s+(?:tsc|eslint|vitest|jest)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:tsc|eslint|vitest|jest|pytest)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^python3?\s+-m\s+pytest(?:\s|$)", re.IGNORECASE),
    re.compile(r"^uv\s+run\s+pytest(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:go\s+test|cargo\s+test|next\s+lint)(?:\s|$)", re.IGNORECASE),
]
FORMATTER_COMMAND_PATTERNS = [
    re.compile(r"^npx\s+prettier\s+.+\s--write(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:prettier)\s+.+\s--write(?:\s|$)", re.IGNORECASE),
    re.compile(r"^npx\s+eslint\s+.+\s--fix(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:eslint)\s+.+\s--fix(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:ruff)\s+(?:check\s+.+\s--fix|format)(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:black|gofmt|cargo\s+fmt|go\s+fmt|swiftformat)(?:\s|$)", re.IGNORECASE),
]
PATCHER_COMMAND_PATTERNS = [
    re.compile(r"^git\s+apply(?:\s|$)", re.IGNORECASE),
    re.compile(r"^patch(?:\s|$)", re.IGNORECASE),
]
PACKAGE_MANAGER_COMMAND_PATTERNS = [
    re.compile(r"^(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|upgrade|up|dlx|create)\b", re.IGNORECASE),
    re.compile(r"^npx\s+(?:npm|pnpm|yarn|bun)\b", re.IGNORECASE),
    re.compile(r"^(?:cargo)\s+(?:add|remove)\b", re.IGNORECASE),
    re.compile(r"^(?:go)\s+get\b", re.IGNORECASE),
    re.compile(r"^(?:uv)\s+(?:add|remove|sync)\b", re.IGNORECASE),
]
MISC_WRITE_COMMAND_PATTERNS = [
    re.compile(r"^mkdir(?:\s|$)", re.IGNORECASE),
    re.compile(r"^touch(?:\s|$)", re.IGNORECASE),
    re.compile(r"^(?:sed|perl)\s+-i(?:\s|$)", re.IGNORECASE),
]

LOCAL_TOOL_INSTRUCTIONS = """You are a local coding agent with built-in workspace tools.

You must respond with exactly one JSON object and nothing else.

If you need a tool, respond with:
{"type":"tool","tool_name":"list_files","arguments":{"path":".","limit":40}}

If you have enough context to answer, respond with:
{"type":"final","content":"your concise answer"}

Rules:
- Use at most one tool per response.
- Only call tools from the available tool list.
- Arguments must be valid JSON objects.
- Prefer list_files before read_file when exploring.
- execute_command only supports allowlisted read/build/formatter/patcher/package-manager/misc-write commands.
- write_file and apply_patch return diff previews and verification details.
- If execute_command, write_file, or apply_patch returns confirmation_required, call the same tool again with the returned confirmationToken only when the change should really proceed.
- Never invent file contents or claim a patch was applied unless a tool result confirms it.
"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatToolFunction(BaseModel):
    name: str
    description: str | None = None
    parameters: dict[str, Any] | None = None


class ChatTool(BaseModel):
    type: str = "function"
    function: ChatToolFunction


class ChatCompletionsRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    max_tokens: int = Field(default=512, ge=1, le=2048)
    tools: list[ChatTool] | None = None
    tool_choice: str | None = None


class DirectToolRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class RejectConfirmationRequest(BaseModel):
    confirmation_token: str


class PrewarmModelRequest(BaseModel):
    model: str
    max_tokens: int = Field(default=12, ge=1, le=64)
    warm_generate: bool = False


def get_mlx_runtime():
    global mlx_generate, mlx_load, mlx_stream_generate, mlx_import_error

    if mlx_generate and mlx_load and mlx_stream_generate:
        return mlx_generate, mlx_load, mlx_stream_generate

    with mlx_import_lock:
        if mlx_generate and mlx_load and mlx_stream_generate:
            return mlx_generate, mlx_load, mlx_stream_generate

        try:
            from mlx_lm import generate as imported_generate, load as imported_load
            from mlx_lm.generate import stream_generate as imported_stream_generate
        except ImportError as exc:  # pragma: no cover - runtime guard
            mlx_import_error = str(exc)
            raise RuntimeError(
                "mlx_lm is required. Install it with `pip install mlx mlx-lm fastapi uvicorn`."
            ) from exc

        mlx_generate = imported_generate
        mlx_load = imported_load
        mlx_stream_generate = imported_stream_generate
        mlx_import_error = None

    return mlx_generate, mlx_load, mlx_stream_generate


def truncate_output(value: str, max_chars: int = MAX_COMMAND_OUTPUT_CHARS) -> str:
    if len(value) <= max_chars:
        return value
    return f"{value[:max_chars]}\n...[truncated]"


def preview_content(value: str) -> str:
    return truncate_output(value, MAX_CONTENT_PREVIEW_CHARS)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_hash(value: dict[str, Any]) -> str:
    return sha256_text(json.dumps(value, ensure_ascii=False, sort_keys=True))


def safe_resolve(input_path: str = ".") -> Path:
    resolved = (WORKSPACE_ROOT / input_path).resolve()
    if not str(resolved).startswith(str(WORKSPACE_ROOT)):
        raise ValueError("Path escapes the current workspace.")
    return resolved


def classify_command(command: str) -> dict[str, Any]:
    for pattern in NEVER_ALLOW_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "privileged",
                "allowed": False,
                "reason": "Matches a destructive command pattern that is never allowed through execute_command.",
            }

    for pattern in PRIVILEGED_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "privileged",
                "allowed": False,
                "reason": "Command requires privileged or environment-changing access. Run it outside the agent tool flow.",
            }

    for pattern in READ_ONLY_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "read",
                "allowed": True,
                "reason": "Read-only inspection command allowed by the workspace policy.",
            }

    for pattern in BUILD_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "build",
                "allowed": True,
                "reason": "Build or test command allowed by the workspace policy.",
            }

    for pattern in FORMATTER_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "formatter",
                "allowed": True,
                "requiresConfirmation": True,
                "reason": "Formatter command will modify workspace files and requires explicit confirmation.",
            }

    for pattern in PATCHER_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "patcher",
                "allowed": True,
                "requiresConfirmation": True,
                "reason": "Patch command requires explicit confirmation before mutating workspace files.",
            }

    for pattern in PACKAGE_MANAGER_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "package-manager",
                "allowed": True,
                "requiresConfirmation": True,
                "reason": "Package manager command requires explicit confirmation before changing dependencies or lockfiles.",
            }

    for pattern in MISC_WRITE_COMMAND_PATTERNS:
        if pattern.search(command):
            return {
                "level": "misc-write",
                "allowed": True,
                "requiresConfirmation": True,
                "reason": "Workspace-writing command requires explicit confirmation before execution.",
            }

    return {
        "level": "privileged",
        "allowed": False,
        "reason": "Command is outside the read/build/formatter/patcher/package-manager/misc-write allowlist. Use write_file or apply_patch for file changes.",
    }


def is_protected_source_path(relative_path: str) -> bool:
    return any(
        relative_path == prefix[:-1] or relative_path.startswith(prefix)
        for prefix in PROTECTED_SOURCE_PREFIXES
    )


def get_protected_paths(relative_paths: list[str]) -> list[str]:
    protected = [relative_path for relative_path in relative_paths if is_protected_source_path(relative_path)]
    return list(dict.fromkeys(protected))


def cleanup_expired_confirmations():
    now = int(time.time() * 1000)
    with confirmation_lock:
        expired_tokens = [
            token
            for token, confirmation in pending_confirmations.items()
            if int(confirmation.get("expiresAt", 0)) <= now
        ]
        for token in expired_tokens:
            pending_confirmations.pop(token, None)


def issue_confirmation(tool_name: str, payload_hash: str, protected_paths: list[str]) -> dict[str, Any]:
    cleanup_expired_confirmations()
    confirmation = {
        "token": str(uuid.uuid4()),
        "toolName": tool_name,
        "payloadHash": payload_hash,
        "protectedPaths": protected_paths,
        "expiresAt": int(time.time() * 1000) + CONFIRMATION_TTL_MS,
    }
    with confirmation_lock:
        pending_confirmations[confirmation["token"]] = confirmation
    return confirmation


def consume_confirmation(
    token: str | None,
    tool_name: str,
    payload_hash: str,
    protected_paths: list[str],
) -> bool:
    cleanup_expired_confirmations()
    if not token:
        return False

    with confirmation_lock:
        confirmation = pending_confirmations.get(token)
        if not confirmation:
            raise ValueError("Invalid or expired confirmation token.")
        if (
            confirmation.get("toolName") != tool_name
            or confirmation.get("payloadHash") != payload_hash
            or confirmation.get("protectedPaths") != protected_paths
        ):
            raise ValueError("Confirmation token does not match the pending protected change.")
        pending_confirmations.pop(token, None)
    return True


def cancel_confirmation(token: str) -> bool:
    cleanup_expired_confirmations()
    with confirmation_lock:
        return pending_confirmations.pop(token, None) is not None


def normalize_patch_path(raw_path: str, strip_count: int) -> str | None:
    if not raw_path or raw_path == "/dev/null":
        return None

    clean_path = raw_path.strip()
    segments = [segment for segment in clean_path.split("/") if segment]
    if strip_count > 0:
        segments = segments[strip_count:]
    final_path = "/".join(segments)
    if not final_path:
        return None
    safe_resolve(final_path)
    return final_path


def extract_patch_paths(patch_text: str, strip_count: int) -> list[str]:
    paths: list[str] = []
    for line in patch_text.split("\n"):
        if not (line.startswith("--- ") or line.startswith("+++ ")):
            continue
        candidate = line[4:].strip().split("\t")[0]
        if candidate == "/dev/null":
            continue
        normalized = normalize_patch_path(candidate, strip_count)
        if normalized and normalized not in paths:
            paths.append(normalized)
    return paths


def validate_patch_paths(patch_text: str, strip_count: int):
    for candidate in extract_patch_paths(patch_text, strip_count):
        normalize_patch_path(candidate, strip_count)


def build_diff_preview(before: str, after: str, label: str) -> str:
    diff = difflib.unified_diff(
        before.splitlines(),
        after.splitlines(),
        fromfile=f"a/{label}",
        tofile=f"b/{label}",
        lineterm="",
    )
    text = "\n".join(diff)
    if not text:
        text = f"No diff for {label}."
    return truncate_output(text, MAX_DIFF_PREVIEW_CHARS)


def read_snapshot(relative_path: str) -> dict[str, Any]:
    absolute_path = safe_resolve(relative_path)
    if not absolute_path.exists() or not absolute_path.is_file():
        return {"exists": False, "hash": None, "preview": ""}

    content = absolute_path.read_text(encoding="utf-8")
    return {
        "exists": True,
        "hash": sha256_text(content),
        "preview": preview_content(content),
    }


def walk_files(root_dir: Path, limit: int) -> list[str]:
    queue = [root_dir]
    files: list[str] = []

    while queue and len(files) < limit:
        current_dir = queue.pop(0)
        for entry in sorted(current_dir.iterdir(), key=lambda item: item.name):
            if entry.name in {"node_modules", ".next", ".git"}:
                continue

            if entry.is_dir():
                queue.append(entry)
                continue

            files.append(str(entry.relative_to(WORKSPACE_ROOT)))
            if len(files) >= limit:
                break

    return files


def run_patch_command(patch_text: str, strip_count: int, dry_run: bool) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile("w", suffix=".diff", delete=False, encoding="utf-8") as handle:
        handle.write(patch_text)
        temp_patch_path = handle.name

    try:
        command = ["patch", f"-p{strip_count}", "--batch", "--forward"]
        if dry_run:
            command.append("--dry-run")
        command.extend(["-i", temp_patch_path])

        try:
            completed = subprocess.run(
                command,
                cwd=str(WORKSPACE_ROOT),
                capture_output=True,
                text=True,
                timeout=DEFAULT_COMMAND_TIMEOUT_MS / 1000,
                check=False,
            )
            return {
                "ok": completed.returncode == 0,
                "exitCode": completed.returncode,
                "stdout": truncate_output(completed.stdout),
                "stderr": truncate_output(completed.stderr),
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "ok": False,
                "exitCode": None,
                "stdout": truncate_output(exc.stdout or ""),
                "stderr": truncate_output(exc.stderr or ""),
                "error": f"Patch command timed out after {DEFAULT_COMMAND_TIMEOUT_MS}ms",
            }
    finally:
        try:
            os.unlink(temp_patch_path)
        except OSError:
            pass


def parse_unified_patch_by_file(patch_text: str, strip_count: int) -> dict[str, list[dict[str, list[str]]]]:
    file_map: dict[str, list[dict[str, list[str]]]] = {}
    current_file: str | None = None
    current_hunk: dict[str, list[str]] | None = None

    def flush_hunk():
        nonlocal current_hunk
        if not current_file or current_hunk is None:
            return
        file_map.setdefault(current_file, []).append(current_hunk)
        current_hunk = None

    for line in patch_text.split("\n"):
        if line.startswith("--- "):
            flush_hunk()
            current_file = None
            continue

        if line.startswith("+++ "):
            raw_path = line[4:].strip().split("\t")[0]
            current_file = normalize_patch_path(raw_path, strip_count)
            continue

        if line.startswith("@@"):
            flush_hunk()
            if not current_file:
                continue
            current_hunk = {"oldLines": [], "newLines": []}
            continue

        if current_hunk is None:
            continue
        if line.startswith("\\ No newline"):
            continue

        marker = line[:1]
        value = line[1:]
        if marker in {" ", "-"}:
            current_hunk["oldLines"].append(value)
        if marker in {" ", "+"}:
            current_hunk["newLines"].append(value)

    flush_hunk()
    return file_map


def replace_once(source: str, target: str, replacement: str) -> str | None:
    if not target:
        return None
    first_index = source.find(target)
    if first_index == -1:
        return None
    second_index = source.find(target, first_index + len(target))
    if second_index != -1:
        return None
    return f"{source[:first_index]}{replacement}{source[first_index + len(target):]}"


def apply_repair_hunks(current_content: str, hunks: list[dict[str, list[str]]]) -> str | None:
    working_content = current_content

    for hunk in hunks:
        old_text = "\n".join(hunk["oldLines"])
        new_text = "\n".join(hunk["newLines"])
        candidates = [
            (old_text, new_text),
            (old_text.rstrip("\n"), new_text.rstrip("\n")),
            (f"{old_text}\n" if old_text else old_text, f"{new_text}\n" if new_text else new_text),
        ]

        next_content = None
        for candidate_old, candidate_new in candidates:
            next_content = replace_once(working_content, candidate_old, candidate_new)
            if isinstance(next_content, str):
                break

        if not isinstance(next_content, str):
            return None
        working_content = next_content

    return working_content


def build_repair_plan(patch_text: str, strip_count: int) -> dict[str, Any] | None:
    patch_by_file = parse_unified_patch_by_file(patch_text, strip_count)
    if not patch_by_file:
        return None

    repaired_diffs: list[str] = []
    replacements: list[dict[str, str]] = []
    for relative_path, hunks in patch_by_file.items():
        absolute_path = safe_resolve(relative_path)
        if not absolute_path.exists() or not absolute_path.is_file():
            return None

        current_content = absolute_path.read_text(encoding="utf-8")
        repaired_content = apply_repair_hunks(current_content, hunks)
        if not isinstance(repaired_content, str) or repaired_content == current_content:
            return None

        repaired_diffs.append(build_diff_preview(current_content, repaired_content, relative_path))
        replacements.append({"path": relative_path, "content": repaired_content})

    return {"patchText": "\n".join(repaired_diffs), "replacements": replacements}


def collect_reject_artifacts(affected_files: list[str]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for relative_path in affected_files:
        reject_path = f"{relative_path}.rej"
        absolute_reject_path = safe_resolve(reject_path)
        if not absolute_reject_path.exists() or not absolute_reject_path.is_file():
            continue
        content = absolute_reject_path.read_text(encoding="utf-8")
        artifacts.append(
            {
                "path": relative_path,
                "rejectPath": reject_path,
                "rejectPreview": preview_content(content),
            }
        )
    return artifacts


def clear_reject_artifacts(artifacts: list[dict[str, Any]]):
    for artifact in artifacts:
        reject_path = artifact.get("rejectPath")
        if not isinstance(reject_path, str):
            continue
        try:
            safe_resolve(reject_path).unlink(missing_ok=True)
        except OSError:
            pass


def tool_list_files(arguments: dict[str, Any]) -> str:
    relative_path = arguments.get("path") if isinstance(arguments.get("path"), str) else "."
    limit = arguments.get("limit") if isinstance(arguments.get("limit"), int) else 80
    limit = max(1, min(200, limit))
    absolute_dir = safe_resolve(relative_path)

    if not absolute_dir.exists() or not absolute_dir.is_dir():
        raise ValueError(f"Directory does not exist: {relative_path}")

    payload = {
        "status": "ok",
        "path": relative_path,
        "limit": limit,
        "files": walk_files(absolute_dir, limit),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def tool_read_file(arguments: dict[str, Any]) -> str:
    relative_path = arguments.get("path")
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise ValueError("read_file requires a relative file path.")

    absolute_path = safe_resolve(relative_path.strip())
    if not absolute_path.exists() or not absolute_path.is_file():
        raise ValueError(f"File does not exist: {relative_path}")

    raw = absolute_path.read_text(encoding="utf-8")[:MAX_FILE_BYTES]
    lines = raw.splitlines()
    requested_start = arguments.get("startLine") if isinstance(arguments.get("startLine"), int) else 1
    requested_end = arguments.get("endLine") if isinstance(arguments.get("endLine"), int) else requested_start + MAX_FILE_LINES - 1
    start_line = max(1, requested_start)
    end_line = min(max(start_line, requested_end), start_line + MAX_FILE_LINES - 1, len(lines))
    content = "\n".join(lines[start_line - 1 : end_line])

    payload = {
        "status": "ok",
        "path": relative_path,
        "startLine": start_line,
        "endLine": end_line,
        "content": content,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def tool_execute_command(arguments: dict[str, Any]) -> str:
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("execute_command requires a non-empty command string.")

    command = command.strip()
    policy = classify_command(command)
    relative_cwd = arguments.get("cwd") if isinstance(arguments.get("cwd"), str) else "."
    cwd = safe_resolve(relative_cwd)
    timeout_ms = arguments.get("timeoutMs") if isinstance(arguments.get("timeoutMs"), int) else DEFAULT_COMMAND_TIMEOUT_MS
    timeout_ms = max(1000, min(MAX_COMMAND_TIMEOUT_MS, timeout_ms))
    payload_hash = stable_hash({"command": command, "cwd": relative_cwd, "timeoutMs": timeout_ms})

    if policy.get("requiresConfirmation"):
        confirmation_token = arguments.get("confirmationToken") if isinstance(arguments.get("confirmationToken"), str) else None
        confirmed = consume_confirmation(confirmation_token, "execute_command", payload_hash, [])
        if not confirmed:
            confirmation = issue_confirmation("execute_command", payload_hash, [])
            payload = {
                "status": "confirmation_required",
                "command": command,
                "cwd": str(cwd.relative_to(WORKSPACE_ROOT)) or ".",
                "policyLevel": policy["level"],
                "policyReason": policy["reason"],
                "confirmationToken": confirmation["token"],
                "expiresAt": confirmation["expiresAt"],
                "message": "Workspace-changing commands require an explicit approval before execution. Approve this step only if the command should mutate workspace files.",
            }
            return json.dumps(payload, ensure_ascii=False, indent=2)

    if not policy["allowed"]:
        payload = {
            "status": "blocked",
            "command": command,
            "cwd": str(cwd.relative_to(WORKSPACE_ROOT)) or ".",
            "policyLevel": policy["level"],
            "policyReason": policy["reason"],
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    started_at = time.time()
    try:
        completed = subprocess.run(
            command,
            shell=True,
            executable="/bin/zsh",
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
        )
        payload = {
            "status": "ok",
            "command": command,
            "cwd": str(cwd.relative_to(WORKSPACE_ROOT)) or ".",
            "policyLevel": policy["level"],
            "policyReason": policy["reason"],
            "exitCode": completed.returncode,
            "durationMs": int((time.time() - started_at) * 1000),
            "confirmationUsed": bool(policy.get("requiresConfirmation")),
            "stdout": truncate_output(completed.stdout),
            "stderr": truncate_output(completed.stderr),
        }
    except subprocess.TimeoutExpired as exc:
        payload = {
            "status": "error",
            "command": command,
            "cwd": str(cwd.relative_to(WORKSPACE_ROOT)) or ".",
            "policyLevel": policy["level"],
            "policyReason": policy["reason"],
            "exitCode": None,
            "durationMs": int((time.time() - started_at) * 1000),
            "confirmationUsed": bool(policy.get("requiresConfirmation")),
            "stdout": truncate_output(exc.stdout or ""),
            "stderr": truncate_output(exc.stderr or ""),
            "error": f"Command timed out after {timeout_ms}ms",
        }

    return json.dumps(payload, ensure_ascii=False, indent=2)


def tool_write_file(arguments: dict[str, Any]) -> str:
    relative_path = arguments.get("path")
    content = arguments.get("content")
    if not isinstance(relative_path, str) or not relative_path.strip():
        raise ValueError("write_file requires a relative file path.")
    if not isinstance(content, str):
        raise ValueError("write_file requires string content.")

    relative_path = relative_path.strip()
    absolute_path = safe_resolve(relative_path)
    mode = arguments.get("mode") if isinstance(arguments.get("mode"), str) else "overwrite"
    if mode not in {"overwrite", "append", "error_if_exists"}:
        mode = "overwrite"
    create_directories = arguments.get("createDirectories")
    if create_directories is not False:
        absolute_path.parent.mkdir(parents=True, exist_ok=True)

    protected_paths = get_protected_paths([relative_path])
    payload_hash = stable_hash({"path": relative_path, "content": content, "mode": mode})
    before_snapshot = read_snapshot(relative_path)
    before_content = absolute_path.read_text(encoding="utf-8") if before_snapshot["exists"] else ""
    planned_after_content = f"{before_content}{content}" if mode == "append" else content
    diff_preview = build_diff_preview(before_content, planned_after_content, relative_path)

    if protected_paths:
        confirmation_token = arguments.get("confirmationToken") if isinstance(arguments.get("confirmationToken"), str) else None
        confirmed = consume_confirmation(confirmation_token, "write_file", payload_hash, protected_paths)
        if not confirmed:
            confirmation = issue_confirmation("write_file", payload_hash, protected_paths)
            payload = {
                "status": "confirmation_required",
                "path": relative_path,
                "mode": mode,
                "protectedPaths": protected_paths,
                "confirmationToken": confirmation["token"],
                "expiresAt": confirmation["expiresAt"],
                "diffPreview": diff_preview,
                "contentPreview": preview_content(planned_after_content),
                "message": "Protected source paths require a second confirmed write. Call write_file again with the returned confirmationToken if you want to apply this change.",
            }
            return json.dumps(payload, ensure_ascii=False, indent=2)

    if before_snapshot["exists"] and mode == "error_if_exists":
        raise ValueError(f"Refusing to overwrite existing file: {relative_path}")

    if mode == "append":
        with open(absolute_path, "a", encoding="utf-8") as handle:
            handle.write(content)
    else:
        absolute_path.write_text(content, encoding="utf-8")

    after_content = absolute_path.read_text(encoding="utf-8")
    after_snapshot = read_snapshot(relative_path)
    verified = after_content.endswith(content) if mode == "append" else after_content == content
    payload = {
        "status": "written",
        "path": relative_path,
        "mode": mode,
        "fileExisted": before_snapshot["exists"],
        "bytesWritten": len(content.encode("utf-8")),
        "beforeHash": before_snapshot["hash"],
        "afterHash": after_snapshot["hash"],
        "verified": verified,
        "diffPreview": diff_preview,
        "contentPreview": after_snapshot["preview"],
        "confirmationUsed": bool(protected_paths),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def tool_apply_patch(arguments: dict[str, Any]) -> str:
    patch_text = arguments.get("patch")
    if not isinstance(patch_text, str) or not patch_text.strip():
        raise ValueError("apply_patch requires unified diff text.")

    strip_count = arguments.get("stripCount") if isinstance(arguments.get("stripCount"), int) else 1
    strip_count = max(0, min(3, strip_count))
    dry_run = arguments.get("dryRun") is True
    attempt_auto_repair = arguments.get("attemptAutoRepair") is not False
    validate_patch_paths(patch_text, strip_count)
    affected_files = extract_patch_paths(patch_text, strip_count)
    protected_paths = get_protected_paths(affected_files)
    payload_hash = stable_hash({"patch": patch_text, "stripCount": strip_count})
    diff_preview = truncate_output(patch_text, MAX_DIFF_PREVIEW_CHARS)

    if not dry_run and protected_paths:
        preview_run = run_patch_command(patch_text, strip_count, True)
        confirmation_token = arguments.get("confirmationToken") if isinstance(arguments.get("confirmationToken"), str) else None
        confirmed = consume_confirmation(confirmation_token, "apply_patch", payload_hash, protected_paths)
        if not confirmed:
            confirmation = issue_confirmation("apply_patch", payload_hash, protected_paths)
            payload = {
                "status": "confirmation_required",
                "dryRunStatus": "dry_run_ok" if preview_run["ok"] else "dry_run_failed",
                "stripCount": strip_count,
                "protectedPaths": protected_paths,
                "affectedFiles": affected_files,
                "confirmationToken": confirmation["token"],
                "expiresAt": confirmation["expiresAt"],
                "diffPreview": diff_preview,
                "stdout": preview_run.get("stdout", ""),
                "stderr": preview_run.get("stderr", ""),
                "exitCode": preview_run.get("exitCode"),
                "error": preview_run.get("error"),
                "message": "Protected source paths require a second confirmed patch. Call apply_patch again with the returned confirmationToken if you want to apply this change.",
            }
            return json.dumps(payload, ensure_ascii=False, indent=2)

    before_snapshots = {path: read_snapshot(path) for path in affected_files}
    first_run = run_patch_command(patch_text, strip_count, dry_run)
    after_snapshots = {path: read_snapshot(path) for path in affected_files}

    if first_run["ok"]:
        payload = {
            "status": "dry_run_ok" if dry_run else "patched",
            "dryRun": dry_run,
            "stripCount": strip_count,
            "affectedFiles": affected_files,
            "exitCode": first_run.get("exitCode"),
            "diffPreview": diff_preview,
            "stdout": first_run.get("stdout", ""),
            "stderr": first_run.get("stderr", ""),
            "verification": [
                {
                    "path": path,
                    "existedBefore": before_snapshots[path]["exists"],
                    "existsAfter": after_snapshots[path]["exists"],
                    "beforeHash": before_snapshots[path]["hash"],
                    "afterHash": after_snapshots[path]["hash"],
                    "changed": before_snapshots[path]["hash"] != after_snapshots[path]["hash"],
                    "contentPreview": after_snapshots[path]["preview"],
                }
                for path in affected_files
            ],
            "confirmationUsed": bool(protected_paths) and not dry_run,
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    reject_artifacts = collect_reject_artifacts(affected_files)
    repair_plan = build_repair_plan(patch_text, strip_count) if (not dry_run and attempt_auto_repair) else None

    if repair_plan:
        for replacement in repair_plan["replacements"]:
            safe_resolve(replacement["path"]).write_text(replacement["content"], encoding="utf-8")
        repaired_snapshots = {path: read_snapshot(path) for path in affected_files}
        clear_reject_artifacts(reject_artifacts)
        payload = {
            "status": "patched_after_repair",
            "dryRun": dry_run,
            "stripCount": strip_count,
            "affectedFiles": affected_files,
            "exitCode": 0,
            "diffPreview": diff_preview,
            "repairPatch": repair_plan["patchText"],
            "stdout": "Repair patch synthesized and applied via direct file rewrite.\n",
            "stderr": "",
            "initialFailure": {
                "exitCode": first_run.get("exitCode"),
                "stdout": first_run.get("stdout", ""),
                "stderr": first_run.get("stderr", ""),
                "error": first_run.get("error"),
                "rejectArtifacts": reject_artifacts,
            },
            "verification": [
                {
                    "path": path,
                    "existedBefore": before_snapshots[path]["exists"],
                    "existsAfter": repaired_snapshots[path]["exists"],
                    "beforeHash": before_snapshots[path]["hash"],
                    "afterHash": repaired_snapshots[path]["hash"],
                    "changed": before_snapshots[path]["hash"] != repaired_snapshots[path]["hash"],
                    "contentPreview": repaired_snapshots[path]["preview"],
                }
                for path in affected_files
            ],
            "repairMethod": "direct_write",
        }
        return json.dumps(payload, ensure_ascii=False, indent=2)

    payload = {
        "status": "dry_run_failed" if dry_run else "patch_failed",
        "dryRun": dry_run,
        "stripCount": strip_count,
        "affectedFiles": affected_files,
        "exitCode": first_run.get("exitCode"),
        "diffPreview": diff_preview,
        "stdout": first_run.get("stdout", ""),
        "stderr": first_run.get("stderr", ""),
        "error": first_run.get("error"),
        "rejectArtifacts": reject_artifacts,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


TOOL_HANDLERS = {
    "list_files": tool_list_files,
    "read_file": tool_read_file,
    "execute_command": tool_execute_command,
    "write_file": tool_write_file,
    "apply_patch": tool_apply_patch,
}


def get_loaded_runtime(alias: str):
    global loaded_alias, loaded_model, loaded_tokenizer

    repo = MODEL_REPOS.get(alias)
    if not repo:
        raise HTTPException(status_code=404, detail=f"Unsupported local model alias: {alias}")

    with load_lock:
        if loaded_alias != alias or loaded_model is None or loaded_tokenizer is None:
            if loaded_alias != alias:
                loaded_model = None
                loaded_tokenizer = None
                gc.collect()
                try:
                    import mlx.core as mx

                    mx.clear_cache()
                    if hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
                        mx.metal.clear_cache()
                except Exception:
                    pass
            _, load_fn, _ = get_mlx_runtime()
            loaded_model, loaded_tokenizer = load_fn(repo)
            loaded_alias = alias

    return repo, loaded_model, loaded_tokenizer


def release_loaded_runtime():
    global loaded_alias, loaded_model, loaded_tokenizer

    with load_lock:
        released_alias = loaded_alias
        loaded_alias = None
        loaded_model = None
        loaded_tokenizer = None
        gc.collect()

        try:
            ensure_mlx_imported()
            import mlx.core as mx  # type: ignore

            mx.clear_cache()
            if hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
                mx.metal.clear_cache()
        except Exception:
            pass

    return released_alias


def build_prompt(tokenizer: Any, messages: list[dict[str, str]]):
    try:
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
    except TypeError:
        return tokenizer.apply_chat_template(messages, add_generation_prompt=True)


def project_visible_content(raw: str) -> str:
    tags = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
    ]

    cursor = 0
    visible = ""

    while cursor < len(raw):
        earliest_start = -1
        earliest_open = ""
        earliest_close = ""

        for open_tag, close_tag in tags:
            start = raw.find(open_tag, cursor)
            if start == -1:
                continue
            if earliest_start == -1 or start < earliest_start:
                earliest_start = start
                earliest_open = open_tag
                earliest_close = close_tag

        if earliest_start == -1:
            visible += raw[cursor:]
            break

        visible += raw[cursor:earliest_start]
        close_index = raw.find(earliest_close, earliest_start + len(earliest_open))
        if close_index == -1:
            break
        cursor = close_index + len(earliest_close)

    return visible


def sanitize_assistant_content(content: str) -> str:
    sanitized = (
        content.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("<think>", "")
        .replace("</think>", "")
        .replace("<thinking>", "")
        .replace("</thinking>", "")
        .strip()
    )
    return sanitized or content.strip()


def finalize_visible_content(raw: str) -> str:
    visible = sanitize_assistant_content(project_visible_content(raw))
    if visible:
        return visible

    tags = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
    ]
    fallback = raw
    used_fallback = False
    for open_tag, close_tag in tags:
        if fallback.count(open_tag) > fallback.count(close_tag):
            fallback = fallback.replace(open_tag, "").replace(close_tag, "")
            used_fallback = True

    if used_fallback:
        repaired = sanitize_assistant_content(fallback)
        if repaired:
            return repaired

    return visible


def create_visible_projector():
    raw = ""
    sent = ""

    def push(segment: str):
        nonlocal raw, sent
        raw += segment
        visible = project_visible_content(raw)
        delta = visible[len(sent):]
        sent = visible
        return {"delta": delta, "visible": visible}

    def finish():
        nonlocal sent
        visible = finalize_visible_content(raw)
        delta = visible[len(sent):]
        sent = visible
        return {"delta": delta, "visible": visible}

    return {"push": push, "finish": finish}


def tool_catalog_text() -> str:
    return "\n".join(
        [
            "- list_files(path='.', limit=80): list files inside the workspace.",
            "- read_file(path, startLine=1, endLine=240): read UTF-8 file content.",
            "- execute_command(command, cwd='.', timeoutMs=20000, confirmationToken?): run an allowlisted read/build/formatter/patcher/package-manager/misc-write command. workspace-changing classes require confirmation.",
            "- write_file(path, content, mode='overwrite', createDirectories=true, confirmationToken?): write or append a file and return a diff preview plus verification.",
            "- apply_patch(patch, stripCount=1, dryRun=false, confirmationToken?, attemptAutoRepair=true): apply a unified diff patch and return verification details.",
        ]
    )


def extract_json_object(raw_text: str) -> dict[str, Any] | None:
    cleaned = raw_text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if not match:
        return None

    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    return parsed if isinstance(parsed, dict) else None


def latest_user_prompt(messages: list[ChatMessage]) -> str:
    for message in reversed(messages):
        if message.role == "user":
            return message.content
    return ""


def extract_fenced_block(prompt: str) -> str | None:
    match = re.search(r"```(?:diff|patch)?\s*(.*?)```", prompt, re.DOTALL | re.IGNORECASE)
    if not match:
        return None
    content = match.group(1).strip()
    return content if content else None


def extract_unified_diff(prompt: str) -> str | None:
    fenced = extract_fenced_block(prompt)
    if fenced and "--- " in fenced and "+++ " in fenced:
        return fenced

    start_index = prompt.find("--- ")
    if start_index >= 0:
        prompt = prompt[start_index:]

    lines = prompt.splitlines()
    capture: list[str] = []
    started = False
    for line in lines:
        if not started and line.startswith("--- "):
            started = True
        if not started:
            continue

        if line.startswith(("--- ", "+++ ", "@@", "+", "-", " ")) or line == "":
            capture.append(line)
            continue
        break

    patch = "\n".join(capture).strip()
    if patch and "--- " in patch and "+++ " in patch:
        return patch
    return None


def extract_explicit_command(prompt: str) -> str | None:
    backtick_match = re.search(r"use\s+execute_command\s+to\s+run\s+`([^`]+)`", prompt, re.IGNORECASE)
    if backtick_match:
        return backtick_match.group(1).strip()

    plain_match = re.search(
        r"use\s+execute_command\s+to\s+run\s+(.+?)(?:\n|,?\s+then\b|$)",
        prompt,
        re.IGNORECASE | re.DOTALL,
    )
    if not plain_match:
        return None

    command = plain_match.group(1).strip().strip("`\"'")
    command = re.sub(r"\s+in the workspace root\.?$", "", command, flags=re.IGNORECASE)
    command = re.sub(r"\s+inside the workspace\.?$", "", command, flags=re.IGNORECASE)
    return command or None


def infer_forced_tool_action(prompt: str) -> dict[str, Any] | None:
    lowered = prompt.lower()

    if "use apply_patch" in lowered:
        patch_text = extract_unified_diff(prompt)
        if patch_text:
            return {
                "tool_name": "apply_patch",
                "arguments": {
                    "patch": patch_text,
                    "stripCount": 1,
                    "dryRun": False,
                    "attemptAutoRepair": True,
                },
            }

    if "use execute_command" in lowered:
        command = extract_explicit_command(prompt)
        if command:
            return {
                "tool_name": "execute_command",
                "arguments": {"command": command, "cwd": ".", "timeoutMs": DEFAULT_COMMAND_TIMEOUT_MS},
            }

    return None


def normalize_conversation(messages: list[ChatMessage], tool_mode: bool) -> list[dict[str, str]]:
    system_messages = [message.content for message in messages if message.role == "system"]
    normal_messages = [
        {"role": message.role, "content": message.content}
        for message in messages
        if message.role in {"user", "assistant"}
    ]

    if not tool_mode:
        if system_messages:
            return [{"role": "system", "content": "\n\n".join(system_messages)}] + normal_messages
        return normal_messages

    tool_system = "\n\n".join(
        [*system_messages, LOCAL_TOOL_INSTRUCTIONS, "Available tools:\n" + tool_catalog_text()]
    )
    return [{"role": "system", "content": tool_system}] + normal_messages


EMPTY_RESPONSE_RECOVERY_INSTRUCTION = (
    "Reply with a direct plain-text answer only. "
    "Do not output <think>, <thinking>, hidden reasoning, or any empty wrapper."
)


def build_empty_response_recovery_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    recovered = [dict(message) for message in messages]
    if recovered and recovered[0].get("role") == "system":
        recovered[0]["content"] = (
            f"{recovered[0].get('content', '').rstrip()}\n\n{EMPTY_RESPONSE_RECOVERY_INSTRUCTION}"
        ).strip()
    else:
        recovered.insert(
            0,
            {
                "role": "system",
                "content": EMPTY_RESPONSE_RECOVERY_INSTRUCTION,
            },
        )
    return recovered


def generate_once(model: Any, tokenizer: Any, messages: list[dict[str, str]], max_tokens: int) -> str:
    generate_fn, _, _ = get_mlx_runtime()
    prompt = build_prompt(tokenizer, messages)
    return generate_fn(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    ).strip()


def count_tokens(tokenizer: Any, text: str) -> int:
    if not text:
        return 0
    try:
        encoded = tokenizer.encode(text)
        return len(encoded)
    except Exception:
        return max(1, len(text) // 4)


def generate_with_usage(model: Any, tokenizer: Any, messages: list[dict[str, str]], max_tokens: int):
    generate_fn, _, _ = get_mlx_runtime()
    prompt = build_prompt(tokenizer, messages)
    raw_completion = generate_fn(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=max_tokens,
        verbose=False,
    ).strip()
    completion = finalize_visible_content(raw_completion)
    prompt_tokens = count_tokens(tokenizer, prompt)
    completion_tokens = count_tokens(tokenizer, completion)
    return completion, {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def stream_plain_completion(model: Any, tokenizer: Any, messages: list[dict[str, str]], max_tokens: int):
    _, _, stream_generate_fn = get_mlx_runtime()
    prompt = build_prompt(tokenizer, messages)
    prompt_tokens = count_tokens(tokenizer, prompt)

    def generate_events():
        request_id = f"local-stream-{uuid.uuid4().hex}"
        created = int(time.time())
        visible_projector = create_visible_projector()
        completion_text = ""
        generation_tokens = 0

        try:
            for response in stream_generate_fn(
                model,
                tokenizer,
                prompt=prompt,
                max_tokens=max_tokens,
            ):
                segment = getattr(response, "text", "") or ""
                if segment:
                    projected = visible_projector["push"](segment)
                    delta = projected["delta"]
                    completion_text = projected["visible"]
                    if delta:
                        yield json.dumps(
                            {
                                "type": "delta",
                                "id": request_id,
                                "created": created,
                                "model": loaded_alias,
                                "delta": delta,
                            },
                            ensure_ascii=False,
                        ) + "\n"
                generation_tokens = max(generation_tokens, int(getattr(response, "generation_tokens", 0) or 0))

            final_projection = visible_projector["finish"]()
            final_delta = final_projection["delta"]
            completion_text = final_projection["visible"]
            if final_delta:
                yield json.dumps(
                    {
                        "type": "delta",
                        "id": request_id,
                        "created": created,
                        "model": loaded_alias,
                        "delta": final_delta,
                    },
                    ensure_ascii=False,
                        ) + "\n"

            total_prompt_tokens = prompt_tokens
            total_completion_tokens = max(generation_tokens, count_tokens(tokenizer, completion_text))
            warning = None

            if not completion_text.strip():
                retry_messages = build_empty_response_recovery_messages(messages)
                retry_completion, retry_usage = generate_with_usage(
                    model, tokenizer, retry_messages, max_tokens
                )
                total_prompt_tokens += retry_usage["prompt_tokens"]
                total_completion_tokens += retry_usage["completion_tokens"]
                if retry_completion.strip():
                    completion_text = retry_completion
                    warning = "Recovered after an empty first local response."
                    yield json.dumps(
                        {
                            "type": "delta",
                            "id": request_id,
                            "created": created,
                            "model": loaded_alias,
                            "delta": completion_text,
                        },
                        ensure_ascii=False,
                    ) + "\n"
                else:
                    warning = "Local model returned an empty visible response twice."

            yield json.dumps(
                {
                    "type": "done",
                    "id": request_id,
                    "created": created,
                    "model": loaded_alias,
                    "content": completion_text,
                    "usage": {
                        "prompt_tokens": total_prompt_tokens,
                        "completion_tokens": total_completion_tokens,
                        "total_tokens": total_prompt_tokens + total_completion_tokens,
                    },
                    "warning": warning,
                },
                ensure_ascii=False,
            ) + "\n"
        except Exception as exc:  # pragma: no cover - streaming path
            yield json.dumps({"type": "error", "error": str(exc)}, ensure_ascii=False) + "\n"

    return generate_events()


def normalize_final_content(content: Any) -> str:
    if isinstance(content, str):
        return finalize_visible_content(content)
    if isinstance(content, list):
        if all(isinstance(item, str) for item in content):
            return "\n".join(f"- {item}" for item in content)
        return json.dumps(content, ensure_ascii=False, indent=2)
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False, indent=2)
    return str(content)


def append_tool_result(
    working_messages: list[dict[str, str]], tool_name: str, arguments: dict[str, Any], output: str
):
    working_messages.append(
        {
            "role": "assistant",
            "content": json.dumps(
                {"type": "tool", "tool_name": tool_name, "arguments": arguments},
                ensure_ascii=False,
            ),
        }
    )
    working_messages.append(
        {
            "role": "user",
            "content": (
                f"Tool result from {tool_name}:\n{output}\n\n"
                "Now decide whether you need one more tool or can answer. "
                "Reply with one JSON object only."
            ),
        }
    )


def run_tool_handler(tool_name: str, arguments: dict[str, Any]) -> str:
    handler = TOOL_HANDLERS.get(tool_name)
    if not handler:
        return json.dumps(
            {"status": "error", "error": f"Unsupported tool: {tool_name}"},
            ensure_ascii=False,
            indent=2,
        )

    try:
        return handler(arguments)
    except Exception as exc:  # pragma: no cover - tool error path
        return json.dumps(
            {"status": "error", "tool": tool_name, "arguments": arguments, "error": str(exc)},
            ensure_ascii=False,
            indent=2,
        )


def run_local_tool_loop(model_alias: str, model: Any, tokenizer: Any, request: ChatCompletionsRequest):
    working_messages = normalize_conversation(request.messages, tool_mode=True)
    tool_runs: list[dict[str, Any]] = []
    warning = None
    retry_count = 0
    forced_action = None
    forced_used = False
    usage = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }

    if model_alias in FORCED_TOOL_MODELS:
        forced_action = infer_forced_tool_action(latest_user_prompt(request.messages))

    for _ in range(MAX_TOOL_STEPS):
        if forced_action and not forced_used and not tool_runs:
            tool_name = forced_action["tool_name"]
            arguments = forced_action["arguments"]
            output = run_tool_handler(tool_name, arguments)
            tool_runs.append({"name": tool_name, "input": arguments, "output": output})
            append_tool_result(working_messages, tool_name, arguments, output)
            forced_used = True
            warning = warning or f"Forced tool routing was used for {tool_name} to stabilize the local 4-bit 4B agent."
            continue

        raw_output, step_usage = generate_with_usage(model, tokenizer, working_messages, request.max_tokens)
        usage["prompt_tokens"] += step_usage["prompt_tokens"]
        usage["completion_tokens"] += step_usage["completion_tokens"]
        usage["total_tokens"] += step_usage["total_tokens"]
        action = extract_json_object(raw_output)

        if not action:
            if retry_count < MAX_ACTION_RETRIES:
                retry_count += 1
                working_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your last reply was not valid JSON. Respond with exactly one JSON object. "
                            "If the task needs shell inspection or patching, call the correct tool now."
                        ),
                    }
                )
                continue
            return raw_output, tool_runs, warning or "Model did not emit valid tool JSON. Returned raw assistant text instead.", usage

        retry_count = 0
        action_type = action.get("type")
        if action_type == "final":
            if forced_action and not forced_used:
                tool_name = forced_action["tool_name"]
                arguments = forced_action["arguments"]
                output = run_tool_handler(tool_name, arguments)
                tool_runs.append({"name": tool_name, "input": arguments, "output": output})
                append_tool_result(working_messages, tool_name, arguments, output)
                forced_used = True
                warning = warning or f"Forced tool routing was used for {tool_name} to stabilize the local 4-bit 4B agent."
                continue
            return normalize_final_content(action.get("content")), tool_runs, warning, usage

        if action_type != "tool":
            if retry_count < MAX_ACTION_RETRIES:
                retry_count += 1
                working_messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your last reply used an unsupported action type. Reply with one JSON object only. "
                            "Use type=tool or type=final."
                        ),
                    }
                )
                continue
            return raw_output, tool_runs, warning or "Model emitted an unsupported action type. Returned raw assistant text instead.", usage

        tool_name = action.get("tool_name")
        arguments = action.get("arguments")
        if not isinstance(tool_name, str) or tool_name not in TOOL_HANDLERS:
            if retry_count < MAX_ACTION_RETRIES:
                retry_count += 1
                working_messages.append(
                    {
                        "role": "user",
                        "content": "That tool is unsupported. Choose one of the available tools and reply with one JSON object only.",
                    }
                )
                continue
            return raw_output, tool_runs, warning or f"Model requested an unsupported tool: {tool_name!r}", usage
        if not isinstance(arguments, dict):
            if retry_count < MAX_ACTION_RETRIES:
                retry_count += 1
                working_messages.append(
                    {
                        "role": "user",
                        "content": "Tool call arguments must be a JSON object. Reply again with corrected tool arguments.",
                    }
                )
                continue
            return raw_output, tool_runs, warning or "Tool call arguments were not a JSON object.", usage

        output = run_tool_handler(tool_name, arguments)
        tool_runs.append({"name": tool_name, "input": arguments, "output": output})
        append_tool_result(working_messages, tool_name, arguments, output)

    final_output, final_usage = generate_with_usage(model, tokenizer, working_messages, request.max_tokens)
    usage["prompt_tokens"] += final_usage["prompt_tokens"]
    usage["completion_tokens"] += final_usage["completion_tokens"]
    usage["total_tokens"] += final_usage["total_tokens"]
    return final_output, tool_runs, warning or "Tool loop hit the step limit and fell back to a final model answer.", usage


@app.get("/health")
def health():
    cleanup_expired_confirmations()
    with state_lock:
        current_queue_depth = queued_requests
        current_active_requests = active_requests

    return {
        "status": "ok",
        "loaded_alias": loaded_alias,
        "available_models": list(MODEL_REPOS.keys()),
        "workspace_root": str(WORKSPACE_ROOT),
        "busy": current_active_requests > 0 or current_queue_depth > 0,
        "queue_depth": current_queue_depth,
        "active_requests": current_active_requests,
        "pending_confirmations": len(pending_confirmations),
    }


@app.get("/v1/models")
def list_models():
    return {
        "data": [
            {
                "id": alias,
                "object": "model",
                "owned_by": "local-mlx-gateway",
                "repo": repo,
            }
            for alias, repo in MODEL_REPOS.items()
        ]
    }


@app.post("/v1/models/prewarm")
def prewarm_model(request: PrewarmModelRequest):
    load_started_at = time.perf_counter()
    repo, model, tokenizer = get_loaded_runtime(request.model)
    load_ms = round((time.perf_counter() - load_started_at) * 1000, 1)
    warmup_ms = 0.0
    sample = "SKIPPED"

    if request.warm_generate:
        warm_started_at = time.perf_counter()
        completion = generate_once(
            model,
            tokenizer,
            [
                {"role": "system", "content": "Reply with READY only."},
                {"role": "user", "content": "READY"},
            ],
            request.max_tokens,
        )
        warmup_ms = round((time.perf_counter() - warm_started_at) * 1000, 1)
        sample = finalize_visible_content(completion)

    return {
        "ok": True,
        "model": request.model,
        "repo": repo,
        "loaded_alias": loaded_alias,
        "load_ms": load_ms,
        "warmup_ms": warmup_ms,
        "sample": sample,
        "warmGenerate": request.warm_generate,
    }


@app.post("/v1/models/release")
def release_model():
    released_alias = release_loaded_runtime()
    return {
        "ok": True,
        "released_alias": released_alias,
        "loaded_alias": loaded_alias,
        "message": "Released the currently loaded local model.",
    }


@app.post("/v1/tools/run")
def run_direct_tool(request: DirectToolRequest):
    output = run_tool_handler(request.tool_name, request.arguments)
    return {
        "name": request.tool_name,
        "input": request.arguments,
        "output": output,
    }


@app.post("/v1/tools/confirmations/reject")
def reject_direct_confirmation(request: RejectConfirmationRequest):
    cancelled = cancel_confirmation(request.confirmation_token)
    return {
        "name": "confirmation_reject",
        "input": {"confirmationToken": request.confirmation_token},
        "output": json.dumps(
            {
                "status": "rejected_by_user",
                "confirmationToken": request.confirmation_token,
                "cancelled": cancelled,
                "message": "Pending confirmation was rejected and will not be executed.",
            },
            ensure_ascii=False,
            indent=2,
        ),
    }


@app.post("/v1/chat/completions")
def chat_completions(request: ChatCompletionsRequest):
    global queued_requests, active_requests

    with state_lock:
        queued_requests += 1

    promoted_to_active = False
    try:
        repo, model, tokenizer = get_loaded_runtime(request.model)
        tool_mode = bool(request.tools) and request.tool_choice != "none"

        with inference_lock:
            with state_lock:
                queued_requests = max(0, queued_requests - 1)
                active_requests += 1
                promoted_to_active = True

            if tool_mode:
                completion, tool_runs, warning, usage = run_local_tool_loop(request.model, model, tokenizer, request)
            else:
                prompt_messages = normalize_conversation(request.messages, tool_mode=False)
                completion, usage = generate_with_usage(model, tokenizer, prompt_messages, request.max_tokens)
                tool_runs = []
                warning = None
                if not completion.strip():
                    retry_messages = build_empty_response_recovery_messages(prompt_messages)
                    retry_completion, retry_usage = generate_with_usage(
                        model, tokenizer, retry_messages, request.max_tokens
                    )
                    usage = {
                        "prompt_tokens": usage["prompt_tokens"] + retry_usage["prompt_tokens"],
                        "completion_tokens": usage["completion_tokens"] + retry_usage["completion_tokens"],
                        "total_tokens": usage["total_tokens"] + retry_usage["total_tokens"],
                    }
                    if retry_completion.strip():
                        completion = retry_completion
                        warning = "Recovered after an empty first local response."
                    else:
                        warning = "Local model returned an empty visible response twice."
    except Exception as exc:  # pragma: no cover - inference path
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        with state_lock:
            if promoted_to_active:
                active_requests = max(0, active_requests - 1)
            else:
                queued_requests = max(0, queued_requests - 1)

    payload = {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": request.model,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": completion,
                },
            }
        ],
        "usage": {
            "prompt_tokens": usage["prompt_tokens"],
            "completion_tokens": usage["completion_tokens"],
            "total_tokens": usage["total_tokens"],
        },
        "repo": repo,
        "tool_runs": tool_runs,
    }

    if warning:
        payload["warning"] = warning

    return payload


@app.post("/v1/chat/completions/stream")
def chat_completions_stream(request: ChatCompletionsRequest):
    global queued_requests, active_requests

    with state_lock:
        queued_requests += 1

    repo, model, tokenizer = get_loaded_runtime(request.model)
    tool_mode = bool(request.tools) and request.tool_choice != "none"
    if tool_mode:
        with state_lock:
            queued_requests = max(0, queued_requests - 1)
        raise HTTPException(status_code=400, detail="Streaming is available only for chat-only local requests.")

    def event_stream():
        global queued_requests, active_requests
        promoted_to_active = False
        try:
            with inference_lock:
                with state_lock:
                    queued_requests = max(0, queued_requests - 1)
                    active_requests += 1
                    promoted_to_active = True

                prompt_messages = normalize_conversation(request.messages, tool_mode=False)
                yield from stream_plain_completion(model, tokenizer, prompt_messages, request.max_tokens)
        finally:
            with state_lock:
                if promoted_to_active:
                    active_requests = max(0, active_requests - 1)
                else:
                    queued_requests = max(0, queued_requests - 1)

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4000)
