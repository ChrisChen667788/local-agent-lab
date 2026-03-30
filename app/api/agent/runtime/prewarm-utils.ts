import { ensureLocalGatewayAvailableDetailed, restartLocalGateway } from "@/lib/agent/local-gateway";
import type { AgentRuntimePrewarmResponse } from "@/lib/agent/types";

const LOCAL_GATEWAY_WARMUP_WAIT_MS = 300000;
const LOCAL_GATEWAY_HEALTH_TIMEOUT_MS = 2000;
const LOCAL_GATEWAY_HEALTH_POLL_MS = 1500;
const LOCAL_GATEWAY_LOADING_STUCK_MS = 12 * 60 * 1000;
const LOCAL_GATEWAY_LOADING_WAIT_MS = 15000;

type GatewayHealthPayload = {
  status?: string;
  loaded_alias?: string | null;
  loading_alias?: string | null;
  loading_elapsed_ms?: number | null;
  loading_error?: string | null;
  runtime_import_error?: string | null;
  busy?: boolean;
  queue_depth?: number;
  active_requests?: number;
};

type UpstreamPrewarmPayload =
  | {
      ok?: boolean;
      loaded_alias?: string | null;
      load_ms?: number;
      warmup_ms?: number;
      detail?: string;
      error?: string;
    }
  | { error?: string; detail?: string };

function gatewayHealthUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/v1$/, "")}/health`;
}

function gatewayPrewarmUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/v1$/, "")}/v1/models/prewarm`;
}

function buildResponse(
  targetId: string,
  targetLabel: string,
  input: Partial<AgentRuntimePrewarmResponse>
): AgentRuntimePrewarmResponse {
  return {
    ok: input.ok ?? false,
    status: input.status ?? (input.ok ? "ready" : "failed"),
    targetId,
    targetLabel,
    loadedAlias: input.loadedAlias ?? null,
    loadMs: input.loadMs,
    warmupMs: input.warmupMs,
    message: input.message ?? `Prewarm finished for ${targetLabel}.`
  };
}

async function fetchGatewayHealth(baseUrl: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_GATEWAY_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(gatewayHealthUrl(baseUrl), {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as GatewayHealthPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForGatewayHealth(
  baseUrl: string,
  predicate: (health: GatewayHealthPayload) => boolean,
  waitMs: number
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const health = await fetchGatewayHealth(baseUrl);
    if (health && predicate(health)) {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCAL_GATEWAY_HEALTH_POLL_MS));
  }
  const finalHealth = await fetchGatewayHealth(baseUrl);
  if (finalHealth && predicate(finalHealth)) {
    return finalHealth;
  }
  return finalHealth;
}

export async function ensureGatewayReady(baseUrl: string) {
  const firstAttempt = await ensureLocalGatewayAvailableDetailed(baseUrl, {
    waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS
  });
  if (firstAttempt.ok) return firstAttempt;
  const restarted = await restartLocalGateway(baseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS });
  if (!restarted) {
    return {
      ok: false,
      reason: `Local gateway did not become ready, and restart timed out. ${firstAttempt.reason}`
    };
  }
  return ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS });
}

async function postPrewarm(baseUrl: string, model: string) {
  return fetch(gatewayPrewarmUrl(baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  });
}

async function restartIfGatewayLoadingLooksStuck(baseUrl: string, health: GatewayHealthPayload | null) {
  if (!health?.loading_alias) {
    return false;
  }

  if (health.loading_error) {
    return restartLocalGateway(baseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS });
  }

  if (
    typeof health.loading_elapsed_ms === "number" &&
    health.loading_elapsed_ms >= LOCAL_GATEWAY_LOADING_STUCK_MS
  ) {
    return restartLocalGateway(baseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS });
  }

  return false;
}

export async function prewarmLocalTargetWithRecovery(options: {
  baseUrl: string;
  model: string;
  targetId: string;
  targetLabel: string;
  allowRetry?: boolean;
}) {
  const { baseUrl, model, targetId, targetLabel } = options;
  const allowRetry = options.allowRetry ?? true;

  const ensureResult = await ensureGatewayReady(baseUrl);
  if (!ensureResult.ok) {
    return buildResponse(targetId, targetLabel, {
      ok: false,
      status: "failed",
      message: ensureResult.reason
    });
  }

  let health = await fetchGatewayHealth(baseUrl);
  if (await restartIfGatewayLoadingLooksStuck(baseUrl, health)) {
    health = await fetchGatewayHealth(baseUrl);
  }

  if (health?.loaded_alias === model && !health.loading_alias) {
    return buildResponse(targetId, targetLabel, {
      ok: true,
      status: "ready",
      loadedAlias: health.loaded_alias,
      message: `${targetLabel} 已经就绪。`
    });
  }

  let upstream: Response;
  try {
    upstream = await postPrewarm(baseUrl, model);
  } catch {
    if (!allowRetry) {
      return buildResponse(targetId, targetLabel, {
        ok: false,
        status: "failed",
        message: "Gateway restart timed out before retrying prewarm."
      });
    }
    const restarted = await restartLocalGateway(baseUrl, { waitMs: LOCAL_GATEWAY_WARMUP_WAIT_MS });
    if (!restarted) {
      return buildResponse(targetId, targetLabel, {
        ok: false,
        status: "failed",
        message: "Gateway restart timed out before retrying prewarm."
      });
    }
    return prewarmLocalTargetWithRecovery({
      baseUrl,
      model,
      targetId,
      targetLabel,
      allowRetry: false
    });
  }

  const payload = (await upstream.json()) as UpstreamPrewarmPayload;
  if (upstream.ok) {
    return buildResponse(targetId, targetLabel, {
      ok: Boolean("ok" in payload ? payload.ok : true),
      status: "ready",
      loadedAlias: "loaded_alias" in payload ? (payload.loaded_alias ?? null) : null,
      loadMs: "load_ms" in payload && typeof payload.load_ms === "number" ? payload.load_ms : undefined,
      warmupMs:
        "warmup_ms" in payload && typeof payload.warmup_ms === "number" ? payload.warmup_ms : undefined,
      message: `Prewarm finished for ${targetLabel}.`
    });
  }

  if (upstream.status !== 409) {
    return buildResponse(targetId, targetLabel, {
      ok: false,
      status: "failed",
      message:
        ("detail" in payload && payload.detail) ||
        ("error" in payload && payload.error) ||
        `Prewarm failed for ${targetLabel}.`
    });
  }

  health = await fetchGatewayHealth(baseUrl);
  if (await restartIfGatewayLoadingLooksStuck(baseUrl, health)) {
    if (!allowRetry) {
      return buildResponse(targetId, targetLabel, {
        ok: false,
        status: "failed",
        message: `${targetLabel} 预热时检测到网关加载卡住，已尝试恢复但仍未成功。`
      });
    }
    return prewarmLocalTargetWithRecovery({
      baseUrl,
      model,
      targetId,
      targetLabel,
      allowRetry: false
    });
  }

  if (health?.loading_alias === model) {
    const settledHealth = await waitForGatewayHealth(
      baseUrl,
      (currentHealth) =>
        Boolean(currentHealth.loading_error) ||
        (currentHealth.loaded_alias === model && !currentHealth.loading_alias),
      LOCAL_GATEWAY_LOADING_WAIT_MS
    );

    if (settledHealth?.loaded_alias === model && !settledHealth.loading_alias) {
      return buildResponse(targetId, targetLabel, {
        ok: true,
        status: "ready",
        loadedAlias: settledHealth.loaded_alias,
        message: `${targetLabel} 在后台继续加载后已完成预热。`
      });
    }

    return buildResponse(targetId, targetLabel, {
      ok: true,
      status: "loading",
      loadedAlias: health.loading_alias,
      message: `${targetLabel} 正在后台加载中，请稍后刷新运行时状态。`
    });
  }

  if (health?.loading_alias) {
    const settledHealth = await waitForGatewayHealth(
      baseUrl,
      (currentHealth) => !currentHealth.loading_alias || Boolean(currentHealth.loading_error),
      LOCAL_GATEWAY_LOADING_WAIT_MS
    );

    if (!settledHealth?.loading_alias && allowRetry) {
      return prewarmLocalTargetWithRecovery({
        baseUrl,
        model,
        targetId,
        targetLabel,
        allowRetry: false
      });
    }

    return buildResponse(targetId, targetLabel, {
      ok: true,
      status: "queued",
      loadedAlias: health.loading_alias,
      message: `${targetLabel} 已排队，当前网关正在加载 ${health.loading_alias}。`
    });
  }

  return buildResponse(targetId, targetLabel, {
    ok: false,
    status: "failed",
    message:
      ("detail" in payload && payload.detail) ||
      ("error" in payload && payload.error) ||
      `Prewarm failed for ${targetLabel}.`
  });
}
