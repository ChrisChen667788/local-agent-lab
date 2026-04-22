import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getLocalAgentDataPath } from "@/lib/agent/data-dir";

export type RuntimeResourceGuardrailStrategy = {
  cautionPeakRatio: number;
  blockedPeakRatio: number;
  cautionFreeMb: number;
  blockedFreeMb: number;
};

const RUNTIME_GUARDRAIL_POLICY_FILE = getLocalAgentDataPath("runtime-guardrail-policy.json");

export const DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY: RuntimeResourceGuardrailStrategy = {
  cautionPeakRatio: 0.68,
  blockedPeakRatio: 0.82,
  cautionFreeMb: 6144,
  blockedFreeMb: 2048
};

function sanitizePositiveNumber(value: unknown, fallback: number) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

export function normalizeRuntimeResourceGuardrailStrategy(
  value?: Partial<RuntimeResourceGuardrailStrategy> | null,
  fallback: RuntimeResourceGuardrailStrategy = DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY
): RuntimeResourceGuardrailStrategy {
  const cautionPeakRatio = sanitizePositiveNumber(value?.cautionPeakRatio, fallback.cautionPeakRatio);
  const blockedPeakRatio = sanitizePositiveNumber(value?.blockedPeakRatio, fallback.blockedPeakRatio);
  const cautionFreeMb = sanitizePositiveNumber(value?.cautionFreeMb, fallback.cautionFreeMb);
  const blockedFreeMb = sanitizePositiveNumber(value?.blockedFreeMb, fallback.blockedFreeMb);

  return {
    cautionPeakRatio: Math.min(cautionPeakRatio, blockedPeakRatio),
    blockedPeakRatio: Math.max(blockedPeakRatio, cautionPeakRatio),
    cautionFreeMb: Math.max(cautionFreeMb, blockedFreeMb),
    blockedFreeMb: Math.min(blockedFreeMb, cautionFreeMb)
  };
}

export function readPersistedRuntimeResourceGuardrailStrategy() {
  if (!existsSync(RUNTIME_GUARDRAIL_POLICY_FILE)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(RUNTIME_GUARDRAIL_POLICY_FILE, "utf8")) as
      | Partial<RuntimeResourceGuardrailStrategy>
      | null;
    return normalizeRuntimeResourceGuardrailStrategy(parsed || undefined);
  } catch {
    return null;
  }
}

export function saveRuntimeResourceGuardrailStrategy(value: Partial<RuntimeResourceGuardrailStrategy>) {
  const normalized = normalizeRuntimeResourceGuardrailStrategy(value);
  mkdirSync(dirname(RUNTIME_GUARDRAIL_POLICY_FILE), { recursive: true });
  writeFileSync(RUNTIME_GUARDRAIL_POLICY_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function resetRuntimeResourceGuardrailStrategy() {
  mkdirSync(dirname(RUNTIME_GUARDRAIL_POLICY_FILE), { recursive: true });
  writeFileSync(
    RUNTIME_GUARDRAIL_POLICY_FILE,
    `${JSON.stringify(DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY, null, 2)}\n`,
    "utf8"
  );
  return DEFAULT_RUNTIME_RESOURCE_GUARDRAIL_STRATEGY;
}

export function getRuntimeResourceGuardrailPolicyFile() {
  return RUNTIME_GUARDRAIL_POLICY_FILE;
}
