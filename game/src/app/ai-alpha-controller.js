import {
  ALPHA_RUNTIME_MESSAGE,
  analyzeAlphaPosition,
  chooseAlphaRuntimeDecision,
  chooseAlphaRuntimeAction,
} from "./ai-alpha-runtime.js";

export function createAlphaAiClient({
  workerFactory = null,
  runtime = null,
  directFallback = true,
  timeoutMs = 220,
} = {}) {
  const directRuntime = runtime || {
    analyzeAlphaPosition,
    chooseAlphaRuntimeDecision,
    chooseAlphaRuntimeAction,
  };
  let worker = null;
  let workerFailed = false;
  let nextRequestId = 1;
  let nextChoiceSequence = 1;
  let latestChoiceSequence = 0;
  let nextAnalysisSequence = 1;
  let latestAnalysisSequence = 0;
  let nextOperationSequence = 1;
  let latestOperationSequence = 0;
  let lastMode = "direct";
  let lastAnalysis = null;
  const pendingRequests = new Set();

  async function chooseAction(payload = {}, options = {}) {
    const result = await chooseActionResult(payload, options);
    return isFreshScopedResult(result) ? result.action : null;
  }

  async function chooseActionResult(payload = {}, options = {}) {
    const requestSequence = beginChoice();
    const operationSequence = beginOperation();
    const response = await requestWorker(ALPHA_RUNTIME_MESSAGE.CHOOSE_ACTION, payload, options);
    if (response?.ok) {
      return finishChoice(requestSequence, operationSequence, {
        action: response.action || null,
        analysis: response.analysis || null,
        status: "worker",
      });
    }
    if (response?.cancelled) {
      return finishChoice(requestSequence, operationSequence, {
        action: null,
        analysis: null,
        status: "cancelled",
      });
    }
    if (!directFallback) {
      return finishChoice(requestSequence, operationSequence, {
        action: null,
        analysis: null,
        status: response?.reason === "unavailable" ? "disabled" : "failed",
      });
    }
    if (directRuntime.chooseAlphaRuntimeDecision) {
      const decision = directRuntime.chooseAlphaRuntimeDecision(payload);
      const action = decision?.action || null;
      const analysis = decision?.analysis || null;
      return finishChoice(requestSequence, operationSequence, {
        action,
        analysis,
        status: action || analysis ? "direct" : "failed",
      });
    }
    const action = directRuntime.chooseAlphaRuntimeAction?.(payload) || null;
    return finishChoice(requestSequence, operationSequence, {
      action,
      analysis: null,
      status: action ? "direct" : "failed",
    });
  }

  async function analyze(payload = {}, options = {}) {
    const result = await analyzeResult(payload, options);
    return isFreshScopedResult(result) ? result.analysis : null;
  }

  async function analyzeResult(payload = {}, options = {}) {
    const requestSequence = beginAnalysis();
    const operationSequence = beginOperation();
    const response = await requestWorker(ALPHA_RUNTIME_MESSAGE.ANALYZE, payload, options);
    if (response?.ok) {
      return finishAnalysis(requestSequence, operationSequence, {
        analysis: response.analysis || null,
        status: "worker",
      });
    }
    if (response?.cancelled) {
      return finishAnalysis(requestSequence, operationSequence, {
        analysis: null,
        status: "cancelled",
      });
    }
    if (!directFallback) {
      return finishAnalysis(requestSequence, operationSequence, {
        analysis: null,
        status: response?.reason === "unavailable" ? "disabled" : "failed",
      });
    }
    const analysis = directRuntime.analyzeAlphaPosition?.(payload) || null;
    return finishAnalysis(requestSequence, operationSequence, {
      analysis,
      status: analysis ? "direct" : "failed",
    });
  }

  function beginOperation() {
    const requestSequence = nextOperationSequence++;
    latestOperationSequence = requestSequence;
    return requestSequence;
  }

  function beginChoice() {
    const requestSequence = nextChoiceSequence++;
    latestChoiceSequence = requestSequence;
    return requestSequence;
  }

  function beginAnalysis() {
    const requestSequence = nextAnalysisSequence++;
    latestAnalysisSequence = requestSequence;
    return requestSequence;
  }

  function finishChoice(requestSequence, operationSequence, result) {
    const isLatest = requestSequence === latestChoiceSequence;
    const sharedIsLatest = operationSequence === latestOperationSequence;
    if (sharedIsLatest) {
      lastMode = result.status;
      lastAnalysis = result.analysis || null;
    }
    return {
      action: result.action || null,
      analysis: result.analysis || null,
      status: result.status,
      requestSequence,
      isLatest,
      sharedIsLatest,
    };
  }

  function finishAnalysis(requestSequence, operationSequence, result) {
    const isLatest = requestSequence === latestAnalysisSequence;
    const sharedIsLatest = operationSequence === latestOperationSequence;
    if (sharedIsLatest) {
      lastMode = result.status;
      lastAnalysis = result.analysis || null;
    }
    return {
      analysis: result.analysis || null,
      status: result.status,
      requestSequence,
      isLatest,
      sharedIsLatest,
    };
  }

  function isFreshScopedResult(result) {
    return Boolean(result)
      && (result.status === "worker" || result.status === "direct")
      && result.isLatest === true
      && result.sharedIsLatest === true;
  }

  function getMode() {
    if (worker && !workerFailed) return lastMode;
    if (workerFactory && !workerFailed) return "worker-ready";
    return directFallback ? "direct" : "disabled";
  }

  function getLastRequestStatus() {
    return lastMode;
  }

  function dispose() {
    cancelPending("disposed", { disable: true });
  }

  function cancelPending(reason = "cancelled", options = {}) {
    const target = worker;
    worker = null;
    workerFailed = Boolean(options.disable);
    target?.terminate?.();
    const pending = [...pendingRequests];
    for (const cancel of pending) cancel(reason);
    lastMode = reason;
    lastAnalysis = null;
    return pending.length;
  }

  function getLastAnalysis() {
    return lastAnalysis;
  }

  function requestWorker(type, payload, options) {
    const target = ensureWorker();
    if (!target) return Promise.resolve({ ok: false, failed: true, reason: "unavailable" });
    const id = `alpha-${nextRequestId++}`;
    const message = {
      id,
      type,
      payload: workerPayload(payload),
    };
    const waitMs = Math.max(1, Number(options.timeoutMs ?? timeoutMs));
    return new Promise((resolve) => {
      let settled = false;
      let cancelRequest = null;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        target.removeEventListener?.("message", onMessage);
        target.removeEventListener?.("error", onError);
        target.removeEventListener?.("messageerror", onError);
        if (cancelRequest) pendingRequests.delete(cancelRequest);
      };
      const settle = (value) => {
        if (settled) return;
        cleanup();
        resolve(value);
      };
      const onMessage = (event) => {
        const data = event?.data || null;
        if (data?.id !== id) return;
        settle(data);
      };
      cancelRequest = (reason = "cancelled") => settle({
        id,
        type: `${type}_RESULT`,
        ok: false,
        cancelled: true,
        reason,
      });
      const failWorker = () => {
        workerFailed = true;
        if (worker === target) worker = null;
        target.terminate?.();
      };
      const onError = () => {
        failWorker();
        settle({ id, type: `${type}_RESULT`, ok: false, failed: true, reason: "worker_error" });
      };
      const timer = setTimeout(() => {
        failWorker();
        settle({ id, type: `${type}_RESULT`, ok: false, failed: true, reason: "timeout" });
      }, waitMs);
      target.addEventListener?.("message", onMessage);
      target.addEventListener?.("error", onError);
      target.addEventListener?.("messageerror", onError);
      pendingRequests.add(cancelRequest);
      try {
        target.postMessage(message);
      } catch {
        failWorker();
        settle({ id, type: `${type}_RESULT`, ok: false, failed: true, reason: "post_message_failed" });
      }
    });
  }

  function ensureWorker() {
    if (workerFailed || !workerFactory) return null;
    if (worker) return worker;
    try {
      worker = workerFactory();
      if (!worker) {
        workerFailed = true;
        worker = null;
        return null;
      }
      return worker;
    } catch {
      workerFailed = true;
      worker = null;
      return null;
    }
  }

  return {
    analyze,
    analyzeResult,
    cancelPending,
    chooseAction,
    chooseActionResult,
    dispose,
    getLastAnalysis,
    getLastRequestStatus,
    getMode,
  };
}

export function workerPayload(payload = {}) {
  const { board, ...rest } = payload || {};
  return rest;
}
