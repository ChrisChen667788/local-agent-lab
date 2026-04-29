export type CommunityModelSource = "huggingface" | "github" | "modelscope";

export type CommunityModelInstallSupport = "direct" | "best-effort" | "source-only";
export type CommunityModelArtifactKind = "weights" | "code" | "dataset";

export type CommunityModelRecommendation = "recommended" | "risky" | "not-recommended";

export type CommunityModelInstallCheckStatus = "pass" | "warn" | "fail";

export type CommunityModelInstallCheck = {
  key: string;
  label: string;
  status: CommunityModelInstallCheckStatus;
  summary: string;
};

export type CommunityModelInstallPreflightStatus = "ready" | "risky" | "blocked";

export type CommunityModelInstallPreflight = {
  checkedAt: string;
  status: CommunityModelInstallPreflightStatus;
  summary: string;
  requiredDiskBytes?: number | null;
  availableDiskBytes?: number | null;
  checks: CommunityModelInstallCheck[];
};

export type CommunityModelInstallVerificationStatus = "verified" | "partial" | "missing";

export type CommunityModelInstallVerification = {
  checkedAt: string;
  status: CommunityModelInstallVerificationStatus;
  summary: string;
  installDirExists: boolean;
  installedFileCount: number;
  discoveredTargetIds: string[];
};

export type CommunityHardwareProfile = {
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemoryGb: number;
  installRoot: string;
};

export type CommunityModelCandidate = {
  id: string;
  source: CommunityModelSource;
  artifactKind: CommunityModelArtifactKind;
  label: string;
  repoId: string;
  repoUrl: string;
  summary: string;
  updatedAt?: string;
  paperUrl?: string;
  docsUrl?: string;
  parameterScale?: string;
  quantizationLabel?: string;
  recommendedContextWindow?: number | null;
  installSupport: CommunityModelInstallSupport;
  recommendation: CommunityModelRecommendation;
  recommendationReason: string;
  tags: string[];
  downloads?: number | null;
  likes?: number | null;
  stars?: number | null;
  storageSizeBytes?: number | null;
  estimatedFootprintGb?: number | null;
  installDir: string;
  preflight: CommunityModelInstallPreflight;
};

export type CommunityModelInstallJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CommunityModelInstallJob = {
  id: string;
  candidateId: string;
  source: CommunityModelSource;
  artifactKind: CommunityModelArtifactKind;
  label: string;
  repoId: string;
  repoUrl: string;
  installDir: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  status: CommunityModelInstallJobStatus;
  latestMessage?: string;
  errorMessage?: string;
  logFile?: string;
  stateFile?: string;
  launcherPid?: number | null;
  discoveredTargetIds?: string[];
  preflight?: CommunityModelInstallPreflight;
  verification?: CommunityModelInstallVerification;
  rollbackPerformed?: boolean;
  sourceScanQuery?: string;
};

export type CommunityModelDiscoverySummary = {
  generatedAt: string;
  query: string;
  hardware: CommunityHardwareProfile;
  installRoot: string;
  candidates: CommunityModelCandidate[];
  jobs: CommunityModelInstallJob[];
};
