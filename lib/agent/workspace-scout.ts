import { promises as fs } from "fs";
import { execFile as execFileCallback } from "child_process";
import path from "path";
import { promisify } from "util";

const execFile = promisify(execFileCallback);

const WORKSPACE_ROOT = process.cwd();
const SEARCH_ROOTS = ["app", "lib", "components", "scripts", "docs"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist"]);
const MAX_FILE_CANDIDATES = 10;
const MAX_CONTENT_MATCHES = 12;
const GENERIC_CONTENT_TOKENS = new Set(["benchmark", "agent", "chat", "runtime", "failed", "error", "fix"]);

type WorkspaceScoutCandidate = {
  path: string;
  score: number;
  reasons: string[];
  snippets: string[];
};

type WorkspaceScoutIntent = {
  queryTokens: string[];
  contentTokens: string[];
  prefersRoute: boolean;
  prefersStore: boolean;
  prefersDiff: boolean;
};

const KEYWORD_HINTS: Array<{ pattern: RegExp; tokens: string[] }> = [
  { pattern: /(benchmark|评测|评估|测试)/i, tokens: ["benchmark"] },
  { pattern: /(progress|进度)/i, tokens: ["progress"] },
  { pattern: /(route|路由)/i, tokens: ["route"] },
  { pattern: /(store|状态|缓存|记录)/i, tokens: ["store"] },
  { pattern: /(failed|error|错误|误报|假失败)/i, tokens: ["failed", "error"] },
  { pattern: /(patch|diff|变更|修改|修复点)/i, tokens: ["patch", "diff", "fix"] },
  { pattern: /(runtime|运行时|gateway|网关)/i, tokens: ["runtime", "gateway"] },
  { pattern: /(chat|对话|agent)/i, tokens: ["chat", "agent"] }
];

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function tokenizeLatin(text: string) {
  return text.toLowerCase().match(/[a-z0-9_/-]{3,}/g) || [];
}

function deriveIntent(input: string): WorkspaceScoutIntent {
  const baseTokens = tokenizeLatin(input).filter(
    (token) => !["which", "where", "what", "file", "files", "path", "repo", "repository"].includes(token)
  );
  const hintedTokens = KEYWORD_HINTS.flatMap((entry) => (entry.pattern.test(input) ? entry.tokens : []));
  const queryTokens = unique([...baseTokens, ...hintedTokens]).slice(0, 8);
  const contentTokens = unique(
    queryTokens
      .filter((token) => !["route", "store", "diff"].includes(token))
      .sort((left, right) => {
        const leftGeneric = GENERIC_CONTENT_TOKENS.has(left) ? 1 : 0;
        const rightGeneric = GENERIC_CONTENT_TOKENS.has(right) ? 1 : 0;
        if (leftGeneric !== rightGeneric) return leftGeneric - rightGeneric;
        return right.length - left.length;
      })
  ).slice(0, 6);
  return {
    queryTokens,
    contentTokens,
    prefersRoute: /(route|路由)/i.test(input),
    prefersStore: /(store|状态|缓存|记录)/i.test(input),
    prefersDiff: /(patch|diff|变更|修改|修复点)/i.test(input)
  };
}

export function shouldRunWorkspaceScout(input: string) {
  const normalized = input.trim();
  if (!normalized) return false;
  const repoSpecificPatterns = [
    /(仓库|repo|repository|代码|文件|目录|路由|route|store|修复点|patch|diff|实现|当前项目|当前仓库|哪个文件|哪条路由)/i,
    /(which file|which route|which store|file path|relative path|implemented where|where is the fix|what file)/i
  ];
  return repoSpecificPatterns.some((pattern) => pattern.test(normalized));
}

async function collectWorkspaceFiles() {
  const results: string[] = [];
  const queue = SEARCH_ROOTS.map((segment) => path.join(WORKSPACE_ROOT, segment));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const relativeCurrent = path.relative(WORKSPACE_ROOT, current);
    if (relativeCurrent && SKIP_DIRS.has(path.basename(relativeCurrent))) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      results.push(path.relative(WORKSPACE_ROOT, absolutePath));
    }
  }

  return results;
}

function scorePath(relativePath: string, intent: WorkspaceScoutIntent) {
  const normalizedPath = relativePath.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const token of intent.queryTokens) {
    if (normalizedPath.includes(token)) {
      score += token.length >= 6 ? 18 : 12;
      reasons.push(`路径命中 ${token}`);
    }
  }

  if (intent.prefersRoute && /\/route\.(t|j)sx?$/.test(normalizedPath)) {
    score += 16;
    reasons.push("符合 route 文件形态");
  }

  if (intent.prefersStore && /store|cache|state/.test(normalizedPath)) {
    score += 14;
    reasons.push("符合 store/state 文件形态");
  }

  if (intent.prefersDiff && /patch|diff|progress|fix|history/.test(normalizedPath)) {
    score += 10;
    reasons.push("看起来与修复/变更相关");
  }

  if (/^app\/api\//.test(normalizedPath)) {
    score += 4;
  }
  if (/^lib\/agent\//.test(normalizedPath)) {
    score += 4;
  }

  return { score, reasons: unique(reasons) };
}

async function searchContentMatches(intent: WorkspaceScoutIntent) {
  if (!intent.contentTokens.length) return [] as Array<{ path: string; line: number; text: string; token: string }>;
  const matches: Array<{ path: string; line: number; text: string; token: string }> = [];

  for (const token of intent.contentTokens) {
    try {
      const { stdout } = await execFile(
        "rg",
        [
          "-n",
          "-S",
          "--max-count",
          "3",
          "--glob",
          "!node_modules/**",
          "--glob",
          "!.next/**",
          "--glob",
          "!.git/**",
          token,
          ...SEARCH_ROOTS
        ],
        { cwd: WORKSPACE_ROOT, maxBuffer: 1024 * 1024 }
      );

      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!match) continue;
        matches.push({
          path: match[1],
          line: Number(match[2]),
          text: match[3].trim(),
          token
        });
        if (matches.length >= MAX_CONTENT_MATCHES) {
          return matches;
        }
      }
    } catch {
      continue;
    }
  }

  return matches;
}

async function extractCandidateClues(relativePath: string, intent: WorkspaceScoutIntent) {
  const absolutePath = path.join(WORKSPACE_ROOT, relativePath);
  const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
  if (!content.trim()) return [] as string[];

  const prioritizedTokens = unique([
    ...intent.contentTokens,
    ...(intent.prefersRoute ? ["export", "request", "response", "progress"] : []),
    ...(intent.prefersStore ? ["status", "error", "record", "progress"] : [])
  ]);

  const clues: string[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const lower = line.toLowerCase();
    if (!prioritizedTokens.some((token) => lower.includes(token.toLowerCase()))) continue;
    clues.push(`L${index + 1}: ${line}`.slice(0, 180));
    if (clues.length >= 2) break;
  }

  return unique(clues);
}

export async function buildWorkspaceScoutEvidence(input: string) {
  if (!shouldRunWorkspaceScout(input)) return "";

  const intent = deriveIntent(input);
  const files = await collectWorkspaceFiles();
  const contentMatches = await searchContentMatches(intent);
  const candidateMap = new Map<string, WorkspaceScoutCandidate>();

  for (const relativePath of files) {
    const { score, reasons } = scorePath(relativePath, intent);
    if (score <= 0) continue;
    candidateMap.set(relativePath, {
      path: relativePath,
      score,
      reasons,
      snippets: []
    });
  }

  for (const match of contentMatches) {
    const existing = candidateMap.get(match.path) || {
      path: match.path,
      score: 0,
      reasons: [],
      snippets: []
    };
    existing.score += match.token.length >= 6 ? 16 : 10;
    existing.reasons = unique([...existing.reasons, `内容命中 ${match.token}`]);
    existing.snippets = unique([
      ...existing.snippets,
      `L${match.line}: ${match.text}`.slice(0, 180)
    ]).slice(0, 2);
    candidateMap.set(match.path, existing);
  }

  const topCandidates = Array.from(candidateMap.values())
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_FILE_CANDIDATES);

  for (const candidate of topCandidates) {
    if (candidate.snippets.length >= 2) continue;
    const fileClues = await extractCandidateClues(candidate.path, intent);
    candidate.snippets = unique([...candidate.snippets, ...fileClues]).slice(0, 2);
  }

  if (!topCandidates.length) {
    return [
      "Workspace scout:",
      "- 没找到可靠候选文件。遇到这类问题时，先用 list_files 和 read_file 确认真实路径，再下结论。"
    ].join("\n");
  }

  const lines = [
    "Workspace scout (server-side path hints; still confirm with tools before claiming a file changed something):"
  ];

  topCandidates.forEach((candidate, index) => {
    const reasonText = candidate.reasons.slice(0, 3).join("、") || "路径相关";
    lines.push(`${index + 1}. ${candidate.path} — ${reasonText}`);
    if (candidate.snippets.length) {
      lines.push("   代码线索:");
      candidate.snippets.forEach((snippet) => {
        lines.push(`   - ${snippet}`);
      });
    }
  });

  lines.push(
    "",
    "Answer style for repo questions:",
    "- Do not only name a path. After each file you name, add 1-2 short code-evidence bullets taken from confirmed clues in this turn.",
    "- Prefer evidence such as function names, status transitions, guard conditions, or route behavior over generic summaries.",
    "- Keep evidence short and concrete."
  );

  return lines.join("\n");
}
