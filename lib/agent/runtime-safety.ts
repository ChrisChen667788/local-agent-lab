import { execFileSync } from "child_process";
import os from "os";
import type { RuntimeProcessMetrics } from "@/lib/agent/runtime-process-metrics";
import {
  DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY,
  normalizeRuntimeResourceGuardrailStrategy,
  readPersistedRuntimeResourceGuardrailStrategy,
  type RuntimeResourceGuardrailStrategy
} from "@/lib/agent/runtime-guardrail-policy";
import type { AgentRuntimeResourceGuardrailLevel } from "@/lib/agent/types";

export type RuntimeResourceGuardrail = {
  level: AgentRuntimeResourceGuardrailLevel;
  summary: string;
  recommendations: string[];
  estimatedLoadMemoryMb: number | null;
  estimatedPeakMemoryMb: number | null;
  systemTotalMemoryMb: number;
  systemFreeMemoryMb: number;
};

type MacMemorySnapshot = {
  freeMb: number;
  availableMb: number;
};

const MAC_MEMORY_CACHE_TTL_MS = 2000;

let cachedMacMemorySnapshot:
  | {
      at: number;
      snapshot: MacMemorySnapshot;
    }
  | null = null;

function readPositiveNumberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const value = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function readRuntimeResourceGuardrailStrategy(): RuntimeResourceGuardrailStrategy {
  const persisted = readPersistedRuntimeResourceGuardrailStrategy();
  if (persisted) {
    return persisted;
  }

  return normalizeRuntimeResourceGuardrailStrategy({
    cautionPeakRatio: readPositiveNumberEnv(
      "LOCAL_RUNTIME_GUARDRAIL_CAUTION_PEAK_RATIO",
      DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY.cautionPeakRatio
    ),
    blockedPeakRatio: readPositiveNumberEnv(
      "LOCAL_RUNTIME_GUARDRAIL_BLOCKED_PEAK_RATIO",
      DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY.blockedPeakRatio
    ),
    cautionFreeMb: readPositiveNumberEnv(
      "LOCAL_RUNTIME_GUARDRAIL_CAUTION_FREE_MB",
      DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY.cautionFreeMb
    ),
    blockedFreeMb: readPositiveNumberEnv(
      "LOCAL_RUNTIME_GUARDRAIL_BLOCKED_FREE_MB",
      DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY.blockedFreeMb
    )
  });
}

function parseScaleValue(scale?: string) {
  if (!scale) return null;
  const matched = scale.match(/(\d+(?:\.\d+)?)/);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function parseQuantBits(quantizationLabel?: string) {
  if (!quantizationLabel) return null;
  const matched = quantizationLabel.match(/(\d+)-bit/i);
  if (!matched) return null;
  const bits = Number(matched[1]);
  return Number.isFinite(bits) ? bits : null;
}

function estimateLoadMemoryMb(input: {
  modelStorageFootprintMb?: number | null;
  parameterScale?: string;
  quantizationLabel?: string;
}) {
  if (typeof input.modelStorageFootprintMb === "number" && Number.isFinite(input.modelStorageFootprintMb)) {
    return Math.max(768, Number((input.modelStorageFootprintMb * 1.05).toFixed(1)));
  }

  const scale = parseScaleValue(input.parameterScale);
  if (scale === null) return null;
  const bits = parseQuantBits(input.quantizationLabel) || (scale <= 4 ? 8 : 16);
  const bytes = scale * 1_000_000_000 * (bits / 8) * 1.18;
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function readMacMemorySnapshot(): MacMemorySnapshot | null {
  if (process.platform !== "darwin") {
    return null;
  }

  if (cachedMacMemorySnapshot && Date.now() - cachedMacMemorySnapshot.at < MAC_MEMORY_CACHE_TTL_MS) {
    return cachedMacMemorySnapshot.snapshot;
  }

  try {
    const output = execFileSync("/usr/bin/vm_stat", { encoding: "utf8" });
    const pageSizeMatch = output.match(/page size of (\d+) bytes/i);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
      return null;
    }

    const readPages = (label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`${escaped}:\\s+(\\d+)\\.`, "i");
      const matched = output.match(pattern);
      return matched ? Number(matched[1]) : 0;
    };

    const freePages = readPages("Pages free");
    const inactivePages = readPages("Pages inactive");
    const speculativePages = readPages("Pages speculative");
    const purgeablePages = readPages("Pages purgeable");
    const availablePages = freePages + inactivePages + speculativePages + purgeablePages;
    const toMb = (pages: number) => Number(((pages * pageSize) / 1024 / 1024).toFixed(1));
    const snapshot = {
      freeMb: toMb(freePages),
      availableMb: toMb(availablePages)
    };

    cachedMacMemorySnapshot = {
      at: Date.now(),
      snapshot
    };
    return snapshot;
  } catch {
    return null;
  }
}

export function buildRuntimeResourceGuardrail(input: {
  resolvedModel?: string;
  loadedAlias?: string | null;
  processMetrics: RuntimeProcessMetrics;
  parameterScale?: string;
  quantizationLabel?: string;
}) : RuntimeResourceGuardrail {
  const strategy = readRuntimeResourceGuardrailStrategy();
  const systemTotalMemoryMb = Number((os.totalmem() / 1024 / 1024).toFixed(1));
  const macMemorySnapshot = readMacMemorySnapshot();
  const systemFreeMemoryMb =
    macMemorySnapshot?.freeMb ?? Number((os.freemem() / 1024 / 1024).toFixed(1));
  const effectiveAvailableMemoryMb =
    macMemorySnapshot?.availableMb ?? Number((os.freemem() / 1024 / 1024).toFixed(1));
  const estimatedLoadMemoryMb = estimateLoadMemoryMb({
    modelStorageFootprintMb: input.processMetrics.modelStorageFootprintMb,
    parameterScale: input.parameterScale,
    quantizationLabel: input.quantizationLabel
  });

  if (input.loadedAlias && input.resolvedModel && input.loadedAlias === input.resolvedModel) {
    return {
      level: "safe",
      summary: "This target is already loaded, so no extra model load is expected right now.",
      recommendations: [],
      estimatedLoadMemoryMb,
      estimatedPeakMemoryMb: input.processMetrics.gatewayResidentMemoryMb ?? estimatedLoadMemoryMb,
      systemTotalMemoryMb,
      systemFreeMemoryMb
    };
  }

  const residentMb = input.processMetrics.gatewayResidentMemoryMb || 0;
  const gpuMemoryMb = input.processMetrics.gatewayGpuMemoryMb || 0;
  const sharedPressureMb = Math.max(residentMb, gpuMemoryMb);
  const estimatedPeakMemoryMb =
    estimatedLoadMemoryMb === null
      ? sharedPressureMb || null
      : Number((sharedPressureMb + estimatedLoadMemoryMb).toFixed(1));

  if (estimatedLoadMemoryMb === null || estimatedPeakMemoryMb === null || systemTotalMemoryMb <= 0) {
    return {
      level: "caution",
      summary: "Runtime resource pressure cannot be estimated precisely for this target. Prefer loading it only when the machine is otherwise quiet.",
      recommendations: [
        "Release the currently loaded model before switching.",
        "Avoid prewarming all local models in one sweep.",
        "Close other GPU-heavy apps before loading a larger model."
      ],
      estimatedLoadMemoryMb,
      estimatedPeakMemoryMb,
      systemTotalMemoryMb,
      systemFreeMemoryMb
    };
  }

  const peakRatio = estimatedPeakMemoryMb / systemTotalMemoryMb;
  const freeAfterLoadMb = effectiveAvailableMemoryMb - estimatedLoadMemoryMb;

  if (peakRatio >= strategy.blockedPeakRatio || freeAfterLoadMb <= strategy.blockedFreeMb) {
    const summary =
      freeAfterLoadMb <= strategy.blockedFreeMb && peakRatio < strategy.blockedPeakRatio
        ? `Available memory is already too low for another local model load (${Math.max(0, Math.round(freeAfterLoadMb))} MB estimated available after load).`
        : `Loading this model is likely to push shared memory pressure too high (${Math.round(peakRatio * 100)}% estimated peak, ${Math.max(0, Math.round(freeAfterLoadMb))} MB free after load).`;
    return {
      level: "blocked",
      summary,
      recommendations: [
        "Release the current local model first.",
        "Do not use prewarm-all for larger local targets on this machine state.",
        "Prefer a smaller 4-bit or <=4B target until memory pressure drops."
      ],
      estimatedLoadMemoryMb,
      estimatedPeakMemoryMb,
      systemTotalMemoryMb,
      systemFreeMemoryMb
    };
  }

  if (peakRatio >= strategy.cautionPeakRatio || freeAfterLoadMb <= strategy.cautionFreeMb) {
    return {
      level: "caution",
      summary: `This load is feasible but close to the machine's comfort zone (${Math.round(peakRatio * 100)}% estimated peak, ${Math.max(0, Math.round(freeAfterLoadMb))} MB estimated available after load).`,
      recommendations: [
        "Release the previous model before prewarming this one.",
        "Keep only one heavier local model warm at a time.",
        "Use the unload timer so idle models do not keep occupying shared memory."
      ],
      estimatedLoadMemoryMb,
      estimatedPeakMemoryMb,
      systemTotalMemoryMb,
      systemFreeMemoryMb
    };
  }

  return {
    level: "safe",
    summary: "Current memory pressure looks healthy for this target.",
    recommendations: [],
    estimatedLoadMemoryMb,
    estimatedPeakMemoryMb,
    systemTotalMemoryMb,
    systemFreeMemoryMb
  };
}
