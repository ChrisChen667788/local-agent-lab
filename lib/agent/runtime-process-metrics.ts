import { execFileSync } from "child_process";

export type RuntimeProcessMetrics = {
  gatewayCpuPct: number | null;
  gatewayResidentMemoryMb: number | null;
};

export function readRuntimeProcessMetrics(pid: number | null | undefined): RuntimeProcessMetrics {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return {
      gatewayCpuPct: null,
      gatewayResidentMemoryMb: null
    };
  }

  try {
    const output = execFileSync("ps", ["-o", "rss=,%cpu=", "-p", String(pid)], {
      encoding: "utf8"
    }).trim();
    const columns = output.split(/\s+/);
    const rssKb = Number(columns[0] || "");
    const cpuPct = Number(columns[1] || "");
    return {
      gatewayCpuPct: Number.isFinite(cpuPct) ? Number(cpuPct.toFixed(1)) : null,
      gatewayResidentMemoryMb: Number.isFinite(rssKb) ? Number((rssKb / 1024).toFixed(1)) : null
    };
  } catch {
    return {
      gatewayCpuPct: null,
      gatewayResidentMemoryMb: null
    };
  }
}
