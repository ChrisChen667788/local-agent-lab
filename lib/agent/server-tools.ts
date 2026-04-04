import { promises as fs } from "fs";
import { exec as execCallback } from "child_process";
import { createHash, randomUUID } from "crypto";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { AgentToolRun } from "@/lib/agent/types";

const exec = promisify(execCallback);

const WORKSPACE_ROOT = process.cwd();
const MAX_LINE_WINDOW = 240;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_COMMAND_OUTPUT_CHARS = 16_000;
const MAX_DIFF_PREVIEW_CHARS = 8_000;
const MAX_CONTENT_PREVIEW_CHARS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const PROTECTED_SOURCE_PREFIXES = ["app/", "lib/", "components/"];
const NEVER_ALLOW_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  /\bfind\b.*\s-delete\b/i,
  /\bfind\b.*\s-exec\b.*\b(?:rm|mv|chmod|chown)\b/i
];
const PRIVILEGED_COMMAND_PATTERNS = [
  /\bsudo\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdiskutil\s+erase/i,
  /\blaunchctl\b/i,
  /\bchown\b/i,
  /\bchmod\b/i,
  /\bcurl\b.*\|\s*(?:bash|sh|zsh)\b/i,
  /^(?:brew)\s+(?:install|upgrade|uninstall)\b/i,
  /^(?:pip|pip3)\s+install\b/i,
  /^python3?\s+-m\s+pip\s+install\b/i,
  /^uv\s+pip\s+install\b/i,
  /\bmv\s+.+\s+\/[^\s]+/i,
  /\bcp\s+.+\s+\/[^\s]+/i
];
const READ_ONLY_COMMAND_PATTERNS = [
  /^pwd$/i,
  /^ls(?:\s|$)/i,
  /^find(?:\s|$)/i,
  /^rg(?:\s|$)/i,
  /^(?:cat|sed|head|tail|wc|stat|file|which)(?:\s|$)/i,
  /^git\s+(?:status|diff|show|log|branch|rev-parse)(?:\s|$)/i,
  /^python3?\s+-m\s+json\.tool(?:\s|$)/i
];
const BUILD_COMMAND_PATTERNS = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|build|typecheck|check)(?:\s|$)/i,
  /^npx\s+(?:tsc|eslint|vitest|jest)(?:\s|$)/i,
  /^(?:tsc|eslint|vitest|jest|pytest)(?:\s|$)/i,
  /^python3?\s+-m\s+pytest(?:\s|$)/i,
  /^uv\s+run\s+pytest(?:\s|$)/i,
  /^(?:go\s+test|cargo\s+test|next\s+lint)(?:\s|$)/i
];
const FORMATTER_COMMAND_PATTERNS = [
  /^npx\s+prettier\s+.+\s--write(?:\s|$)/i,
  /^(?:prettier)\s+.+\s--write(?:\s|$)/i,
  /^npx\s+eslint\s+.+\s--fix(?:\s|$)/i,
  /^(?:eslint)\s+.+\s--fix(?:\s|$)/i,
  /^(?:ruff)\s+(?:check\s+.+\s--fix|format)(?:\s|$)/i,
  /^(?:black|gofmt|cargo\s+fmt|go\s+fmt|swiftformat)(?:\s|$)/i
];
const PATCHER_COMMAND_PATTERNS = [/^git\s+apply(?:\s|$)/i, /^patch(?:\s|$)/i];
const PACKAGE_MANAGER_COMMAND_PATTERNS = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|upgrade|up|dlx|create)\b/i,
  /^npx\s+(?:npm|pnpm|yarn|bun)\b/i,
  /^(?:cargo)\s+(?:add|remove)\b/i,
  /^(?:go)\s+get\b/i,
  /^(?:uv)\s+(?:add|remove|sync)\b/i
];
const MISC_WRITE_COMMAND_PATTERNS = [
  /^mkdir(?:\s|$)/i,
  /^touch(?:\s|$)/i,
  /^(?:sed|perl)\s+-i(?:\s|$)/i
];

type CommandPolicy = {
  level: "read" | "build" | "formatter" | "patcher" | "package-manager" | "misc-write" | "privileged";
  allowed: boolean;
  requiresConfirmation?: boolean;
  reason: string;
};

type FileSnapshot = {
  exists: boolean;
  hash: string | null;
  preview: string;
};

type ToolConfirmation = {
  token: string;
  toolName: "execute_command" | "write_file" | "apply_patch";
  payloadHash: string;
  protectedPaths: string[];
  expiresAt: number;
};

type PatchHunk = {
  oldLines: string[];
  newLines: string[];
};

type RepairPlan = {
  patchText: string;
  replacements: Array<{
    path: string;
    content: string;
  }>;
};

const pendingConfirmations = new Map<string, ToolConfirmation>();

function truncateOutput(value: string, maxChars = MAX_COMMAND_OUTPUT_CHARS) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function previewContent(value: string) {
  return truncateOutput(value, MAX_CONTENT_PREVIEW_CHARS);
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableHash(value: Record<string, unknown>) {
  return sha256Text(JSON.stringify(value));
}

function safeResolve(inputPath = ".") {
  const resolved = path.resolve(WORKSPACE_ROOT, inputPath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error("Path escapes the current workspace.");
  }
  return resolved;
}

function normalizePatchPath(rawPath: string, stripCount: number) {
  if (!rawPath || rawPath === "/dev/null") return null;

  const segments = rawPath.trim().split("/").filter(Boolean);
  const stripped = stripCount > 0 ? segments.slice(stripCount) : segments;
  const finalPath = stripped.join("/");
  if (!finalPath) return null;
  safeResolve(finalPath);
  return finalPath;
}

function extractPatchPaths(patchText: string, stripCount: number) {
  const candidatePaths = patchText
    .split("\n")
    .filter((line) => line.startsWith("--- ") || line.startsWith("+++ "))
    .map((line) => line.slice(4).trim().split("\t")[0])
    .filter((value) => value && value !== "/dev/null")
    .map((value) => normalizePatchPath(value, stripCount))
    .filter((value): value is string => Boolean(value));

  return [...new Set(candidatePaths)];
}

function validatePatchPaths(patchText: string, stripCount: number) {
  for (const candidatePath of extractPatchPaths(patchText, stripCount)) {
    normalizePatchPath(candidatePath, stripCount);
  }
}

function isProtectedSourcePath(relativePath: string) {
  return PROTECTED_SOURCE_PREFIXES.some(
    (prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix)
  );
}

function getProtectedPaths(relativePaths: string[]) {
  return [...new Set(relativePaths.filter((relativePath) => isProtectedSourcePath(relativePath)))];
}

function cleanupExpiredConfirmations() {
  const now = Date.now();
  for (const [token, confirmation] of pendingConfirmations.entries()) {
    if (confirmation.expiresAt <= now) {
      pendingConfirmations.delete(token);
    }
  }
}

function issueConfirmation(
  toolName: "execute_command" | "write_file" | "apply_patch",
  payloadHash: string,
  protectedPaths: string[]
) {
  cleanupExpiredConfirmations();
  const confirmation: ToolConfirmation = {
    token: randomUUID(),
    toolName,
    payloadHash,
    protectedPaths,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS
  };
  pendingConfirmations.set(confirmation.token, confirmation);
  return confirmation;
}

function consumeConfirmation(
  token: string | undefined,
  toolName: "execute_command" | "write_file" | "apply_patch",
  payloadHash: string,
  protectedPaths: string[]
) {
  cleanupExpiredConfirmations();
  if (!token) return false;

  const confirmation = pendingConfirmations.get(token);
  if (!confirmation) {
    throw new Error("Invalid or expired confirmation token.");
  }

  const sameProtectedPaths =
    confirmation.protectedPaths.length === protectedPaths.length &&
    confirmation.protectedPaths.every((value, index) => value === protectedPaths[index]);

  if (
    confirmation.toolName !== toolName ||
    confirmation.payloadHash !== payloadHash ||
    !sameProtectedPaths
  ) {
    throw new Error("Confirmation token does not match the pending protected change.");
  }

  pendingConfirmations.delete(token);
  return true;
}

export function cancelWorkspaceConfirmation(token: string) {
  cleanupExpiredConfirmations();
  return pendingConfirmations.delete(token);
}

function classifyCommand(command: string): CommandPolicy {
  for (const pattern of NEVER_ALLOW_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "privileged",
        allowed: false,
        reason: "Matches a destructive command pattern that is never allowed through execute_command."
      };
    }
  }

  for (const pattern of PRIVILEGED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "privileged",
        allowed: false,
        reason:
          "Command requires privileged or environment-changing access. Run it outside the agent tool flow."
      };
    }
  }

  for (const pattern of READ_ONLY_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "read",
        allowed: true,
        reason: "Read-only inspection command allowed by the workspace policy."
      };
    }
  }

  for (const pattern of BUILD_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "build",
        allowed: true,
        reason: "Build or test command allowed by the workspace policy."
      };
    }
  }

  for (const pattern of FORMATTER_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "formatter",
        allowed: true,
        requiresConfirmation: true,
        reason: "Formatter command will modify workspace files and requires explicit confirmation."
      };
    }
  }

  for (const pattern of PATCHER_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "patcher",
        allowed: true,
        requiresConfirmation: true,
        reason: "Patch command requires explicit confirmation before mutating workspace files."
      };
    }
  }

  for (const pattern of PACKAGE_MANAGER_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "package-manager",
        allowed: true,
        requiresConfirmation: true,
        reason: "Package manager command requires explicit confirmation before changing dependencies or lockfiles."
      };
    }
  }

  for (const pattern of MISC_WRITE_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return {
        level: "misc-write",
        allowed: true,
        requiresConfirmation: true,
        reason: "Workspace-writing command requires explicit confirmation before execution."
      };
    }
  }

  return {
    level: "privileged",
    allowed: false,
    reason:
      "Command is outside the read/build/formatter/patcher/package-manager/misc-write allowlist. Use write_file or apply_patch for file changes."
  };
}

async function buildUnifiedDiffPreview(before: string, after: string, label: string) {
  const beforePath = path.join(os.tmpdir(), `agent-before-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const afterPath = path.join(os.tmpdir(), `agent-after-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  await fs.writeFile(beforePath, before, "utf8");
  await fs.writeFile(afterPath, after, "utf8");

  try {
    const command = `diff -u -L ${JSON.stringify(`a/${label}`)} -L ${JSON.stringify(`b/${label}`)} ${JSON.stringify(beforePath)} ${JSON.stringify(afterPath)}`;
    try {
      const { stdout } = await exec(command, {
        shell: "/bin/zsh",
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024
      });
      return truncateOutput(stdout || `No diff for ${label}.`, MAX_DIFF_PREVIEW_CHARS);
    } catch (error) {
      const execError = error as { code?: number | string; stdout?: string };
      if (execError.code === 1 && execError.stdout) {
        return truncateOutput(execError.stdout, MAX_DIFF_PREVIEW_CHARS);
      }
      return `diff preview unavailable for ${label}: ${error instanceof Error ? error.message : String(error)}`;
    }
  } finally {
    await Promise.all([fs.unlink(beforePath).catch(() => undefined), fs.unlink(afterPath).catch(() => undefined)]);
  }
}

async function readSnapshot(relativePath: string): Promise<FileSnapshot> {
  const absolutePath = safeResolve(relativePath);
  const exists = await fs
    .access(absolutePath)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    return {
      exists: false,
      hash: null,
      preview: ""
    };
  }

  const content = await fs.readFile(absolutePath, "utf8");
  return {
    exists: true,
    hash: sha256Text(content),
    preview: previewContent(content)
  };
}

async function runPatchCommand(patchText: string, stripCount: number, dryRun: boolean) {
  const tempPatchPath = path.join(os.tmpdir(), `agent-patch-${Date.now()}.diff`);
  await fs.writeFile(tempPatchPath, patchText, "utf8");

  try {
    const command = `patch -p${stripCount} --batch --forward ${dryRun ? "--dry-run " : ""}-i ${JSON.stringify(tempPatchPath)}`;
    try {
      const result = await exec(command, {
        cwd: WORKSPACE_ROOT,
        shell: "/bin/zsh",
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024
      });
      return {
        ok: true,
        exitCode: 0,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr)
      };
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; code?: number | string };
      return {
        ok: false,
        exitCode: typeof execError.code === "number" ? execError.code : null,
        stdout: truncateOutput(execError.stdout || ""),
        stderr: truncateOutput(execError.stderr || ""),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  } finally {
    await fs.unlink(tempPatchPath).catch(() => undefined);
  }
}

function parseUnifiedPatchByFile(patchText: string, stripCount: number) {
  const lines = patchText.split("\n");
  const fileMap = new Map<string, PatchHunk[]>();
  let currentFile: string | null = null;
  let currentHunk: PatchHunk | null = null;

  const flushHunk = () => {
    if (!currentFile || !currentHunk) return;
    const existing = fileMap.get(currentFile) || [];
    existing.push(currentHunk);
    fileMap.set(currentFile, existing);
    currentHunk = null;
  };

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      flushHunk();
      currentFile = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      const rawPath = line.slice(4).trim().split("\t")[0];
      currentFile = normalizePatchPath(rawPath, stripCount);
      continue;
    }

    if (line.startsWith("@@")) {
      flushHunk();
      if (!currentFile) continue;
      currentHunk = { oldLines: [], newLines: [] };
      continue;
    }

    if (!currentHunk) continue;
    if (line.startsWith("\\ No newline")) continue;

    const marker = line[0];
    const value = line.slice(1);
    if (marker === " " || marker === "-") currentHunk.oldLines.push(value);
    if (marker === " " || marker === "+") currentHunk.newLines.push(value);
  }

  flushHunk();
  return fileMap;
}

function replaceOnce(source: string, target: string, replacement: string) {
  if (!target) return null;
  const firstIndex = source.indexOf(target);
  if (firstIndex === -1) return null;
  const secondIndex = source.indexOf(target, firstIndex + target.length);
  if (secondIndex !== -1) return null;
  return `${source.slice(0, firstIndex)}${replacement}${source.slice(firstIndex + target.length)}`;
}

function applyRepairHunks(currentContent: string, hunks: PatchHunk[]) {
  let workingContent = currentContent;

  for (const hunk of hunks) {
    const oldText = hunk.oldLines.join("\n");
    const newText = hunk.newLines.join("\n");
    const candidates: Array<[string, string]> = [
      [oldText, newText],
      [oldText.replace(/\n$/, ""), newText.replace(/\n$/, "")],
      [oldText ? `${oldText}\n` : oldText, newText ? `${newText}\n` : newText]
    ];

    let nextContent: string | null = null;
    for (const [candidateOld, candidateNew] of candidates) {
      nextContent = replaceOnce(workingContent, candidateOld, candidateNew);
      if (typeof nextContent === "string") break;
    }

    if (typeof nextContent !== "string") {
      return null;
    }

    workingContent = nextContent;
  }

  return workingContent;
}

async function buildRepairPlan(patchText: string, stripCount: number): Promise<RepairPlan | null> {
  const patchByFile = parseUnifiedPatchByFile(patchText, stripCount);
  if (!patchByFile.size) return null;

  const repairedDiffs: string[] = [];
  const replacements: Array<{ path: string; content: string }> = [];
  for (const [relativePath, hunks] of patchByFile.entries()) {
    const absolutePath = safeResolve(relativePath);
    const exists = await fs
      .access(absolutePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return null;

    const currentContent = await fs.readFile(absolutePath, "utf8");
    const repairedContent = applyRepairHunks(currentContent, hunks);
    if (typeof repairedContent !== "string" || repairedContent === currentContent) {
      return null;
    }

    repairedDiffs.push(await buildUnifiedDiffPreview(currentContent, repairedContent, relativePath));
    replacements.push({ path: relativePath, content: repairedContent });
  }

  return {
    patchText: repairedDiffs.join("\n"),
    replacements
  };
}

async function collectRejectArtifacts(affectedFiles: string[]) {
  const artifacts = await Promise.all(
    affectedFiles.map(async (relativePath) => {
      const rejectPath = `${relativePath}.rej`;
      const absoluteRejectPath = safeResolve(rejectPath);
      const exists = await fs
        .access(absoluteRejectPath)
        .then(() => true)
        .catch(() => false);

      if (!exists) return null;

      const content = await fs.readFile(absoluteRejectPath, "utf8");
      return {
        path: relativePath,
        rejectPath,
        rejectPreview: previewContent(content)
      };
    })
  );

  return artifacts.filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact));
}

async function clearRejectArtifacts(artifacts: Array<{ rejectPath: string }>) {
  await Promise.all(
    artifacts.map((artifact) => fs.unlink(safeResolve(artifact.rejectPath)).catch(() => undefined))
  );
}

async function walkFiles(rootDir: string, limit: number) {
  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0 && files.length < limit) {
    const currentDir = queue.shift();
    if (!currentDir) break;

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".next") || entry.name === "node_modules" || entry.name.startsWith(".git")) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      files.push(path.relative(WORKSPACE_ROOT, absolutePath));
      if (files.length >= limit) break;
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function runListFiles(input: Record<string, unknown>) {
  const relativePath = typeof input.path === "string" && input.path.trim() ? input.path.trim() : ".";
  const limit = Math.min(
    200,
    Math.max(1, typeof input.limit === "number" ? Math.trunc(input.limit) : 80)
  );
  const absoluteDir = safeResolve(relativePath);
  const files = await walkFiles(absoluteDir, limit);
  return JSON.stringify(
    {
      status: "ok",
      path: relativePath,
      limit,
      files
    },
    null,
    2
  );
}

async function runReadFile(input: Record<string, unknown>) {
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new Error("read_file requires a relative file path.");
  }

  const absolutePath = safeResolve(input.path.trim());
  const raw = (await fs.readFile(absolutePath, "utf8")).slice(0, MAX_FILE_BYTES);
  const lines = raw.split("\n");
  const requestedStart = typeof input.startLine === "number" ? Math.max(1, Math.trunc(input.startLine)) : 1;
  const requestedEnd =
    typeof input.endLine === "number"
      ? Math.max(requestedStart, Math.trunc(input.endLine))
      : requestedStart + MAX_LINE_WINDOW - 1;
  const endLine = Math.min(requestedEnd, requestedStart + MAX_LINE_WINDOW - 1, lines.length);
  const slice = lines.slice(requestedStart - 1, endLine).join("\n");

  return JSON.stringify(
    {
      status: "ok",
      path: input.path,
      startLine: requestedStart,
      endLine,
      content: slice
    },
    null,
    2
  );
}

async function runExecuteCommand(input: Record<string, unknown>) {
  if (typeof input.command !== "string" || !input.command.trim()) {
    throw new Error("execute_command requires a non-empty command string.");
  }

  const command = input.command.trim();
  const policy = classifyCommand(command);
  const relativeCwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : ".";
  const cwd = safeResolve(relativeCwd);
  const timeoutMs = Math.min(
    MAX_COMMAND_TIMEOUT_MS,
    Math.max(
      1000,
      typeof input.timeoutMs === "number" ? Math.trunc(input.timeoutMs) : DEFAULT_COMMAND_TIMEOUT_MS
    )
  );
  const payloadHash = stableHash({ command, cwd: relativeCwd, timeoutMs });

  if (policy.requiresConfirmation) {
    const confirmationToken = typeof input.confirmationToken === "string" ? input.confirmationToken : undefined;
    const confirmed = consumeConfirmation(confirmationToken, "execute_command", payloadHash, []);
    if (!confirmed) {
      const confirmation = issueConfirmation("execute_command", payloadHash, []);
      return JSON.stringify(
        {
          status: "confirmation_required",
          command,
          cwd: path.relative(WORKSPACE_ROOT, cwd) || ".",
          policyLevel: policy.level,
          policyReason: policy.reason,
          confirmationToken: confirmation.token,
          expiresAt: confirmation.expiresAt,
          message:
            "Workspace-changing commands require an explicit approval before execution. Approve this step only if the command should mutate workspace files."
        },
        null,
        2
      );
    }
  }

  if (!policy.allowed) {
    return JSON.stringify(
      {
        status: "blocked",
        command,
        cwd: path.relative(WORKSPACE_ROOT, cwd) || ".",
        policyLevel: policy.level,
        policyReason: policy.reason
      },
      null,
      2
    );
  }

  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await exec(command, {
      cwd,
      shell: "/bin/zsh",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024
    });

    return JSON.stringify(
      {
        status: "ok",
        command,
        cwd: path.relative(WORKSPACE_ROOT, cwd) || ".",
        policyLevel: policy.level,
        policyReason: policy.reason,
        exitCode: 0,
        durationMs: Date.now() - startedAt,
        confirmationUsed: Boolean(policy.requiresConfirmation),
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr)
      },
      null,
      2
    );
  } catch (error) {
    const execError = error as { code?: number | string; stdout?: string; stderr?: string; signal?: string };
    return JSON.stringify(
      {
        status: "error",
        command,
        cwd: path.relative(WORKSPACE_ROOT, cwd) || ".",
        policyLevel: policy.level,
        policyReason: policy.reason,
        exitCode: typeof execError.code === "number" ? execError.code : null,
        signal: execError.signal || null,
        durationMs: Date.now() - startedAt,
        confirmationUsed: Boolean(policy.requiresConfirmation),
        stdout: truncateOutput(execError.stdout || ""),
        stderr: truncateOutput(execError.stderr || ""),
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    );
  }
}

async function runWriteFile(input: Record<string, unknown>) {
  if (typeof input.path !== "string" || !input.path.trim()) {
    throw new Error("write_file requires a relative file path.");
  }

  if (typeof input.content !== "string") {
    throw new Error("write_file requires string content.");
  }

  const relativePath = input.path.trim();
  const absolutePath = safeResolve(relativePath);
  const mode = input.mode === "append" || input.mode === "error_if_exists" ? input.mode : "overwrite";
  const createDirectories = input.createDirectories !== false;
  const protectedPaths = getProtectedPaths([relativePath]);
  const payloadHash = stableHash({ path: relativePath, content: input.content, mode });
  const beforeSnapshot = await readSnapshot(relativePath);
  const beforeContent = beforeSnapshot.exists ? await fs.readFile(absolutePath, "utf8") : "";
  const plannedAfterContent = mode === "append" ? `${beforeContent}${input.content}` : input.content;
  const diffPreview = await buildUnifiedDiffPreview(beforeContent, plannedAfterContent, relativePath);

  if (protectedPaths.length > 0) {
    const confirmationToken = typeof input.confirmationToken === "string" ? input.confirmationToken : undefined;
    const confirmed = consumeConfirmation(confirmationToken, "write_file", payloadHash, protectedPaths);
    if (!confirmed) {
      const confirmation = issueConfirmation("write_file", payloadHash, protectedPaths);
      return JSON.stringify(
        {
          status: "confirmation_required",
          path: relativePath,
          mode,
          protectedPaths,
          confirmationToken: confirmation.token,
          expiresAt: confirmation.expiresAt,
          diffPreview,
          contentPreview: previewContent(plannedAfterContent),
          message:
            "Protected source paths require a second confirmed write. Call write_file again with the returned confirmationToken if you want to apply this change."
        },
        null,
        2
      );
    }
  }

  if (createDirectories) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  }

  if (beforeSnapshot.exists && mode === "error_if_exists") {
    throw new Error(`Refusing to overwrite existing file: ${relativePath}`);
  }

  if (mode === "append") {
    await fs.appendFile(absolutePath, input.content, "utf8");
  } else {
    await fs.writeFile(absolutePath, input.content, "utf8");
  }

  const afterContent = await fs.readFile(absolutePath, "utf8");
  const afterSnapshot = await readSnapshot(relativePath);
  const verified = mode === "append" ? afterContent.endsWith(input.content) : afterContent === input.content;

  return JSON.stringify(
    {
      status: "written",
      path: relativePath,
      mode,
      fileExisted: beforeSnapshot.exists,
      bytesWritten: Buffer.byteLength(input.content, "utf8"),
      beforeHash: beforeSnapshot.hash,
      afterHash: afterSnapshot.hash,
      verified,
      diffPreview,
      contentPreview: afterSnapshot.preview,
      confirmationUsed: protectedPaths.length > 0
    },
    null,
    2
  );
}

async function runApplyPatch(input: Record<string, unknown>) {
  if (typeof input.patch !== "string" || !input.patch.trim()) {
    throw new Error("apply_patch requires unified diff text.");
  }

  const patchText = input.patch;
  const stripCount = Math.min(3, Math.max(0, typeof input.stripCount === "number" ? Math.trunc(input.stripCount) : 1));
  const dryRun = input.dryRun === true;
  const attemptAutoRepair = input.attemptAutoRepair !== false;
  validatePatchPaths(patchText, stripCount);
  const affectedFiles = extractPatchPaths(patchText, stripCount);
  const protectedPaths = getProtectedPaths(affectedFiles);
  const payloadHash = stableHash({ patch: patchText, stripCount });
  const diffPreview = truncateOutput(patchText, MAX_DIFF_PREVIEW_CHARS);

  if (!dryRun && protectedPaths.length > 0) {
    const previewRun = await runPatchCommand(patchText, stripCount, true);
    const confirmationToken = typeof input.confirmationToken === "string" ? input.confirmationToken : undefined;
    const confirmed = consumeConfirmation(confirmationToken, "apply_patch", payloadHash, protectedPaths);
    if (!confirmed) {
      const confirmation = issueConfirmation("apply_patch", payloadHash, protectedPaths);
      return JSON.stringify(
        {
          status: "confirmation_required",
          dryRunStatus: previewRun.ok ? "dry_run_ok" : "dry_run_failed",
          stripCount,
          protectedPaths,
          affectedFiles,
          confirmationToken: confirmation.token,
          expiresAt: confirmation.expiresAt,
          diffPreview,
          stdout: previewRun.stdout,
          stderr: previewRun.stderr,
          exitCode: previewRun.exitCode,
          error: previewRun.error,
          message:
            "Protected source paths require a second confirmed patch. Call apply_patch again with the returned confirmationToken if you want to apply this change."
        },
        null,
        2
      );
    }
  }

  const beforeSnapshots = await Promise.all(
    affectedFiles.map(async (relativePath) => ({
      path: relativePath,
      snapshot: await readSnapshot(relativePath)
    }))
  );

  const firstRun = await runPatchCommand(patchText, stripCount, dryRun);
  const afterSnapshots = await Promise.all(
    affectedFiles.map(async (relativePath) => ({
      path: relativePath,
      snapshot: await readSnapshot(relativePath)
    }))
  );

  if (firstRun.ok) {
    return JSON.stringify(
      {
        status: dryRun ? "dry_run_ok" : "patched",
        dryRun,
        stripCount,
        affectedFiles,
        exitCode: firstRun.exitCode,
        diffPreview,
        stdout: firstRun.stdout,
        stderr: firstRun.stderr,
        verification: afterSnapshots.map((entry) => {
          const beforeSnapshot = beforeSnapshots.find((before) => before.path === entry.path)?.snapshot;
          return {
            path: entry.path,
            existedBefore: beforeSnapshot?.exists || false,
            existsAfter: entry.snapshot.exists,
            beforeHash: beforeSnapshot?.hash || null,
            afterHash: entry.snapshot.hash,
            changed: beforeSnapshot?.hash !== entry.snapshot.hash,
            contentPreview: entry.snapshot.preview
          };
        }),
        confirmationUsed: protectedPaths.length > 0 && !dryRun
      },
      null,
      2
    );
  }

  const rejectArtifacts = await collectRejectArtifacts(affectedFiles);
  const repairPlan = !dryRun && attemptAutoRepair ? await buildRepairPlan(patchText, stripCount) : null;

  if (repairPlan) {
    for (const replacement of repairPlan.replacements) {
      await fs.writeFile(safeResolve(replacement.path), replacement.content, "utf8");
    }
    const repairedSnapshots = await Promise.all(
      affectedFiles.map(async (relativePath) => ({
        path: relativePath,
        snapshot: await readSnapshot(relativePath)
      }))
    );

    return JSON.stringify(
      {
        status: "patched_after_repair",
        dryRun,
        stripCount,
        affectedFiles,
        exitCode: 0,
        diffPreview,
        repairPatch: repairPlan.patchText,
        stdout: "Repair patch synthesized and applied via direct file rewrite.\n",
        stderr: "",
        initialFailure: {
          exitCode: firstRun.exitCode,
          stdout: firstRun.stdout,
          stderr: firstRun.stderr,
          error: firstRun.error,
          rejectArtifacts
        },
        verification: repairedSnapshots.map((entry) => {
          const beforeSnapshot = beforeSnapshots.find((before) => before.path === entry.path)?.snapshot;
          return {
            path: entry.path,
            existedBefore: beforeSnapshot?.exists || false,
            existsAfter: entry.snapshot.exists,
            beforeHash: beforeSnapshot?.hash || null,
            afterHash: entry.snapshot.hash,
            changed: beforeSnapshot?.hash !== entry.snapshot.hash,
            contentPreview: entry.snapshot.preview
          };
        }),
        repairMethod: "direct_write"
      },
      null,
      2
    );
  }

  return JSON.stringify(
    {
      status: dryRun ? "dry_run_failed" : "patch_failed",
      dryRun,
      stripCount,
      affectedFiles,
      exitCode: firstRun.exitCode,
      diffPreview,
      stdout: firstRun.stdout,
      stderr: firstRun.stderr,
      error: firstRun.error,
      rejectArtifacts
    },
    null,
    2
  );
}

export async function runWorkspaceTool(name: string, input: Record<string, unknown>): Promise<AgentToolRun> {
  try {
    if (name === "list_files") {
      return {
        name,
        input,
        output: await runListFiles(input)
      };
    }

    if (name === "read_file") {
      return {
        name,
        input,
        output: await runReadFile(input)
      };
    }

    if (name === "execute_command") {
      return {
        name,
        input,
        output: await runExecuteCommand(input)
      };
    }

    if (name === "write_file") {
      return {
        name,
        input,
        output: await runWriteFile(input)
      };
    }

    if (name === "apply_patch") {
      return {
        name,
        input,
        output: await runApplyPatch(input)
      };
    }

    return {
      name,
      input,
      output: JSON.stringify(
        {
          status: "error",
          error: `Unsupported tool: ${name}`
        },
        null,
        2
      )
    };
  } catch (error) {
    return {
      name,
      input,
      output: JSON.stringify(
        {
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    };
  }
}
