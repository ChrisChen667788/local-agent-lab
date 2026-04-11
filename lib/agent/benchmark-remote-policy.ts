import type { AgentProviderProfile, AgentThinkingMode, ResolvedTarget } from "./types";

export type RemoteBenchmarkProviderKind =
  | "openai-compatible"
  | "claude-compatible"
  | "deepseek-compatible"
  | "moonshot-compatible"
  | "zhipu-compatible"
  | "dashscope-compatible";

export type RemoteBenchmarkPolicy = {
  totalTimeoutMs: number;
  firstTokenTimeoutMs: number;
  retryBudgetMs: number;
  streamIdleTimeoutMs: number;
};

type RemoteBenchmarkPolicyInput = {
  workloadId: string;
  providerProfile: AgentProviderProfile;
  thinkingMode: AgentThinkingMode;
  providerKind: RemoteBenchmarkProviderKind;
};

const REMOTE_BENCHMARK_TIMEOUT_MS = 120000;
const REMOTE_BENCHMARK_FIRST_TOKEN_TIMEOUT_MS = 20000;

const LONG_CONTEXT_WORKLOADS = new Set([
  "grounded-kb-qa",
  "code-rag-repo-qa",
  "agent-flow-lite",
  "longbench-starter"
]);

const CODE_GENERATION_WORKLOADS = new Set(["humaneval-starter", "mbppplus-starter"]);
const INSTRUCTION_STYLE_WORKLOADS = new Set(["instruction-following-lite", "ifeval-starter"]);

export function getRemoteBenchmarkProviderKind(target: ResolvedTarget): RemoteBenchmarkProviderKind {
  const baseUrl = target.resolvedBaseUrl.toLowerCase();
  const model = target.resolvedModel.toLowerCase();
  if (target.id === "anthropic-claude" || /claude/i.test(target.resolvedModel)) {
    return "claude-compatible";
  }
  if (target.id === "deepseek-api" || /deepseek/i.test(target.resolvedModel)) {
    return "deepseek-compatible";
  }
  if (target.id === "kimi-api" || baseUrl.includes("moonshot.cn") || model.includes("kimi")) {
    return "moonshot-compatible";
  }
  if (target.id === "glm-api" || baseUrl.includes("bigmodel.cn") || model.includes("glm")) {
    return "zhipu-compatible";
  }
  if (target.id === "qwen-api" || baseUrl.includes("dashscope.aliyuncs.com") || model.includes("qwen")) {
    return "dashscope-compatible";
  }
  return "openai-compatible";
}

function isLongContextWorkload(workloadId: string) {
  return LONG_CONTEXT_WORKLOADS.has(workloadId);
}

function isCodeGenerationWorkload(workloadId: string) {
  return CODE_GENERATION_WORKLOADS.has(workloadId);
}

function isInstructionStyleWorkload(workloadId: string) {
  return INSTRUCTION_STYLE_WORKLOADS.has(workloadId);
}

export function resolveRemoteBenchmarkPolicy(input: RemoteBenchmarkPolicyInput): RemoteBenchmarkPolicy {
  const { workloadId, providerProfile, thinkingMode, providerKind } = input;

  let totalTimeoutMs = REMOTE_BENCHMARK_TIMEOUT_MS;
  if (thinkingMode === "thinking") totalTimeoutMs += 45000;
  if (providerProfile === "tool-first") totalTimeoutMs += 30000;
  if (isLongContextWorkload(workloadId)) totalTimeoutMs += 30000;
  if (isCodeGenerationWorkload(workloadId)) totalTimeoutMs += 45000;

  let firstTokenTimeoutMs = REMOTE_BENCHMARK_FIRST_TOKEN_TIMEOUT_MS;
  if (providerProfile === "balanced") firstTokenTimeoutMs += 5000;
  if (providerProfile === "tool-first") firstTokenTimeoutMs += 5000;
  if (thinkingMode === "thinking") firstTokenTimeoutMs += 15000;
  if (isLongContextWorkload(workloadId)) firstTokenTimeoutMs += 10000;
  if (isCodeGenerationWorkload(workloadId)) firstTokenTimeoutMs += 15000;

  if (providerKind === "claude-compatible") {
    if (thinkingMode === "thinking") {
      firstTokenTimeoutMs = Math.min(firstTokenTimeoutMs, 30000);
    } else if (providerProfile === "tool-first") {
      firstTokenTimeoutMs = Math.min(firstTokenTimeoutMs, 22000);
    } else if (providerProfile === "balanced") {
      firstTokenTimeoutMs = Math.min(firstTokenTimeoutMs, 20000);
    } else {
      firstTokenTimeoutMs = Math.min(firstTokenTimeoutMs, 17000);
    }
  }

  if (providerKind === "deepseek-compatible") {
    if (thinkingMode === "thinking") {
      firstTokenTimeoutMs += 12000;
    } else if (providerProfile === "tool-first") {
      firstTokenTimeoutMs += 3000;
    }
  }

  if (providerKind === "moonshot-compatible") {
    if (thinkingMode === "thinking") firstTokenTimeoutMs += 10000;
    if (providerProfile === "tool-first") firstTokenTimeoutMs += 4000;
  }

  if (providerKind === "zhipu-compatible" || providerKind === "dashscope-compatible") {
    if (thinkingMode === "thinking") firstTokenTimeoutMs += 7000;
    if (providerProfile === "tool-first") firstTokenTimeoutMs += 3000;
  }

  if (workloadId === "latency-smoke") {
    if (providerKind === "claude-compatible") {
      if (thinkingMode === "thinking") {
        firstTokenTimeoutMs = 18000;
      } else if (providerProfile === "tool-first") {
        firstTokenTimeoutMs = 15000;
      } else if (providerProfile === "balanced") {
        firstTokenTimeoutMs = 14000;
      } else {
        firstTokenTimeoutMs = 12000;
      }
    } else {
      firstTokenTimeoutMs = Math.min(firstTokenTimeoutMs, 12000);
    }
    if (providerKind === "deepseek-compatible") {
      firstTokenTimeoutMs = thinkingMode === "thinking" ? 26000 : 14000;
    }
  }

  if (providerKind === "claude-compatible" && thinkingMode === "standard" && isInstructionStyleWorkload(workloadId)) {
    if (providerProfile === "balanced") {
      firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 18000), 20000);
    } else if (providerProfile !== "tool-first") {
      firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 16000), 18000);
    }
  }

  if (workloadId === "bfcl-starter") {
    if (providerKind === "claude-compatible") {
      if (thinkingMode === "thinking") {
        firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 28000), 30000);
      } else if (providerProfile === "balanced" || providerProfile === "tool-first") {
        firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 22000), 24000);
      } else {
        firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 20000), 22000);
      }
    } else if (providerProfile === "tool-first" || thinkingMode === "thinking") {
      firstTokenTimeoutMs = Math.min(Math.max(firstTokenTimeoutMs, 20000), 22000);
    }
  }

  firstTokenTimeoutMs = Math.min(Math.max(12000, firstTokenTimeoutMs), Math.max(18000, totalTimeoutMs - 10000));

  let retryBudgetMs = Math.max(firstTokenTimeoutMs + 15000, 35000);
  if (providerProfile === "tool-first") retryBudgetMs += 5000;
  if (thinkingMode === "thinking") retryBudgetMs += 15000;
  if (isLongContextWorkload(workloadId)) retryBudgetMs += 10000;
  if (isCodeGenerationWorkload(workloadId)) retryBudgetMs += 15000;

  if (workloadId === "latency-smoke") {
    if (providerKind === "claude-compatible") {
      retryBudgetMs = providerProfile === "balanced" ? 38000 : 32000;
      if (thinkingMode === "thinking") retryBudgetMs = 45000;
    } else {
      retryBudgetMs = 28000;
    }
    if (providerKind === "deepseek-compatible") {
      retryBudgetMs = thinkingMode === "thinking" ? 52000 : 32000;
    }
    if (providerKind === "moonshot-compatible") {
      retryBudgetMs = thinkingMode === "thinking" ? 52000 : 34000;
    }
    if (providerKind === "zhipu-compatible" || providerKind === "dashscope-compatible") {
      retryBudgetMs = thinkingMode === "thinking" ? 50000 : 34000;
    }
  }

  if (providerKind === "claude-compatible" && thinkingMode === "standard" && isInstructionStyleWorkload(workloadId)) {
    retryBudgetMs = Math.min(retryBudgetMs, providerProfile === "balanced" ? 50000 : 42000);
  }

  if (workloadId === "bfcl-starter") {
    if (providerKind === "claude-compatible") {
      if (thinkingMode === "thinking") {
        retryBudgetMs = 90000;
      } else if (providerProfile === "tool-first") {
        retryBudgetMs = 70000;
      } else if (providerProfile === "balanced") {
        retryBudgetMs = 60000;
      } else {
        retryBudgetMs = 55000;
      }
    } else {
      retryBudgetMs = Math.max(retryBudgetMs, 45000);
    }
  }

  retryBudgetMs = Math.max(retryBudgetMs, firstTokenTimeoutMs + 8000);
  retryBudgetMs = Math.min(retryBudgetMs, Math.max(25000, totalTimeoutMs - 10000));

  let streamIdleTimeoutMs: number;
  if (workloadId === "latency-smoke") {
    if (providerKind === "claude-compatible") {
      if (thinkingMode === "thinking") {
        streamIdleTimeoutMs = 15000;
      } else {
        streamIdleTimeoutMs = providerProfile === "balanced" ? 12000 : 10000;
      }
    } else {
      streamIdleTimeoutMs = 8000;
    }
    if (providerKind === "deepseek-compatible") {
      streamIdleTimeoutMs = thinkingMode === "thinking" ? 22000 : 10000;
    }
    if (providerKind === "moonshot-compatible") {
      streamIdleTimeoutMs = thinkingMode === "thinking" ? 24000 : 12000;
    }
    if (providerKind === "zhipu-compatible" || providerKind === "dashscope-compatible") {
      streamIdleTimeoutMs = thinkingMode === "thinking" ? 22000 : 12000;
    }
  } else if (providerKind === "claude-compatible" && thinkingMode === "standard" && isInstructionStyleWorkload(workloadId)) {
    streamIdleTimeoutMs = providerProfile === "balanced" ? 22000 : 18000;
  } else if (isInstructionStyleWorkload(workloadId)) {
    streamIdleTimeoutMs = providerProfile === "tool-first" || thinkingMode === "thinking" ? 22000 : 18000;
  } else if (workloadId === "bfcl-starter") {
    if (providerKind === "claude-compatible") {
      if (thinkingMode === "thinking") {
        streamIdleTimeoutMs = 35000;
      } else {
        streamIdleTimeoutMs = providerProfile === "tool-first" ? 30000 : 24000;
      }
    } else {
      streamIdleTimeoutMs = providerProfile === "tool-first" || thinkingMode === "thinking" ? 25000 : 18000;
    }
  } else {
    streamIdleTimeoutMs = Math.floor(totalTimeoutMs * 0.35);
    if (providerKind === "claude-compatible") streamIdleTimeoutMs += 5000;
    if (providerKind === "deepseek-compatible") streamIdleTimeoutMs += thinkingMode === "thinking" ? 12000 : 3000;
    if (providerKind === "moonshot-compatible") streamIdleTimeoutMs += thinkingMode === "thinking" ? 10000 : 4000;
    if (providerKind === "zhipu-compatible" || providerKind === "dashscope-compatible") {
      streamIdleTimeoutMs += thinkingMode === "thinking" ? 8000 : 3000;
    }
    if (providerProfile === "tool-first") streamIdleTimeoutMs += 10000;
    if (thinkingMode === "thinking") streamIdleTimeoutMs += 15000;
    if (isLongContextWorkload(workloadId)) streamIdleTimeoutMs += 10000;
    if (isCodeGenerationWorkload(workloadId)) streamIdleTimeoutMs += 15000;
    streamIdleTimeoutMs = Math.max(12000, Math.min(60000, streamIdleTimeoutMs));
  }

  return {
    totalTimeoutMs,
    firstTokenTimeoutMs,
    retryBudgetMs,
    streamIdleTimeoutMs
  };
}

export function getRemoteBenchmarkRetryDelayMs(message: string, attempt: number, workloadId: string) {
  const normalized = message.toLowerCase();
  if (
    workloadId === "latency-smoke" &&
    (normalized.includes("timeout") ||
      normalized.includes("timed out") ||
      normalized.includes("stream idle timeout") ||
      normalized.includes("first token timeout"))
  ) {
    return Math.min(2500, 500 * attempt);
  }
  if (
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  ) {
    return Math.min(15000, 2500 * attempt);
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("max concurrent")
  ) {
    return Math.min(12000, 2000 * attempt);
  }
  return Math.min(10000, 1000 * attempt);
}
