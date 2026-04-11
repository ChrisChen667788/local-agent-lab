#!/usr/bin/env python3
import os
import sys
from pathlib import Path

REPO_ID = os.environ.get("MODELSCOPE_REPO_ID", "haozi667788/first-llm-studio")
TOKEN = os.environ.get("MODELSCOPE_API_TOKEN")
ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIR = ROOT / "dist" / "modelscope-first-llm-studio"

if not PACKAGE_DIR.exists():
    print(f"Package directory not found: {PACKAGE_DIR}", file=sys.stderr)
    print("Run ./scripts/prepare-modelscope-package.sh first.", file=sys.stderr)
    sys.exit(1)

if not TOKEN:
    print("MODELSCOPE_API_TOKEN is required.", file=sys.stderr)
    sys.exit(1)

try:
    from modelscope.hub.api import HubApi
except Exception as exc:
    print("modelscope SDK is not installed. Try: pip install modelscope", file=sys.stderr)
    print(str(exc), file=sys.stderr)
    sys.exit(1)

api = HubApi()
api.create_repo(
    repo_id=REPO_ID,
    token=TOKEN,
    visibility="public",
    repo_type="model",
    chinese_name="First LLM Studio｜本地优先 LLM 工作台",
    license="MIT",
    exist_ok=True,
    create_default_config=False,
)

commit_info = api.upload_folder(
    repo_id=REPO_ID,
    folder_path=str(PACKAGE_DIR),
    commit_message="Initial First LLM Studio open-source launch",
    commit_description="Upload bilingual launch-ready project package for First LLM Studio.",
    token=TOKEN,
    repo_type="model",
)

print(getattr(commit_info, "commit_url", commit_info))
