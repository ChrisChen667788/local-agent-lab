type RuntimeTracker = {
  activeRequests: number;
  activeByTarget: Record<string, number>;
  totalStarted: number;
  totalCompleted: number;
  totalFailed: number;
};

const runtimeTracker: RuntimeTracker = {
  activeRequests: 0,
  activeByTarget: {},
  totalStarted: 0,
  totalCompleted: 0,
  totalFailed: 0
};

export function beginTrackedRequest(targetId: string) {
  runtimeTracker.activeRequests += 1;
  runtimeTracker.activeByTarget[targetId] = (runtimeTracker.activeByTarget[targetId] || 0) + 1;
  runtimeTracker.totalStarted += 1;
}

export function finishTrackedRequest(targetId: string, ok: boolean) {
  runtimeTracker.activeRequests = Math.max(0, runtimeTracker.activeRequests - 1);
  runtimeTracker.activeByTarget[targetId] = Math.max(
    0,
    (runtimeTracker.activeByTarget[targetId] || 0) - 1
  );
  if (ok) {
    runtimeTracker.totalCompleted += 1;
  } else {
    runtimeTracker.totalFailed += 1;
  }
}

export function getRuntimeTrackerSnapshot() {
  return {
    activeRequests: runtimeTracker.activeRequests,
    activeByTarget: { ...runtimeTracker.activeByTarget },
    totalStarted: runtimeTracker.totalStarted,
    totalCompleted: runtimeTracker.totalCompleted,
    totalFailed: runtimeTracker.totalFailed
  };
}
