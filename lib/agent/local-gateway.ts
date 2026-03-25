import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import path from "path";
import { execFileSync, spawn } from "child_process";

const DATA_DIR = path.join(process.cwd(), "data", "agent-observability");
const SUPERVISOR_PID_FILE = path.join(DATA_DIR, "local-gateway-supervisor.pid");
const CHILD_PID_FILE = path.join(DATA_DIR, "local-gateway.pid");
const SUPERVISOR_LOG_FILE = path.join(DATA_DIR, "local-gateway.log");
const SUPERVISOR_STATE_FILE = path.join(DATA_DIR, "local-gateway-supervisor-state.json");
const VENV_PYTHON = path.join(process.cwd(), ".venv", "bin", "python");
const SUPERVISOR_SCRIPT = path.join(process.cwd(), "scripts", "local_model_gateway_supervisor.py");

type SupervisorState = {
  restart_count?: number;
  last_start_at?: string | null;
  last_exit_at?: string | null;
  last_exit_code?: number | null;
  last_event?: string | null;
  supervisor_pid?: number | null;
  child_pid?: number | null;
};

export type GatewayEnsureResult = {
  ok: boolean;
  reason: string;
  attempts: number;
};

let ensurePromise: Promise<GatewayEnsureResult> | null = null;

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(filePath: string) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function readSupervisorState(): SupervisorState {
  if (!existsSync(SUPERVISOR_STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SUPERVISOR_STATE_FILE, "utf8")) as SupervisorState;
  } catch {
    return {};
  }
}

function choosePythonExecutable() {
  if (existsSync(VENV_PYTHON)) return VENV_PYTHON;
  return "python3.12";
}

function findGatewayListenPid() {
  try {
    const output = execFileSync("lsof", ["-tiTCP:4000", "-sTCP:LISTEN"], {
      encoding: "utf8"
    }).trim();
    const pid = Number(output.split("\n")[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function findMatchingPids(pattern: string) {
  try {
    const output = execFileSync("pgrep", ["-f", pattern], {
      encoding: "utf8"
    }).trim();
    return output
      .split("\n")
      .map((value) => Number(value))
      .filter((value): value is number => Number.isFinite(value) && value > 0 && value !== process.pid);
  } catch {
    return [];
  }
}

export async function probeLocalGateway(baseUrl: string, timeoutMs = 1200) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${baseUrl.replace(/\/v1$/, "")}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function cleanupStaleSupervisorPid() {
  const pid = readPid(SUPERVISOR_PID_FILE);
  if (!pid) return;
  if (!isPidAlive(pid)) {
    try {
      unlinkSync(SUPERVISOR_PID_FILE);
    } catch {
      // ignore
    }
  }
}

function cleanupStaleChildPid() {
  const pid = readPid(CHILD_PID_FILE);
  if (!pid) return;
  if (!isPidAlive(pid)) {
    try {
      unlinkSync(CHILD_PID_FILE);
    } catch {
      // ignore
    }
  }
}

function spawnSupervisorProcess() {
  ensureDataDir();
  cleanupStaleSupervisorPid();
  cleanupStaleChildPid();

  const existingPid = readPid(SUPERVISOR_PID_FILE);
  if (existingPid && isPidAlive(existingPid)) {
    return existingPid;
  }

  const child = spawn(choosePythonExecutable(), [SUPERVISOR_SCRIPT], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child.pid ?? null;
}

async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 200) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

function stopPid(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function forceStopPid(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalGatewayAvailable(baseUrl: string, options?: { waitMs?: number }) {
  const result = await ensureLocalGatewayAvailableDetailed(baseUrl, options);
  return result.ok;
}

export async function ensureLocalGatewayAvailableDetailed(baseUrl: string, options?: { waitMs?: number }): Promise<GatewayEnsureResult> {
  if (await probeLocalGateway(baseUrl)) {
    return {
      ok: true,
      reason: "Gateway health endpoint is already reachable.",
      attempts: 0
    };
  }

  if (!ensurePromise) {
    ensurePromise = (async () => {
      let spawnAttempts = 0;
      spawnSupervisorProcess();
      spawnAttempts += 1;
      const waitMs = options?.waitMs ?? 20000;
      const startedAt = Date.now();
      while (Date.now() - startedAt < waitMs) {
        if (await probeLocalGateway(baseUrl, 1500)) {
          return {
            ok: true,
            reason: spawnAttempts > 0 ? "Gateway became ready after supervisor bootstrap." : "Gateway became ready.",
            attempts: spawnAttempts
          };
        }
        const info = getLocalGatewaySupervisorInfo();
        if (!info.supervisorAlive && Date.now() - startedAt > 2500 && spawnAttempts < 2) {
          spawnSupervisorProcess();
          spawnAttempts += 1;
        }
        await sleep(500);
      }
      const info = getLocalGatewaySupervisorInfo();
      if (info.supervisorAlive && !info.gatewayAlive) {
        return {
          ok: false,
          reason: "Supervisor is alive but the gateway process did not stay up or did not bind port 4000.",
          attempts: spawnAttempts
        };
      }
      if (info.gatewayAlive) {
        return {
          ok: false,
          reason: "Gateway process is alive but the health endpoint did not become ready in time.",
          attempts: spawnAttempts
        };
      }
      return {
        ok: false,
        reason: "Supervisor did not keep the gateway available before the startup deadline.",
        attempts: spawnAttempts
      };
    })().finally(() => {
      ensurePromise = null;
    });
  }

  return ensurePromise;
}

export function getLocalGatewaySupervisorInfo() {
  cleanupStaleSupervisorPid();
  cleanupStaleChildPid();
  const pid = readPid(SUPERVISOR_PID_FILE);
  const childPid = readPid(CHILD_PID_FILE) || findGatewayListenPid();
  const state = readSupervisorState();
  return {
    supervisorPid: pid,
    supervisorAlive: pid ? isPidAlive(pid) : false,
    gatewayPid: childPid,
    gatewayAlive: childPid ? isPidAlive(childPid) : false,
    restartCount: typeof state.restart_count === "number" ? state.restart_count : 0,
    lastStartAt: typeof state.last_start_at === "string" ? state.last_start_at : null,
    lastExitAt: typeof state.last_exit_at === "string" ? state.last_exit_at : null,
    lastExitCode: typeof state.last_exit_code === "number" ? state.last_exit_code : null,
    lastEvent: typeof state.last_event === "string" ? state.last_event : null,
    logFile: SUPERVISOR_LOG_FILE
  };
}

export function stopLocalGatewaySupervisor() {
  const pid = readPid(SUPERVISOR_PID_FILE);
  if (!pid) return false;
  return stopPid(pid);
}

export function stopLocalGatewayChild() {
  const pid = readPid(CHILD_PID_FILE) || findGatewayListenPid();
  if (!pid) return false;
  return stopPid(pid);
}

export async function restartLocalGateway(baseUrl: string, options?: { waitMs?: number }) {
  const waitMs = options?.waitMs ?? 30000;
  stopLocalGatewaySupervisor();
  stopLocalGatewayChild();
  const stoppedGracefully = await waitForCondition(() => {
    const info = getLocalGatewaySupervisorInfo();
    return !info.supervisorAlive && !info.gatewayAlive;
  }, 4000);
  if (!stoppedGracefully) {
    const info = getLocalGatewaySupervisorInfo();
    const pids = [
      info.supervisorPid,
      info.gatewayPid,
      findGatewayListenPid(),
      ...findMatchingPids("scripts/local_model_gateway.py"),
      ...findMatchingPids("scripts/local_model_gateway_supervisor.py")
    ].filter(
      (value, index, all): value is number => typeof value === "number" && all.indexOf(value) === index
    );
    for (const pid of pids) {
      forceStopPid(pid);
    }
    await waitForCondition(() => {
      const currentInfo = getLocalGatewaySupervisorInfo();
      return !currentInfo.supervisorAlive && !currentInfo.gatewayAlive;
    }, 5000);
  }
  const remainingPids = [
    ...findMatchingPids("scripts/local_model_gateway.py"),
    ...findMatchingPids("scripts/local_model_gateway_supervisor.py"),
    findGatewayListenPid()
  ].filter((value, index, all): value is number => typeof value === "number" && all.indexOf(value) === index);
  for (const pid of remainingPids) {
    forceStopPid(pid);
  }
  await waitForCondition(() => {
    const info = getLocalGatewaySupervisorInfo();
    return !info.supervisorAlive && !info.gatewayAlive;
  }, 5000);
  spawnSupervisorProcess();
  const result = await ensureLocalGatewayAvailableDetailed(baseUrl, { waitMs });
  return result.ok;
}

export function readLocalGatewayRecentLog(lines = 40) {
  if (!existsSync(SUPERVISOR_LOG_FILE)) return "";
  try {
    const output = execFileSync("tail", ["-n", String(lines), SUPERVISOR_LOG_FILE], {
      encoding: "utf8"
    });
    return output;
  } catch {
    return readFileSync(SUPERVISOR_LOG_FILE, "utf8").slice(-4000);
  }
}
