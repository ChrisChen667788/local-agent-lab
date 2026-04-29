# Fine-tune Dataset Presets

First LLM Studio keeps two layers for beginner fine-tuning:

- Bundled bootstrap slices that validate and run immediately on a local machine.
- Upstream community datasets that users can inspect, sample, convert, and scale into larger runs.

## Default Beginner Path

| Preset                       | Local file                                          | Format              | Local rows | Suggested run                                                | Use when                                                                                                                           |
| ---------------------------- | --------------------------------------------------- | ------------------- | ---------: | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| First LLM Studio long-run 960 | `data/fine-tune/first-llm-studio-starter-960.jsonl` | `instruction-jsonl` |        960 | 4 epochs, batch 4, 10% validation, about 960 optimizer steps | A beginner wants a real 800-1,000 step local run without downloading or converting an external community dataset.                  |
| First LLM Studio starter 384 | `data/fine-tune/first-llm-studio-starter-384.jsonl` | `instruction-jsonl` |        384 | 12 epochs, batch 4, 10% validation, about 1k optimizer steps | A new user wants a quick local LoRA run that teaches compare, benchmark, runtime, retrieval, release, and adapter-support replies. |

In the admin UI, `Load preset` only fills the dataset and recipe forms. `Quick start` validates the bootstrap file, saves the dataset, and creates or updates a recommended recipe in one pass. Dataset and recipe saves are idempotent by source path / adapter identity, so repeated clicks update the same records instead of creating duplicates.

## Upstream Candidate Import Plan

The scheduled community search can surface Hugging Face, GitHub, and ModelScope candidates for a saved dataset. These candidates are intentionally not treated as ready-to-train files. Each candidate card now exposes a copyable import plan that records:

- source repository, docs, paper, upstream row count, and last updated time
- suggested local JSONL output path under `data/fine-tune/community/`
- required conversion target, either `instruction-jsonl` or `chat-jsonl`
- safety checklist for sampling, dedupe, license review, secret removal, and validation
- beginner-friendly run guidance for 128-512 row smoke tests and 1k-5k row longer local LoRA runs

This keeps the UI honest: bundled slices can train immediately, while newly discovered community sources must be sampled and converted before they become a saved dataset.

## Community Upgrade Sources

| Source                        | Upstream                                                                                                                                       | Local bootstrap                                                | Why it is included                                                                  | Notes                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Hugging Face                  | [`yahma/alpaca-cleaned`](https://huggingface.co/datasets/yahma/alpaca-cleaned)                                                                 | `data/fine-tune/community/alpaca-cleaned-sample.jsonl`         | Classic instruction/output schema for first external imports.                       | Good for general instruction-following baselines. Verify license and commercial terms before redistribution. |
| Hugging Face                  | [`BelleGroup/train_1M_CN`](https://huggingface.co/datasets/BelleGroup/train_1M_CN)                                                             | `data/fine-tune/community/belle-cn-sample.jsonl`               | Chinese instruction-following source for Chinese UI copy and beginner explanations. | Large source; sample and deduplicate before local training.                                                  |
| Hugging Face                  | [`HuggingFaceH4/ultrachat_200k`](https://huggingface.co/datasets/HuggingFaceH4/ultrachat_200k)                                                 | `data/fine-tune/community/ultrachat-200k-sample.jsonl`         | Multi-turn chat data for assistant tone and conversation quality.                   | Keep epochs low to avoid overfitting generic chat style.                                                     |
| Hugging Face                  | [`ise-uiuc/Magicoder-OSS-Instruct-75K`](https://huggingface.co/datasets/ise-uiuc/Magicoder-OSS-Instruct-75K)                                   | `data/fine-tune/community/magicoder-oss-instruct-sample.jsonl` | Code-focused instruction data for coding assistant adapters.                        | Best after the general starter path is stable.                                                               |
| Hugging Face                  | [`Salesforce/xlam-function-calling-60k`](https://huggingface.co/datasets/Salesforce/xlam-function-calling-60k)                                 | `data/fine-tune/community/xlam-function-calling-sample.jsonl`  | Tool-use and function-calling behavior for tool-first lanes.                        | Gated upstream dataset; convert to project schema and validate JSON fields before training.                  |
| ModelScope / GitHub discovery | [COIG project](https://github.com/BAAI-Zlab/COIG) and [ModelScope search](https://www.modelscope.cn/datasets?name=COIG%20instruction%20tuning) | `data/fine-tune/community/coig-cn-sample.jsonl`                | Chinese instruction discovery source for domestic mirrors and Chinese tasks.        | Treat it as a discovery preset first, then import a validated slice.                                         |

## Why Not Train Directly On The Full Datasets?

New users usually need a reliable first success more than a giant download. Full community datasets often require schema conversion, license review, deduplication, and quality filtering. The bundled bootstrap files are intentionally small enough to validate quickly, but large enough to avoid the previous 8-row smoke-only behavior.

For local Apple Silicon runs, start with the 960-row bundled long-run starter when the goal is a satisfying hundreds-to-1k-step run. Use the 160 to 384 row slices for quick smoke checks, then move to 1k to 5k sampled community rows only after compare and benchmark show the adapter is improving the intended behavior.
