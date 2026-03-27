import os from "os";
import path from "path";

const DEFAULT_LOCAL_AGENT_DATA_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "local-agent-lab",
  "observability"
);

export function getLocalAgentDataDir() {
  return process.env.LOCAL_AGENT_DATA_DIR || DEFAULT_LOCAL_AGENT_DATA_DIR;
}

export function getLocalAgentDataPath(...segments: string[]) {
  return path.join(getLocalAgentDataDir(), ...segments);
}
