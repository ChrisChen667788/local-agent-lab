export function normalizeContextWindow(value: unknown, fallback = 8192) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1024, Math.min(Math.trunc(value), 32768));
}

export function clampContextWindowForTarget(
  targetId: string,
  requestedContextWindow: number,
  options?: { enableTools?: boolean; enableRetrieval?: boolean }
) {
  const normalized = normalizeContextWindow(requestedContextWindow, 8192);
  const retrievalOrTools = Boolean(options?.enableTools) || Boolean(options?.enableRetrieval);

  if (targetId === "local-qwen3-0.6b") {
    return Math.min(normalized, retrievalOrTools ? 4096 : 8192);
  }

  if (targetId === "local-qwen3-4b-4bit" || targetId === "local-qwen35-4b-4bit") {
    return Math.min(normalized, retrievalOrTools ? 8192 : 16384);
  }

  return normalized;
}

export function calculateTokenThroughputTps(
  completionTokens: number | null | undefined,
  totalLatencyMs: number,
  firstTokenLatencyMs?: number | null
) {
  if (typeof completionTokens !== "number" || !Number.isFinite(completionTokens) || completionTokens <= 0) {
    return undefined;
  }

  if (!Number.isFinite(totalLatencyMs) || totalLatencyMs <= 0) {
    return undefined;
  }

  const generationWindowMs =
    typeof firstTokenLatencyMs === "number" && Number.isFinite(firstTokenLatencyMs)
      ? totalLatencyMs - firstTokenLatencyMs
      : totalLatencyMs;
  const effectiveWindowMs = generationWindowMs >= 50 ? generationWindowMs : totalLatencyMs;

  if (!Number.isFinite(effectiveWindowMs) || effectiveWindowMs <= 0) {
    return undefined;
  }

  return Number(((completionTokens / effectiveWindowMs) * 1000).toFixed(2));
}

export function percentile(
  values: Array<number | null | undefined>,
  ratio: number
) {
  const filtered = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!filtered.length) return 0;
  if (filtered.length === 1) return Number(filtered[0].toFixed(2));

  const safeRatio = Math.min(Math.max(ratio, 0), 1);
  const index = (filtered.length - 1) * safeRatio;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return Number(filtered[lowerIndex].toFixed(2));
  }

  const lower = filtered[lowerIndex];
  const upper = filtered[upperIndex];
  const interpolated = lower + (upper - lower) * (index - lowerIndex);
  return Number(interpolated.toFixed(2));
}
