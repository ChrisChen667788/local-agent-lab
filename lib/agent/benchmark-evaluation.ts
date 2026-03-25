import type { AgentBenchmarkDatasetItem, AgentBenchmarkDatasetEvaluationRule } from "@/lib/agent/types";

export type BenchmarkEvaluationResult = {
  score: number | null;
  passed: boolean | null;
  rationale: string;
};

function stripCodeFences(value: string) {
  return value
    .replace(/^```[a-zA-Z0-9_-]*\s*/u, "")
    .replace(/```$/u, "")
    .trim();
}

function extractJsonObject(value: string) {
  const normalized = stripCodeFences(value);
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = normalized.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function countMatchedKeywords(output: string, keywords: string[]) {
  const normalized = normalizeText(output);
  let matched = 0;
  for (const keyword of keywords) {
    if (normalized.includes(normalizeText(keyword))) {
      matched += 1;
    }
  }
  return matched;
}

function evaluateChoiceExact(output: string, rule: Extract<AgentBenchmarkDatasetEvaluationRule, { kind: "choice-exact" }>): BenchmarkEvaluationResult {
  const normalized = output.toUpperCase();
  const letterMatch = normalized.match(/\b([A-D])\b/);
  const actual = letterMatch?.[1] || normalized.trim().slice(0, 1);
  const validAnswers = [rule.answer.toUpperCase(), ...(rule.aliases || []).map((entry) => entry.toUpperCase())];
  const passed = validAnswers.includes(actual);
  return {
    score: passed ? 100 : 0,
    passed,
    rationale: passed ? `Matched answer ${rule.answer}.` : `Expected ${rule.answer}, received ${actual || "empty"}.`
  };
}

function evaluateKeywordMatch(output: string, rule: Extract<AgentBenchmarkDatasetEvaluationRule, { kind: "keyword-match" }>): BenchmarkEvaluationResult {
  const keywords = rule.keywords.filter(Boolean);
  if (!keywords.length) {
    return {
      score: null,
      passed: null,
      rationale: "No keywords configured."
    };
  }
  const matched = countMatchedKeywords(output, keywords);
  const ratio = matched / keywords.length;
  const threshold = typeof rule.threshold === "number" ? rule.threshold : 1;
  return {
    score: Number((ratio * 100).toFixed(2)),
    passed: ratio >= threshold,
    rationale: `Matched ${matched}/${keywords.length} keywords.`
  };
}

function evaluateJsonKeys(output: string, rule: Extract<AgentBenchmarkDatasetEvaluationRule, { kind: "json-keys" }>): BenchmarkEvaluationResult {
  const payload = extractJsonObject(output);
  if (!payload) {
    return {
      score: 0,
      passed: false,
      rationale: "Output is not valid JSON."
    };
  }
  const keys = Object.keys(payload);
  const missing = rule.keys.filter((key) => !keys.includes(key));
  const extra = rule.exactKeys ? keys.filter((key) => !rule.keys.includes(key)) : [];
  const matchedRatio = rule.keys.length ? (rule.keys.length - missing.length) / rule.keys.length : 0;
  return {
    score: Number((matchedRatio * 100).toFixed(2)),
    passed: missing.length === 0 && extra.length === 0,
    rationale:
      missing.length || extra.length
        ? `Missing keys: ${missing.join(", ") || "--"}; extra keys: ${extra.join(", ") || "--"}.`
        : "JSON keys matched."
  };
}

function evaluateLineRules(output: string, rule: Extract<AgentBenchmarkDatasetEvaluationRule, { kind: "line-rules" }>): BenchmarkEvaluationResult {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletCount = lines.filter((line) => /^[-*•]/u.test(line)).length;
  let checks = 0;
  let passedChecks = 0;

  if (typeof rule.lineCount === "number") {
    checks += 1;
    if (lines.length === rule.lineCount) passedChecks += 1;
  }
  if (typeof rule.bulletCount === "number") {
    checks += 1;
    if (bulletCount === rule.bulletCount) passedChecks += 1;
  }
  if (rule.keywords?.length) {
    checks += rule.keywords.length;
    passedChecks += countMatchedKeywords(output, rule.keywords);
  }

  const ratio = checks ? passedChecks / checks : 0;
  return {
    score: Number((ratio * 100).toFixed(2)),
    passed: ratio >= 1,
    rationale: `Passed ${passedChecks}/${checks} line/keyword checks.`
  };
}

function evaluateJsonToolCall(output: string, rule: Extract<AgentBenchmarkDatasetEvaluationRule, { kind: "json-tool-call" }>): BenchmarkEvaluationResult {
  const payload = extractJsonObject(output);
  if (!payload) {
    return {
      score: 0,
      passed: false,
      rationale: "Output is not valid JSON."
    };
  }
  const name =
    (typeof payload.name === "string" && payload.name) ||
    (typeof payload.function === "string" && payload.function) ||
    (payload.tool && typeof payload.tool === "string" ? payload.tool : "");
  const args =
    (payload.arguments && typeof payload.arguments === "object" ? (payload.arguments as Record<string, unknown>) : null) ||
    (payload.args && typeof payload.args === "object" ? (payload.args as Record<string, unknown>) : null) ||
    {};
  const missingArgs = rule.requiredArgs.filter((arg) => !(arg in args));
  const functionMatched = name === rule.functionName;
  const argScore = rule.requiredArgs.length
    ? (rule.requiredArgs.length - missingArgs.length) / rule.requiredArgs.length
    : 0;
  const totalScore = (functionMatched ? 0.5 : 0) + argScore * 0.5;
  return {
    score: Number((totalScore * 100).toFixed(2)),
    passed: functionMatched && missingArgs.length === 0,
    rationale: functionMatched
      ? missingArgs.length
        ? `Function matched; missing args: ${missingArgs.join(", ")}`
        : "Function name and required args matched."
      : `Expected function ${rule.functionName}, received ${name || "empty"}.`
  };
}

export function evaluateBenchmarkDatasetOutput(
  item: AgentBenchmarkDatasetItem,
  output: string
): BenchmarkEvaluationResult {
  switch (item.evaluator.kind) {
    case "choice-exact":
      return evaluateChoiceExact(output, item.evaluator);
    case "keyword-match":
      return evaluateKeywordMatch(output, item.evaluator);
    case "json-keys":
      return evaluateJsonKeys(output, item.evaluator);
    case "line-rules":
      return evaluateLineRules(output, item.evaluator);
    case "json-tool-call":
      return evaluateJsonToolCall(output, item.evaluator);
    case "manual-review":
      return {
        score: null,
        passed: null,
        rationale: item.evaluator.note
      };
    default:
      return {
        score: null,
        passed: null,
        rationale: "Unsupported evaluator."
      };
  }
}
