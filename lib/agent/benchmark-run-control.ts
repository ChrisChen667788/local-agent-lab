const benchmarkRunControllers = new Map<string, AbortController>();

export function registerBenchmarkRunController(runId: string) {
  const current = benchmarkRunControllers.get(runId);
  if (current && !current.signal.aborted) {
    return current;
  }
  const controller = new AbortController();
  benchmarkRunControllers.set(runId, controller);
  return controller;
}

export function getBenchmarkRunSignal(runId: string) {
  return benchmarkRunControllers.get(runId)?.signal;
}

export function abortBenchmarkRun(runId: string) {
  const controller = benchmarkRunControllers.get(runId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort();
  return true;
}

export function clearBenchmarkRunController(runId: string) {
  benchmarkRunControllers.delete(runId);
}
