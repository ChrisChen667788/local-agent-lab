export type AgentTransport = "openai-compatible" | "anthropic";

export type AgentExecution = "local" | "remote";

export type AgentProviderProfile = "speed" | "balanced" | "tool-first";

export type AgentThinkingMode = "standard" | "thinking";

export type AgentCacheMode = "exact" | "semantic";

export type AgentBenchmarkMode = "prompt" | "dataset" | "suite";

export type AgentKnowledgeDocument = {
  id: string;
  title: string;
  source?: string;
  tags: string[];
  content: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  charCount: number;
};

export type AgentKnowledgeHit = {
  chunkId: string;
  documentId: string;
  title: string;
  source?: string;
  sectionPath: string[];
  order: number;
  content: string;
  citationLabel: string;
  score: number;
  confidence: number;
};

export type AgentRetrievalSummary = {
  query: string;
  hitCount: number;
  lowConfidence: boolean;
  topScore: number;
  usedInPrompt: boolean;
  bypassGrounding?: boolean;
  bypassReason?:
    | "general-question-no-evidence"
    | "general-question-low-confidence"
    | "repo-path-question";
  results: AgentKnowledgeHit[];
};

export type AgentGroundedVerificationVerdict =
  | "grounded"
  | "weakly-grounded"
  | "unsupported"
  | "not-applicable";

export type AgentGroundedVerificationFallbackReason =
  | "no-evidence"
  | "low-confidence"
  | "missing-citations"
  | "unsupported-claims";

export type AgentGroundedVerification = {
  enforced: boolean;
  citationRequired: boolean;
  citationsPresent: boolean;
  verdict: AgentGroundedVerificationVerdict;
  fallbackApplied: boolean;
  fallbackReason?: AgentGroundedVerificationFallbackReason;
  citedLabels: string[];
  missingLabels: string[];
  unsupportedLabels: string[];
  lexicalGroundingScore: number;
  notes: string[];
};

export type AgentBenchmarkPromptSet = {
  id: string;
  label: string;
  description: string;
  prompts: string[];
};

export type AgentBenchmarkDatasetEvaluationRule =
  | {
      kind: "choice-exact";
      answer: string;
      aliases?: string[];
    }
  | {
      kind: "keyword-match";
      keywords: string[];
      threshold?: number;
    }
  | {
      kind: "json-keys";
      keys: string[];
      exactKeys?: boolean;
    }
  | {
      kind: "line-rules";
      bulletCount?: number;
      lineCount?: number;
      keywords?: string[];
    }
  | {
      kind: "json-tool-call";
      functionName: string;
      requiredArgs: string[];
    }
  | {
      kind: "manual-review";
      note: string;
    };

export type AgentBenchmarkDatasetItem = {
  id: string;
  prompt: string;
  evaluator: AgentBenchmarkDatasetEvaluationRule;
  expectedAnswerPreview?: string;
  sourceSplit?: string;
  sourceSubset?: string;
};

export type AgentBenchmarkDataset = {
  id: string;
  label: string;
  description: string;
  sourceLabel: string;
  sourceUrl: string;
  taskCategory: string;
  scoringLabel: string;
  sampleCount: number;
  items: AgentBenchmarkDatasetItem[];
};

export type AgentBenchmarkWorkloadSummary = {
  kind: "prompt" | "prompt-set" | "dataset";
  id: string;
  label: string;
  description?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sampleCount: number;
  scorable: boolean;
};

export type AgentBenchmarkSuiteWorkload =
  | {
      kind: "prompt-set";
      promptSetId: string;
      runs?: number;
      description?: string;
    }
  | {
      kind: "dataset";
      datasetId: string;
      runs?: number;
      sampleLimit?: number;
      description?: string;
    };

export type AgentBenchmarkSuite = {
  id: string;
  label: string;
  description: string;
  reportTier: "daily" | "weekly" | "milestone" | "full";
  workloads: AgentBenchmarkSuiteWorkload[];
};

export type AgentBenchmarkProfileBatchScope = "full-suite" | "comparison-subset";

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentToolRun = {
  name: string;
  input: Record<string, unknown>;
  output: string;
};

export type AgentToolDecisionAction = "approve" | "reject";

export type AgentTarget = {
  id: string;
  label: string;
  providerLabel: string;
  transport: AgentTransport;
  execution: AgentExecution;
  description: string;
  modelEnv: string;
  modelDefault: string;
  thinkingModelEnv?: string;
  thinkingModelDefault?: string;
  baseUrlEnv: string;
  baseUrlDefault: string;
  apiKeyEnv?: string;
  supportsTools: boolean;
  recommendedContext: string;
  memoryProfile: string;
  notes: string[];
  launchHints?: string[];
};

export type AgentChatRequest = {
  targetId: string;
  input: string;
  messages: AgentMessage[];
  systemPrompt?: string;
  enableTools?: boolean;
  enableRetrieval?: boolean;
  contextWindow?: number;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  plannerEnabled?: boolean;
  memorySummary?: string;
};

export type AgentUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AgentChatResponse = {
  content: string;
  providerLabel: string;
  targetLabel: string;
  resolvedModel: string;
  resolvedBaseUrl: string;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  thinkingFallbackToStandard?: boolean;
  localFallbackUsed?: boolean;
  localFallbackTargetId?: string;
  localFallbackTargetLabel?: string;
  localFallbackReason?: string;
  toolRuns: AgentToolRun[];
  execution?: AgentExecution;
  usage?: AgentUsage;
  warning?: string;
  retrieval?: AgentRetrievalSummary;
  verification?: AgentGroundedVerification;
  cacheHit?: boolean;
  cacheMode?: AgentCacheMode;
  plannerSteps?: string[];
  memorySummary?: string;
};

export type AgentToolDecisionRequest = {
  targetId: string;
  toolName: string;
  input: Record<string, unknown>;
  confirmationToken: string;
  action: AgentToolDecisionAction;
};

export type AgentToolDecisionResponse = {
  toolRun: AgentToolRun;
};

export type AgentRuntimeStatus = {
  targetId: string;
  targetLabel: string;
  execution: AgentExecution;
  available: boolean;
  phase?: "remote" | "ready" | "busy" | "loading" | "recovering" | "offline" | "error";
  phaseDetail?: string;
  resolvedModel?: string;
  resolvedBaseUrl?: string;
  standardResolvedModel?: string;
  thinkingResolvedModel?: string | null;
  activeThinkingMode?: AgentThinkingMode;
  thinkingModelConfigured?: boolean;
  busy?: boolean;
  queueDepth?: number;
  activeRequests?: number;
  loadedAlias?: string | null;
  loadingAlias?: string | null;
  loadingElapsedMs?: number | null;
  loadingError?: string | null;
  workspaceRoot?: string;
  message?: string;
  supervisorPid?: number | null;
  supervisorAlive?: boolean;
  gatewayPid?: number | null;
  gatewayAlive?: boolean;
  restartCount?: number;
  lastStartAt?: string | null;
  lastExitAt?: string | null;
  lastExitCode?: number | null;
  lastEvent?: string | null;
  lastEnsureReason?: string | null;
  logFile?: string;
};

export type AgentRuntimeAction = "release" | "restart" | "read_log";

export type AgentRuntimeActionResponse = {
  ok: boolean;
  action: AgentRuntimeAction;
  targetId: string;
  targetLabel: string;
  message: string;
  releasedAlias?: string | null;
  logExcerpt?: string;
  logSummary?: AgentRuntimeLogSummary;
  runtime?: AgentRuntimeStatus;
};

export type AgentRuntimeLogSummary = {
  totalLines: number;
  matchedLines: number;
  errorLines: number;
  warningLines: number;
  restartMentions: number;
  loadingMentions: number;
};

export type AgentRuntimeLogResponse = {
  ok: boolean;
  targetId: string;
  targetLabel: string;
  query: string;
  limit: number;
  excerpt: string;
  summary: AgentRuntimeLogSummary;
};

export type AgentRuntimePrewarmResponse = {
  ok: boolean;
  status?: "ready" | "loading" | "queued" | "failed";
  targetId: string;
  targetLabel: string;
  loadedAlias?: string | null;
  loadMs?: number;
  warmupMs?: number;
  message: string;
};

export type AgentRuntimePrewarmAllResponse = {
  ok: boolean;
  completed: number;
  total: number;
  results: AgentRuntimePrewarmResponse[];
  message: string;
};

export type AgentMetricPercentiles = {
  p50: number;
  p95: number;
  p99: number;
};

export type AgentBenchmarkSample = {
  run: number;
  workloadId?: string;
  workloadLabel?: string;
  itemId?: string;
  firstTokenLatencyMs: number | null;
  latencyMs: number;
  completionTokens: number;
  totalTokens: number;
  tokenThroughputTps: number | null;
  outputPreview?: string;
  outputText?: string;
  score?: number | null;
  passed?: boolean | null;
  expectedAnswerPreview?: string;
  ok: boolean;
  warning?: string;
};

export type AgentBenchmarkResult = {
  targetId: string;
  targetLabel: string;
  providerLabel?: string;
  execution?: AgentExecution;
  resolvedModel: string;
  contextWindow: number;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  runs: number;
  okRuns: number;
  avgFirstTokenLatencyMs: number;
  avgLatencyMs: number;
  avgTokenThroughputTps: number;
  avgScore?: number | null;
  passRate?: number | null;
  scoredSamples?: number;
  firstTokenLatencyPercentiles: AgentMetricPercentiles;
  totalLatencyPercentiles: AgentMetricPercentiles;
  tokenThroughputPercentiles: AgentMetricPercentiles;
  samples: AgentBenchmarkSample[];
};

export type AgentBenchmarkResponse = {
  ok: boolean;
  runId?: string;
  generatedAt: string;
  benchmarkMode?: AgentBenchmarkMode;
  prompt: string;
  promptSetId?: string;
  promptSetLabel?: string;
  promptSetPromptCount?: number;
  datasetId?: string;
  datasetLabel?: string;
  datasetSourceLabel?: string;
  datasetSourceUrl?: string;
  datasetSampleCount?: number;
  suiteId?: string;
  suiteLabel?: string;
  suiteWorkloadCount?: number;
  workloads?: AgentBenchmarkWorkloadSummary[];
  contextWindow: number;
  runs: number;
  providerProfile?: AgentProviderProfile;
  thinkingMode?: AgentThinkingMode;
  profileBatchScope?: AgentBenchmarkProfileBatchScope;
  profileModes?: Array<{
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
  }>;
  comparisonsToLast?: Array<{
    targetId: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    resolvedModel: string;
    previousGeneratedAt?: string;
    previousSuccessRate?: number | null;
    currentSuccessRate: number;
    deltaSuccessRate?: number | null;
    deltaFirstTokenLatencyMs?: number | null;
    deltaLatencyMs?: number | null;
    deltaTokenThroughputTps?: number | null;
  }>;
  results: AgentBenchmarkResult[];
};

export type AgentBenchmarkProgress = {
  runId: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped" | "abandoned";
  benchmarkMode?: AgentBenchmarkMode;
  suiteId?: string;
  suiteLabel?: string;
  profileBatchScope?: AgentBenchmarkProfileBatchScope;
  totalGroups: number;
  completedGroups: number;
  totalSamples: number;
  completedSamples: number;
  okSamples: number;
  failedSamples: number;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  lastCompletedTargetLabel?: string;
  lastCompletedProfile?: AgentProviderProfile;
  lastCompletedThinkingMode?: AgentThinkingMode;
  lastCompletedWorkloadLabel?: string;
  activeGroups?: Array<{
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    sampleCount?: number;
    startedAt?: string;
    completedAt?: string;
  }>;
  pendingGroups?: Array<{
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    sampleCount?: number;
    startedAt?: string;
    completedAt?: string;
  }>;
  recentGroups?: Array<{
    key: string;
    targetLabel: string;
    providerProfile: AgentProviderProfile;
    thinkingMode: AgentThinkingMode;
    execution?: AgentExecution;
    sampleCount?: number;
    startedAt?: string;
    completedAt?: string;
  }>;
  localPrewarm?: {
    targetId: string;
    targetLabel: string;
    phase:
      | "releasing-runtime"
      | "ensuring-gateway"
      | "prewarming"
      | "waiting-load"
      | "waiting-gateway"
      | "restarting-gateway";
    message?: string;
    loadingAlias?: string | null;
    lastRecoveryAction?: string;
    lastRecoveryAt?: string;
    startedAt?: string;
    updatedAt?: string;
    elapsedMs?: number | null;
  };
  workerHeartbeatAt?: string;
  workerPid?: number;
  workerPhase?: string;
  controlAction?: "stop-requested" | "abandon-requested";
  controlRequestedAt?: string;
  controlMessage?: string;
  error?: string;
};

export type AgentBenchmarkBaseline = AgentBenchmarkResponse & {
  kind: "benchmark-baseline";
  id: string;
  savedAt: string;
  label?: string;
  isDefault?: boolean;
};

export type AgentConnectionCheckStageId = "models" | "chat" | "tool_calls";

export type AgentConnectionCheckStage = {
  id: AgentConnectionCheckStageId;
  ok: boolean;
  latencyMs: number;
  summary: string;
  httpStatus?: number;
};

export type AgentConnectionCheckResponse = {
  ok: boolean;
  targetId: string;
  targetLabel: string;
  providerLabel: string;
  resolvedBaseUrl: string;
  resolvedModel: string;
  checkedAt: string;
  docsUrl?: string;
  stages: AgentConnectionCheckStage[];
};

export type ResolvedTarget = AgentTarget & {
  resolvedBaseUrl: string;
  resolvedModel: string;
  resolvedApiKey?: string;
};

export type OpenAICompatibleToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ProviderReply = {
  content: string;
  toolCalls: OpenAICompatibleToolCall[];
  toolRuns: AgentToolRun[];
  usage?: AgentUsage;
  warning?: string;
};
