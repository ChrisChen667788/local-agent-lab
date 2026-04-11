import { execFileSync } from "child_process";
import { existsSync } from "fs";

export type RuntimeProcessMetrics = {
  gatewayCpuPct: number | null;
  gatewayResidentMemoryMb: number | null;
  gatewayGpuPct: number | null;
  gatewayGpuMemoryMb: number | null;
  gatewayEnergySignalPct: number | null;
  gatewayDiskUsedPct: number | null;
  modelStorageFootprintMb: number | null;
};

const MODEL_STORAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const modelStorageCache = new Map<string, { value: number | null; cachedAt: number }>();

function safeExec(command: string, args: string[]) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 4000
    }).trim();
  } catch {
    return "";
  }
}

function readPsMetrics(pid: number | null | undefined) {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return {
      gatewayCpuPct: null,
      gatewayResidentMemoryMb: null
    };
  }

  const output = safeExec("ps", ["-o", "rss=,%cpu=", "-p", String(pid)]);
  if (!output) {
    return {
      gatewayCpuPct: null,
      gatewayResidentMemoryMb: null
    };
  }
  const columns = output.split(/\s+/);
  const rssKb = Number(columns[0] || "");
  const cpuPct = Number(columns[1] || "");
  return {
    gatewayCpuPct: Number.isFinite(cpuPct) ? Number(cpuPct.toFixed(1)) : null,
    gatewayResidentMemoryMb: Number.isFinite(rssKb) ? Number((rssKb / 1024).toFixed(1)) : null
  };
}

function readGpuMetrics() {
  const output = safeExec("ioreg", ["-r", "-d", "2", "-c", "AGXAccelerator"]);
  if (!output) {
    return {
      gatewayGpuPct: null,
      gatewayGpuMemoryMb: null
    };
  }

  const utilizationMatch = output.match(/"Device Utilization %"\s*=\s*(\d+)/);
  const gpuMemoryMatch = output.match(/"In use system memory"\s*=\s*(\d+)/);
  const gpuPct = utilizationMatch ? Number(utilizationMatch[1]) : null;
  const gpuMemoryBytes = gpuMemoryMatch ? Number(gpuMemoryMatch[1]) : null;

  return {
    gatewayGpuPct: typeof gpuPct === "number" && Number.isFinite(gpuPct) ? Number(gpuPct.toFixed(1)) : null,
    gatewayGpuMemoryMb:
      typeof gpuMemoryBytes === "number" && Number.isFinite(gpuMemoryBytes)
        ? Number((gpuMemoryBytes / 1024 / 1024).toFixed(1))
        : null
  };
}

function readDiskUsedPct() {
  const output = safeExec("df", ["-k", "/"]);
  const lines = output.split("\n");
  if (lines.length < 2) return null;
  const columns = lines[1].trim().split(/\s+/);
  const total = Number(columns[1] || "0");
  const used = Number(columns[2] || "0");
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  return Number(((used / total) * 100).toFixed(1));
}

function readBatteryStatus() {
  const output = safeExec("pmset", ["-g", "batt"]);
  if (!output) {
    return {
      onAcPower: null
    };
  }
  if (/AC Power/i.test(output)) {
    return { onAcPower: true };
  }
  if (/Battery Power/i.test(output)) {
    return { onAcPower: false };
  }
  return { onAcPower: null };
}

function estimateEnergySignal(input: {
  gatewayCpuPct: number | null;
  gatewayGpuPct: number | null;
  runtimeBusy?: boolean;
  onAcPower?: boolean | null;
}) {
  const cpuPct = typeof input.gatewayCpuPct === "number" ? input.gatewayCpuPct : null;
  const gpuPct = typeof input.gatewayGpuPct === "number" ? input.gatewayGpuPct : null;
  if (cpuPct === null && gpuPct === null && !input.runtimeBusy) {
    return null;
  }

  const normalizedCpu = cpuPct === null ? 0 : Math.min(100, Math.max(0, cpuPct));
  const normalizedGpu = gpuPct === null ? 0 : Math.min(100, Math.max(0, gpuPct));
  let estimate = normalizedCpu * 0.35 + normalizedGpu * 0.65;
  if (input.runtimeBusy) {
    estimate = Math.max(estimate, 18);
  }
  if (input.onAcPower === false) {
    estimate += 8;
  }
  return Number(Math.min(100, Math.max(0, estimate)).toFixed(1));
}

function readModelStorageFootprintMb(sourcePath?: string) {
  if (!sourcePath || !existsSync(sourcePath)) return null;
  const cached = modelStorageCache.get(sourcePath);
  if (cached && Date.now() - cached.cachedAt < MODEL_STORAGE_CACHE_TTL_MS) {
    return cached.value;
  }

  const output = safeExec("du", ["-sk", sourcePath]);
  const kilobytes = Number(output.split(/\s+/)[0] || "");
  const value = Number.isFinite(kilobytes) ? Number((kilobytes / 1024).toFixed(1)) : null;
  modelStorageCache.set(sourcePath, {
    value,
    cachedAt: Date.now()
  });
  return value;
}

export function readRuntimeProcessMetrics(
  pid: number | null | undefined,
  options?: {
    modelSourcePath?: string;
    runtimeBusy?: boolean;
  }
): RuntimeProcessMetrics {
  const psMetrics = readPsMetrics(pid);
  const gpuMetrics = readGpuMetrics();
  const diskUsedPct = readDiskUsedPct();
  const battery = readBatteryStatus();
  return {
    ...psMetrics,
    ...gpuMetrics,
    gatewayEnergySignalPct: estimateEnergySignal({
      gatewayCpuPct: psMetrics.gatewayCpuPct,
      gatewayGpuPct: gpuMetrics.gatewayGpuPct,
      runtimeBusy: options?.runtimeBusy,
      onAcPower: battery.onAcPower
    }),
    gatewayDiskUsedPct: diskUsedPct,
    modelStorageFootprintMb: readModelStorageFootprintMb(options?.modelSourcePath)
  };
}
