import { createAlphaAiClient } from "./ai-alpha-controller.js";
import { summarizeAlphaRuntimeDecision } from "./ai-alpha-runtime.js";
import {
  alphaModelEnvironmentFingerprint,
  validateAlphaModelEnvironment,
  validateAlphaModelFeatureContract,
  validateReleasedAlphaModelArtifact,
} from "./ai-alpha-model.js";
import { alphaSpatialFeatureContract } from "./ai-alpha-spatial.js";
import { validateLocalAlphaPreviewModel } from "./ai-alpha-preview.js?v=20260714-local-preview-1";
import { summarizeSituationAwareness } from "./ai-situation.js";
import { alphaTrainingFeatureContract } from "./ai-alpha-training.js";

export const DEFAULT_ALPHA_BROWSER_SEARCH = Object.freeze({
  iterations: 6,
  maxDepth: 1,
  actionLimit: 6,
  preApplyLimit: 18,
  timeBudgetMs: 45,
  responsePaddingMs: 160,
  progressInterval: 2,
  progressLimit: 3,
  modelPolicyWeight: 2.4,
});
export const DEFAULT_ALPHA_BROWSER_GENERIC_SEARCH = Object.freeze({
  engine: "generic-alpha-v1",
  simulations: 4,
  maxDepth: 1,
  actionLimit: 32,
  exploration: 1.35,
  policyTemperature: 1,
  timeBudgetMs: 2500,
  responsePaddingMs: 500,
});
export const DEFAULT_ALPHA_BROWSER_MODEL_VALIDATION = Object.freeze({
  minSuiteGames: 2,
  minSuiteSides: 2,
  minAnalyzedActions: 1,
  minAverageRootVisits: 1,
  minTrainingSamples: 1,
  minTrainingValueSamples: 1,
  minTrainingOutcomeClasses: 1,
  minTrainingPolicyRows: 1,
  minTrainingPolicyActionTypes: 1,
  minTrainingUniqueStateHashes: 1,
  minTrainingSides: 1,
  minTrainingSources: 1,
});
const DEFAULT_ALPHA_BROWSER_CACHE_ENTRIES = 8;
const DEFAULT_ALPHA_ANALYSIS_SCHEDULER_INTERVAL_MS = 250;
const BROWSER_ALPHA_OPERATION_SEQUENCES = new WeakMap();
const DEFERRED_BROWSER_ALPHA_RESULT_OPERATIONS = new WeakMap();
const ALPHA_MODEL_STATUS_LABELS = Object.freeze({
  invalid_alpha_model: "waiting for released model",
  missing_release_metadata: "missing release gate",
  model_not_promoted: "model not promoted",
  missing_release_source_artifact: "missing source artifact",
  missing_release_source_hash: "missing source hash",
  release_errors_exceed_limit: "release errors exceed limit",
  promotion_verdict_failed: "promotion verdict failed",
  candidate_score_below_threshold: "candidate score too low",
  candidate_side_score_below_threshold: "side score too low",
  candidate_score_lower_bound_below_threshold: "score lower bound too low",
  candidate_elo_lower_bound_below_threshold: "Elo lower bound too low",
  evaluation_suite_not_explicit: "evaluation suite not explicit",
  evaluation_suite_too_small: "evaluation suite too small",
  evaluation_suite_side_coverage_too_narrow: "evaluation side coverage too narrow",
  evaluation_suite_phase_coverage_too_narrow: "evaluation phase coverage too narrow",
  evaluation_suite_fixed_positions_too_few: "too few fixed positions",
  evaluation_suite_challenge_positions_too_few: "too few challenge positions",
  missing_challenge_quality_evidence: "missing challenge quality",
  challenge_average_uncertainty_too_low: "challenge uncertainty too low",
  challenge_contested_positions_too_few: "too few contested challenges",
  challenge_average_runtime_risk_too_low: "challenge runtime risk too low",
  challenge_runtime_risk_positions_too_few: "too few runtime-risk challenges",
  missing_decision_evidence: "missing decision evidence",
  decision_evidence_too_few_analyzed_actions: "too few analyzed decisions",
  decision_evidence_root_visits_too_low: "decision search visits too low",
  decision_evidence_action_coverage_too_narrow: "decision action coverage too narrow",
  decision_evidence_confidence_too_low: "decision confidence too low",
  decision_evidence_uncertainty_too_high: "decision uncertainty too high",
  candidate_decision_evidence_action_coverage_too_narrow: "candidate action coverage too narrow",
  missing_training_data_evidence: "missing training evidence",
  training_samples_too_few: "too few training samples",
  training_value_samples_too_few: "too few value samples",
  training_outcome_coverage_too_narrow: "training outcome coverage too narrow",
  training_policy_rows_too_few: "too few policy rows",
  training_policy_action_coverage_too_narrow: "training action coverage too narrow",
  training_unique_states_too_few: "too few unique states",
  training_duplicate_state_rate_too_high: "training duplicate rate too high",
  training_side_coverage_too_narrow: "training side coverage too narrow",
  training_sources_too_few: "too few training sources",
  training_reanalysis_samples_too_few: "too few reanalysis samples",
  training_state_snapshots_too_few: "too few state snapshots",
  training_root_visits_too_low: "training search visits too low",
  training_selected_action_share_too_low: "training selection share too low",
  training_exploration_share_too_low: "training exploration share too low",
  missing_training_validation_evidence: "missing holdout evidence",
  training_validation_samples_too_few: "too few holdout samples",
  training_validation_side_coverage_too_narrow: "holdout side coverage too narrow",
  training_validation_phase_coverage_too_narrow: "holdout phase coverage too narrow",
  training_validation_groups_too_few: "too few holdout groups",
  training_validation_group_by_mismatch: "holdout grouping mismatch",
  unsupported_training_validation_group_by: "unsupported holdout grouping",
  training_validation_value_mse_too_high: "value holdout error too high",
  training_validation_value_calibration_bias_too_high: "value calibration bias too high",
  training_validation_policy_cross_entropy_too_high: "policy holdout error too high",
  training_validation_policy_top_choice_accuracy_too_low: "policy holdout accuracy too low",
  missing_model_environment: "missing environment fingerprint",
  model_environment_mismatch: "environment mismatch",
  missing_model_feature_contract: "missing feature contract",
  model_feature_contract_mismatch: "feature contract mismatch",
  model_spatial_contract_mismatch: "spatial board contract mismatch",
});

export function alphaModelStatusReasonLabel(reason) {
  return ALPHA_MODEL_STATUS_LABELS[reason] || String(reason || "unavailable");
}

export function browserAlphaRuntimeMode({
  modelStatus = null,
  modelLoad = null,
} = {}) {
  if (modelStatus?.ok === true && modelStatus?.validationMode === "local_preview") {
    if (
      modelLoad?.status === "preview"
      && modelLoad?.previewId
      && modelLoad.previewId === modelStatus.previewId
    ) {
      return {
        mode: "validated_preview_model",
        reason: null,
        sourceHash: modelStatus.candidateFingerprint || null,
        previewId: modelStatus.previewId,
      };
    }
    return {
      mode: "load_failed",
      reason: "preview_load_context_missing",
      sourceHash: null,
    };
  }
  if (modelStatus?.ok === true) {
    return {
      mode: "validated_model",
      reason: null,
      sourceHash: modelStatus.sourceHash || null,
    };
  }
  const loadStatus = modelLoad?.status || "missing";
  if (loadStatus === "failed" || loadStatus === "loaded" || loadStatus === "preview") {
    return {
      mode: "load_failed",
      reason: loadStatus === "failed"
        ? modelLoad?.reason || modelStatus?.reason || "model_load_failed"
        : modelStatus?.reason || modelLoad?.reason || "model_load_failed",
      sourceHash: null,
    };
  }
  return {
    mode: "heuristic_fallback",
    reason: "model_missing",
    sourceHash: null,
  };
}

export function createBrowserAlphaAi({
  rawModel = null,
  scenario = null,
  rules = null,
  workerFactory = null,
  timeoutMs = 90,
  logger = console,
  cacheEntries = DEFAULT_ALPHA_BROWSER_CACHE_ENTRIES,
  modelValidationOptions = DEFAULT_ALPHA_BROWSER_MODEL_VALIDATION,
  previewValidationOptions = null,
  previewModelValidator = validateLocalAlphaPreviewModel,
} = {}) {
  const client = createAlphaAiClient({
    workerFactory,
    directFallback: false,
    timeoutMs,
  });
  const analysisClient = createAlphaAiClient({
    workerFactory,
    directFallback: true,
    timeoutMs,
  });
  const expectedEnvironment = modelValidationOptions.expectedEnvironment
    || alphaModelEnvironmentFingerprint({ scenario, rules });
  const expectedFeatureContract = modelValidationOptions.expectedFeatureContract
    || alphaTrainingFeatureContract();
  const expectedSpatialContract = modelValidationOptions.expectedSpatialContract
    || (scenario ? alphaSpatialFeatureContract(scenario) : null);
  const validation = previewValidationOptions
    ? previewModelValidator(rawModel, {
      ...previewValidationOptions,
      expectedEnvironment,
      expectedFeatureContract,
      expectedSpatialContract,
    })
    : validateReleasedAlphaModelArtifact(rawModel, {
      ...modelValidationOptions,
      expectedEnvironment,
      expectedFeatureContract,
      expectedSpatialContract,
    });
  const environmentValidation = validation.environment
    || validateAlphaModelEnvironment(validation.model || rawModel, expectedEnvironment, {
      requireEnvironmentFingerprint: modelValidationOptions.requireEnvironmentFingerprint,
    });
  const featureContractValidation = validation.featureContract
    || validateAlphaModelFeatureContract(validation.model || rawModel, expectedFeatureContract, {
      requireFeatureContract: modelValidationOptions.requireFeatureContract,
    });
  const validationWithEnvironment = {
    ...validation,
    environment: environmentValidation,
    featureContract: featureContractValidation,
  };
  const model = validation.ok ? validation.model : null;
  const modelStatus = summarizeBrowserAlphaModelValidation(validationWithEnvironment);
  if (rawModel && !validation.ok) {
    logger?.warn?.("Ignoring untrusted Alpha AI model; falling back to scripted AI weights.", validation.reason);
  }
  return {
    client,
    analysisClient,
    model,
    modelValidation: validationWithEnvironment,
    modelStatus,
    analysisCache: createBrowserAlphaAnalysisCache({ maxEntries: cacheEntries }),
    lastAnalysisMeta: null,
    lastAnalysis: null,
    lastSummary: null,
  };
}

export async function chooseBrowserAlphaAction({
  alpha = null,
  scenario = null,
  rules = null,
  state = null,
  side = null,
  legalActions = null,
  searchOptions = {},
  browserOperationSequence = undefined,
  logger = console,
} = {}) {
  if (!alpha || !state || !scenario || !rules) return null;
  const operationSequence = resolveBrowserAlphaOperationSequence(alpha, browserOperationSequence);
  if (operationSequence === null) return null;
  let hasScopedChoice = false;
  try {
    const options = buildBrowserAlphaSearchOptions({
      model: alpha.model,
      side,
      searchOptions,
    });
    const useCache = options.useCache !== false;
    const cacheKey = useCache
      ? browserAlphaAnalysisCacheKey({
        scenario,
        rules,
        state,
        side,
        model: alpha.model,
        searchOptions: options,
      })
      : null;
    const cached = useCache ? getBrowserAlphaCachedAnalysis(alpha, cacheKey) : null;
    if (cached?.analysis) {
      if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
      updateBrowserAlphaSummary(alpha, cached.analysis, { cacheHit: true, cacheKey });
      const selection = selectBrowserAlphaLegalActionDecision({
        analysis: cached.analysis,
        legalActions,
        logger,
      });
      recordBrowserAlphaLegalSelection(alpha, selection);
      return selection.action;
    }
    if (!alpha.client?.chooseActionResult && !alpha.client?.chooseAction) return null;
    const payload = {
      scenario,
      rules,
      state,
      model: alpha.model,
      searchOptions: options,
    };
    const requestOptions = {
      timeoutMs: browserAlphaTimeoutMs(options),
    };
    hasScopedChoice = typeof alpha.client.chooseActionResult === "function";
    const scopedResult = hasScopedChoice
      ? await alpha.client.chooseActionResult(payload, requestOptions)
      : null;
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    const scopedSuccess = hasScopedChoice
      && scopedResult
      && (scopedResult.status === "worker" || scopedResult.status === "direct")
      && scopedResult.isLatest === true
      && scopedResult.sharedIsLatest === true;
    if (hasScopedChoice && !scopedSuccess) {
      const currentFailure = scopedResult?.isLatest === true
        && scopedResult?.sharedIsLatest === true
        && (scopedResult.status === "cancelled"
          || scopedResult.status === "failed"
          || scopedResult.status === "disabled");
      if (currentFailure) {
        clearBrowserAlphaChoiceState(alpha);
      }
      return null;
    }
    const action = hasScopedChoice
      ? scopedResult.action || null
      : await alpha.client.chooseAction(payload, requestOptions);
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    const analysis = hasScopedChoice
      ? scopedResult.analysis || null
      : alpha.client.getLastAnalysis?.() || null;
    if (!hasScopedChoice && !action && isCancelledBrowserAlphaClient(alpha.client)) return null;
    const fallbackAnalysis = hasScopedChoice || analysis
      ? null
      : await fallbackBrowserAlphaAnalysis(alpha, payload, options);
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    if (hasScopedChoice && !action && !analysis) {
      clearBrowserAlphaChoiceState(alpha);
      return null;
    }
    updateBrowserAlphaSummary(alpha, analysis || fallbackAnalysis, {
      cacheHit: false,
      cacheKey: fallbackAnalysis ? null : cacheKey,
    });
    const selection = selectBrowserAlphaLegalActionDecision({
      action,
      analysis: alpha.lastAnalysis,
      legalActions,
      logger,
    });
    recordBrowserAlphaLegalSelection(alpha, selection);
    return selection.action;
  } catch (error) {
    logger?.warn?.("Alpha AI analysis failed; falling back to scripted AI.", error);
    return null;
  }
}

export async function chooseBrowserAlphaGameActionPath({
  adapter = null,
  adapterContext = {},
  browserChooser = chooseBrowserAlphaAction,
  browserContext = {},
  onRecommendation = null,
  logger = console,
} = {}) {
  if (adapter !== null && adapter !== undefined) {
    if (typeof adapter.chooseAction !== "function") {
      logger?.warn?.("Alpha AI adapter is present but has no callable chooseAction.");
      try {
        onRecommendation?.(null);
      } catch (error) {
        logger?.warn?.("Alpha AI recommendation event failed.", error);
      }
      return null;
    }
    let recommendation = null;
    try {
      recommendation = await adapter.chooseAction(adapterContext);
    } catch (error) {
      logger?.warn?.("Alpha AI adapter choice failed; using scripted fallback.", error);
    }
    try {
      onRecommendation?.(recommendation);
    } catch (error) {
      logger?.warn?.("Alpha AI recommendation event failed.", error);
    }
    return recommendation?.ok && recommendation.action ? recommendation.action : null;
  }
  if (typeof browserChooser !== "function") return null;
  try {
    return await browserChooser(browserContext) || null;
  } catch (error) {
    logger?.warn?.("Alpha AI compatibility choice failed; using scripted fallback.", error);
    return null;
  }
}

export async function analyzeBrowserAlphaPosition({
  alpha = null,
  scenario = null,
  rules = null,
  state = null,
  side = null,
  searchOptions = {},
  deferCommit = false,
  browserOperationSequence = undefined,
  logger = console,
} = {}) {
  if ((!alpha?.client?.analyzeResult && !alpha?.client?.analyze) || !state || !scenario || !rules) return null;
  const operationSequence = resolveBrowserAlphaOperationSequence(alpha, browserOperationSequence);
  if (operationSequence === null) return null;
  try {
    const options = buildBrowserAlphaSearchOptions({
      model: alpha.model,
      side,
      searchOptions,
    });
    const useCache = options.useCache !== false;
    const cacheKey = useCache
      ? browserAlphaAnalysisCacheKey({
        scenario,
        rules,
        state,
        side,
        model: alpha.model,
        searchOptions: options,
      })
      : null;
    const cached = useCache ? getBrowserAlphaCachedAnalysis(alpha, cacheKey) : null;
    if (cached?.analysis) {
      if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
      const summary = summarizeBrowserAlphaAnalysis(cached.analysis, {
        modelStatus: alpha.modelStatus,
        cache: { hit: true },
      });
      if (!deferCommit) updateBrowserAlphaSummary(alpha, cached.analysis, { cacheHit: true, cacheKey });
      const result = {
        analysis: deferCommit ? cached.analysis : alpha.lastAnalysis,
        summary: deferCommit ? summary : alpha.lastSummary,
      };
      return deferCommit
        ? stampDeferredBrowserAlphaResult(result, alpha, operationSequence)
        : result;
    }
    const payload = {
      scenario,
      rules,
      state,
      model: alpha.model,
      searchOptions: options,
    };
    const requestOptions = {
      timeoutMs: browserAlphaTimeoutMs(options),
    };
    const hasScopedAnalysis = typeof alpha.client.analyzeResult === "function";
    const scopedResult = hasScopedAnalysis
      ? await alpha.client.analyzeResult(payload, requestOptions)
      : null;
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    const scopedFresh = hasScopedAnalysis
      && scopedResult
      && scopedResult.isLatest === true
      && scopedResult.sharedIsLatest === true;
    const scopedSuccess = scopedFresh
      && (scopedResult.status === "worker" || scopedResult.status === "direct")
      && scopedResult.analysis;
    if (hasScopedAnalysis && !scopedSuccess) {
      const currentFailure = scopedFresh
        && (scopedResult.status === "cancelled"
          || scopedResult.status === "failed"
          || scopedResult.status === "disabled"
          || ((scopedResult.status === "worker" || scopedResult.status === "direct")
            && !scopedResult.analysis));
      if (currentFailure) clearBrowserAlphaChoiceState(alpha);
      return null;
    }
    const analysis = hasScopedAnalysis
      ? scopedResult.analysis
      : await alpha.client.analyze(payload, requestOptions);
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    if (!hasScopedAnalysis && !analysis && isCancelledBrowserAlphaClient(alpha.client)) return null;
    const fallbackAnalysis = hasScopedAnalysis || analysis
      ? null
      : await fallbackBrowserAlphaAnalysis(alpha, payload, options);
    if (!isLatestBrowserAlphaOperation(alpha, operationSequence)) return null;
    const resolvedAnalysis = analysis || fallbackAnalysis;
    if (!resolvedAnalysis) return null;
    if (deferCommit) {
      return stampDeferredBrowserAlphaResult({
        analysis: resolvedAnalysis,
        summary: summarizeBrowserAlphaAnalysis(resolvedAnalysis, {
          modelStatus: alpha.modelStatus,
          cache: cacheKey && !fallbackAnalysis ? { hit: false } : null,
        }),
      }, alpha, operationSequence);
    }
    updateBrowserAlphaSummary(alpha, resolvedAnalysis, {
      cacheHit: false,
      cacheKey: fallbackAnalysis ? null : cacheKey,
    });
    return alpha.lastAnalysis
      ? {
        analysis: alpha.lastAnalysis,
        summary: alpha.lastSummary,
      }
      : null;
  } catch (error) {
    logger?.warn?.("Alpha AI analysis failed.", error);
    return null;
  }
}

export function createBrowserAlphaAnalysisScheduler({
  analyze = analyzeBrowserAlphaPosition,
  minIntervalMs = DEFAULT_ALPHA_ANALYSIS_SCHEDULER_INTERVAL_MS,
  defaultSearchOptions = {},
  now = () => Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout?.(callback, delay),
  clearTimer = (timerId) => globalThis.clearTimeout?.(timerId),
  onResult = null,
  onDiscard = null,
  onError = null,
} = {}) {
  let timer = null;
  let queued = null;
  let inFlight = false;
  let inFlightKey = null;
  let lastStartedAt = 0;
  let lastCompletedKey = null;
  let lastDiscarded = null;
  let discardedResults = 0;
  let requestId = 0;

  function request(context = {}) {
    const job = makeScheduledAlphaAnalysisJob(context, {
      defaultSearchOptions,
      requestId: requestId + 1,
    });
    if (!job.key) return { scheduled: false, reason: "missing_position_key", key: null };
    if (!context.force && (job.key === lastCompletedKey || job.key === inFlightKey || job.key === queued?.key)) {
      return { scheduled: false, reason: "duplicate_position", key: job.key };
    }
    job.browserOperationSequence = beginBrowserAlphaOperation(job.alpha);
    requestId += 1;
    job.id = requestId;
    queued = job;
    schedule();
    return { scheduled: true, reason: "scheduled", key: job.key };
  }

  function schedule() {
    if (timer || inFlight || !queued) return;
    const delay = Math.max(0, Math.ceil(Number(minIntervalMs || 0) - (Number(now()) - lastStartedAt)));
    timer = setTimer(run, delay);
  }

  async function run() {
    timer = null;
    if (!queued || inFlight) return null;
    const job = queued;
    queued = null;
    inFlight = true;
    inFlightKey = job.key;
    lastStartedAt = Number(now());
    try {
      if (job.id !== requestId || !isScheduledBrowserAlphaOperationCurrent(job)) {
        discardResult(null, job, job.id !== requestId ? "stale_position" : "stale_browser_operation");
        return null;
      }
      const result = await analyze({
        alpha: job.alpha,
        scenario: job.scenario,
        rules: job.rules,
        state: job.state,
        side: job.side,
        legalActions: job.legalActions,
        searchOptions: job.searchOptions,
        deferCommit: true,
        browserOperationSequence: job.browserOperationSequence,
        logger: job.logger,
      });
      const requestIsCurrent = job.id === requestId;
      const operationIsCurrent = isScheduledBrowserAlphaOperationCurrent(job);
      const deferredResultIsCurrent = isCurrentDeferredBrowserAlphaResult(result, job);
      if (result && requestIsCurrent && operationIsCurrent && deferredResultIsCurrent) {
        lastCompletedKey = job.key;
        onResult?.(result, job);
      } else if (result || !requestIsCurrent || !operationIsCurrent || !deferredResultIsCurrent) {
        discardResult(
          result,
          job,
          !requestIsCurrent ? "stale_position" : "stale_browser_operation",
        );
      }
      return result;
    } catch (error) {
      const requestIsCurrent = job.id === requestId;
      const operationIsCurrent = isScheduledBrowserAlphaOperationCurrent(job);
      if (!requestIsCurrent || !operationIsCurrent) {
        discardResult(
          null,
          job,
          !requestIsCurrent ? "stale_position" : "stale_browser_operation",
        );
        return null;
      }
      onError?.(error, job);
      return null;
    } finally {
      inFlight = false;
      inFlightKey = null;
      schedule();
    }
  }

  function discardResult(result, job, reason) {
    discardedResults += 1;
    lastDiscarded = summarizeDiscardedAlphaAnalysis(job, {
      reason,
      latestRequestId: requestId,
      queuedKey: queued?.key || null,
      result,
    });
    try {
      onDiscard?.(result, job, lastDiscarded);
    } catch {
      // A stale-result observer must not reactivate the discarded job through onError.
    }
  }

  function cancel() {
    if (timer) clearTimer?.(timer);
    timer = null;
    queued = null;
    requestId += 1;
  }

  function status() {
    return {
      scheduled: Boolean(timer || queued),
      inFlight,
      queuedKey: queued?.key || null,
      inFlightKey,
      lastCompletedKey,
      lastDiscarded: lastDiscarded ? { ...lastDiscarded } : null,
      discardedResults,
    };
  }

  return {
    request,
    cancel,
    status,
  };
}

export function createBrowserAlphaRealtimeAdvisor({
  alpha = null,
  scenario = null,
  rules = null,
  getState = null,
  getSide = null,
  getLegalActions = null,
  searchOptions = {},
  analyze = analyzeBrowserAlphaPosition,
  minIntervalMs = DEFAULT_ALPHA_ANALYSIS_SCHEDULER_INTERVAL_MS,
  now = () => Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout?.(callback, delay),
  clearTimer = (timerId) => globalThis.clearTimeout?.(timerId),
  onSnapshot = null,
  onResult = null,
  onDiscard = null,
  onError = null,
  logger = console,
} = {}) {
  let lastContext = null;
  let lastSnapshot = null;
  let lastAnalysis = null;
  let lastSummary = null;
  const scheduler = createBrowserAlphaAnalysisScheduler({
    analyze,
    minIntervalMs,
    defaultSearchOptions: searchOptions,
    now,
    setTimer,
    clearTimer,
    onResult(result, job) {
      const acceptedAnalysis = result?.analysis || result;
      const acceptedSummary = acceptedAnalysis && job.alpha
        ? updateBrowserAlphaSummary(job.alpha, acceptedAnalysis, {
            cacheHit: false,
            cacheKey: job.key,
          })
        : result?.summary || null;
      const snapshot = publishSnapshot(job, {
        analysis: acceptedAnalysis,
        summary: acceptedSummary,
        schedulerStatus: {
          ...scheduler.status(),
          inFlight: false,
          inFlightKey: null,
        },
        reason: "analysis_result",
      });
      onResult?.(result, job, snapshot);
    },
    onDiscard(result, job, discard) {
      const supersededByBrowserOperation = !isScheduledBrowserAlphaOperationCurrent(job);
      const supersededByQueuedPosition = discard?.reason === "stale_position"
        && Boolean(discard?.queuedKey);
      if (
        discard?.reason === "stale_browser_operation"
        || supersededByBrowserOperation
        || supersededByQueuedPosition
      ) {
        onDiscard?.(result, job, discard, null);
        return;
      }
      const snapshot = publishSnapshot(job, {
        analysis: lastAnalysis,
        summary: lastSummary,
        stale: true,
        reason: "analysis_discarded",
      });
      onDiscard?.(result, job, discard, snapshot);
    },
    onError(error, job) {
      const snapshot = publishSnapshot(job || lastContext || resolveContext(), {
        schedulerStatus: {
          ...scheduler.status(),
          inFlight: false,
          inFlightKey: null,
        },
        reason: "analysis_error",
      });
      onError?.(error, job, snapshot);
    },
  });

  function resolveContext(context = {}) {
    const resolvedAlpha = context.alpha || alpha;
    const resolvedScenario = context.scenario || scenario;
    const resolvedRules = context.rules || rules;
    const providerContext = {
      alpha: resolvedAlpha,
      scenario: resolvedScenario,
      rules: resolvedRules,
    };
    const rawState = context.state !== undefined
      ? context.state
      : browserAlphaProviderValue(getState, providerContext);
    const state = stableCopy(rawState);
    const side = context.side !== undefined
      ? context.side
      : browserAlphaProviderValue(getSide, {
        ...providerContext,
        state,
      });
    const rawLegalActions = context.legalActions !== undefined
      ? context.legalActions
      : browserAlphaProviderValue(getLegalActions, {
        ...providerContext,
        state,
        side,
      });
    return {
      alpha: resolvedAlpha,
      scenario: resolvedScenario,
      rules: resolvedRules,
      state,
      side,
      legalActions: Array.isArray(rawLegalActions) ? stableCopy(rawLegalActions) : rawLegalActions || null,
      searchOptions: {
        ...(context.searchOptions || {}),
      },
      logger: context.logger || logger,
    };
  }

  function publishSnapshot(context = {}, options = {}) {
    const resolved = context?.state !== undefined ? context : resolveContext(context);
    if (Object.prototype.hasOwnProperty.call(options, "analysis")) {
      lastAnalysis = options.analysis || null;
    }
    if (Object.prototype.hasOwnProperty.call(options, "summary")) {
      lastSummary = options.summary || null;
    }
    lastContext = resolved;
    lastSnapshot = createBrowserAlphaUiSnapshot({
      alpha: resolved.alpha,
      analysis: Object.prototype.hasOwnProperty.call(options, "analysis") ? options.analysis : lastAnalysis,
      summary: Object.prototype.hasOwnProperty.call(options, "summary") ? options.summary : lastSummary,
      legalActions: resolved.legalActions,
      schedulerStatus: options.schedulerStatus || scheduler.status(),
      side: resolved.side,
      state: resolved.state,
      pending: Boolean(options.pending),
      stale: Boolean(options.stale),
      logger: resolved.logger,
    });
    onSnapshot?.(lastSnapshot, {
      reason: options.reason || null,
      context: resolved,
    });
    return lastSnapshot;
  }

  function request(context = {}) {
    const resolved = resolveContext(context);
    lastContext = resolved;
    const requestResult = scheduler.request(resolved);
    const snapshot = publishSnapshot(resolved, {
      pending: requestResult.scheduled || scheduler.status().inFlight,
      reason: requestResult.reason,
    });
    return {
      ...requestResult,
      snapshot,
    };
  }

  function snapshot(context = {}, options = {}) {
    const resolved = Object.keys(context || {}).length ? resolveContext(context) : (lastContext || resolveContext());
    return publishSnapshot(resolved, options);
  }

  function cancel() {
    scheduler.cancel();
    const activeAlpha = lastContext?.alpha || alpha;
    activeAlpha?.client?.cancelPending?.("cancelled");
    activeAlpha?.analysisClient?.cancelPending?.("cancelled");
    return publishSnapshot(lastContext || resolveContext(), {
      reason: "cancelled",
    });
  }

  return {
    request,
    snapshot,
    cancel,
    status: scheduler.status,
    scheduler,
    get lastSnapshot() {
      return lastSnapshot;
    },
    get lastContext() {
      return lastContext;
    },
    get lastAnalysis() {
      return lastAnalysis;
    },
    get lastSummary() {
      return lastSummary;
    },
  };
}

export function createBrowserAlphaGameAdapter({
  advisor = null,
  alpha = null,
  scenario = null,
  rules = null,
  getState = null,
  getSide = null,
  getLegalActions = null,
  applyAction = null,
  canApplyAction = null,
  onApplied = null,
  onRejected = null,
  logger = console,
  ...advisorOptions
} = {}) {
  const realtimeAdvisor = advisor || createBrowserAlphaRealtimeAdvisor({
    alpha,
    scenario,
    rules,
    getState,
    getSide,
    getLegalActions,
    logger,
    ...advisorOptions,
  });

  function resolveContext(context = {}) {
    const resolvedAlpha = context.alpha || alpha || realtimeAdvisor.lastContext?.alpha || null;
    const resolvedScenario = context.scenario || scenario || realtimeAdvisor.lastContext?.scenario || null;
    const resolvedRules = context.rules || rules || realtimeAdvisor.lastContext?.rules || null;
    const providerContext = {
      alpha: resolvedAlpha,
      scenario: resolvedScenario,
      rules: resolvedRules,
    };
    const state = stableCopy(context.state !== undefined
      ? context.state
      : browserAlphaProviderValue(getState, providerContext) ?? realtimeAdvisor.lastContext?.state ?? null);
    const side = context.side !== undefined
      ? context.side
      : browserAlphaProviderValue(getSide, {
        ...providerContext,
        state,
      }) ?? realtimeAdvisor.lastContext?.side ?? null;
    const rawLegalActions = context.legalActions !== undefined
      ? context.legalActions
      : browserAlphaProviderValue(getLegalActions, {
        ...providerContext,
        state,
        side,
      }) ?? realtimeAdvisor.lastContext?.legalActions ?? null;
    return {
      alpha: resolvedAlpha,
      scenario: resolvedScenario,
      rules: resolvedRules,
      state,
      side,
      legalActions: Array.isArray(rawLegalActions) ? stableCopy(rawLegalActions) : rawLegalActions || null,
      logger: context.logger || logger,
      searchOptions: context.searchOptions || {},
    };
  }

  function request(context = {}) {
    return realtimeAdvisor.request(resolveContext(context));
  }

  function snapshot(context = {}, options = {}) {
    return realtimeAdvisor.snapshot(resolveContext(context), options);
  }

  function recommend(context = {}) {
    const resolved = resolveContext(context);
    const analysis = realtimeAdvisor.lastAnalysis || resolved.alpha?.lastAnalysis || null;
    const rawSelection = analysis && Array.isArray(resolved.legalActions)
      ? selectBrowserAlphaLegalActionDecision({
        analysis,
        legalActions: resolved.legalActions,
        logger: resolved.logger,
      })
      : null;
    const nextSnapshot = createBrowserAlphaUiSnapshot({
      alpha: resolved.alpha,
      analysis,
      summary: realtimeAdvisor.lastSummary || resolved.alpha?.lastSummary || null,
      legalSelection: rawSelection || undefined,
      legalActions: resolved.legalActions,
      schedulerStatus: realtimeAdvisor.status(),
      side: resolved.side,
      state: resolved.state,
      logger: resolved.logger,
    });
    return {
      schema: "zizi-el-alamein-alpha-game-recommendation-v1",
      ok: Boolean(nextSnapshot.action?.canApply && rawSelection?.action),
      reason: nextSnapshot.action?.reason || null,
      action: rawSelection?.action || null,
      snapshot: nextSnapshot,
      legalSelection: rawSelection ? summarizeBrowserAlphaLegalSelection(rawSelection) : null,
      context: {
        side: resolved.side || null,
        turn: finiteOrNull(resolved.state?.turn),
        phaseId: resolved.state?.phaseId || resolved.state?.phase?.id || null,
      },
    };
  }

  async function chooseAction(context = {}) {
    const resolved = resolveContext(context);
    const operationSequence = beginBrowserAlphaOperation(resolved.alpha);
    const staleRecommendation = () => staleBrowserAlphaGameRecommendation(
      resolved,
      realtimeAdvisor.lastSnapshot || null,
    );
    try {
      const action = await chooseBrowserAlphaAction({
        alpha: resolved.alpha,
        scenario: resolved.scenario,
        rules: resolved.rules,
        state: resolved.state,
        side: resolved.side,
        legalActions: resolved.legalActions,
        searchOptions: resolved.searchOptions,
        browserOperationSequence: operationSequence,
        logger: resolved.logger,
      });
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      const rawSelection = resolved.alpha?.lastLegalSelection || null;
      const analysis = resolved.alpha?.lastAnalysis || null;
      const summary = resolved.alpha?.lastSummary || null;
      const nextSnapshot = createBrowserAlphaUiSnapshot({
        alpha: resolved.alpha,
        analysis,
        summary,
        legalSelection: rawSelection || undefined,
        legalActions: resolved.legalActions,
        schedulerStatus: realtimeAdvisor.status(),
        side: resolved.side,
        state: resolved.state,
        logger: resolved.logger,
      });
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      realtimeAdvisor.snapshot(resolved, { analysis, summary });
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      return {
        schema: "zizi-el-alamein-alpha-game-recommendation-v1",
        ok: Boolean(action && nextSnapshot.action?.canApply),
        reason: nextSnapshot.action?.reason || (action ? null : "no_recommended_action"),
        action: action || null,
        snapshot: nextSnapshot,
        legalSelection: rawSelection ? summarizeBrowserAlphaLegalSelection(rawSelection) : null,
        context: {
          side: resolved.side || null,
          turn: finiteOrNull(resolved.state?.turn),
          phaseId: resolved.state?.phaseId || resolved.state?.phase?.id || null,
        },
      };
    } catch (error) {
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      resolved.logger?.warn?.("Alpha AI adapter choice failed.", error);
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      const snapshot = realtimeAdvisor.snapshot(resolved);
      if (!isBrowserAlphaOperationCurrent(resolved.alpha, operationSequence)) {
        return staleRecommendation();
      }
      return {
        schema: "zizi-el-alamein-alpha-game-recommendation-v1",
        ok: false,
        reason: "choose_action_failed",
        action: null,
        snapshot,
        legalSelection: null,
        context: {
          side: resolved.side || null,
          turn: finiteOrNull(resolved.state?.turn),
          phaseId: resolved.state?.phaseId || resolved.state?.phase?.id || null,
        },
      };
    }
  }

  function applyRecommendedAction(options = {}) {
    const recommendation = options.recommendation || recommend(options.context || {});
    if (!options.allowApply) {
      return rejectAlphaGameAction("apply_not_authorized", recommendation, options);
    }
    if (!recommendation.ok || !recommendation.action) {
      return rejectAlphaGameAction(recommendation.reason || "no_recommended_action", recommendation, options);
    }
    const resolved = resolveContext(options.context || {});
    if (
      Array.isArray(resolved.legalActions)
      && !isBrowserAlphaActionLegal(recommendation.action, resolved.legalActions)
    ) {
      return rejectAlphaGameAction("action_no_longer_legal", recommendation, options);
    }
    const hostGate = browserAlphaHostApplyGate(canApplyAction, recommendation.action, {
      recommendation,
      context: resolved,
    });
    if (!hostGate.ok) {
      return rejectAlphaGameAction(hostGate.reason, recommendation, options);
    }
    if (typeof applyAction !== "function") {
      return rejectAlphaGameAction("missing_apply_action", recommendation, options);
    }
    try {
      const result = applyAction(stableCopy(recommendation.action), {
        recommendation,
        context: resolved,
      });
      const applied = {
        schema: "zizi-el-alamein-alpha-game-apply-result-v1",
        ok: true,
        reason: null,
        action: stableCopy(recommendation.action),
        result,
        snapshot: recommendation.snapshot,
      };
      onApplied?.(applied);
      return applied;
    } catch (error) {
      return rejectAlphaGameAction("apply_action_failed", recommendation, {
        ...options,
        error,
      });
    }
  }

  function rejectAlphaGameAction(reason, recommendation = null, options = {}) {
    const rejected = {
      schema: "zizi-el-alamein-alpha-game-apply-result-v1",
      ok: false,
      reason,
      action: recommendation?.action ? stableCopy(recommendation.action) : null,
      snapshot: recommendation?.snapshot || null,
      error: options.error ? String(options.error?.message || options.error) : null,
    };
    onRejected?.(rejected);
    return rejected;
  }

  return {
    advisor: realtimeAdvisor,
    request,
    snapshot,
    recommend,
    chooseAction,
    applyRecommendedAction,
    cancel: realtimeAdvisor.cancel,
    status: realtimeAdvisor.status,
    get lastSnapshot() {
      return realtimeAdvisor.lastSnapshot;
    },
  };
}

function browserAlphaHostApplyGate(canApplyAction, action, context) {
  if (typeof canApplyAction !== "function") return { ok: true, reason: null };
  const result = canApplyAction(action, context);
  if (result === false) return { ok: false, reason: "action_rejected_by_host" };
  if (result && typeof result === "object" && result.ok === false) {
    return { ok: false, reason: result.reason || "action_rejected_by_host" };
  }
  return { ok: true, reason: null };
}

function summarizeDiscardedAlphaAnalysis(job, metadata = {}) {
  return {
    schema: "zizi-el-alamein-alpha-scheduler-discard-v1",
    reason: metadata.reason || "stale_position",
    key: job?.key || null,
    jobId: finiteOrNull(job?.id),
    latestRequestId: finiteOrNull(metadata.latestRequestId),
    queuedKey: metadata.queuedKey || null,
    resultStateHash: alphaAnalysisResultStateHash(metadata.result),
  };
}

function alphaAnalysisResultStateHash(result) {
  return result?.analysis?.stateHash
    || result?.summary?.stateHash
    || result?.stateHash
    || null;
}

function browserAlphaProviderValue(provider, context = {}) {
  return typeof provider === "function" ? provider(context) : provider;
}

function makeScheduledAlphaAnalysisJob(context = {}, options = {}) {
  const searchOptions = {
    ...(options.defaultSearchOptions || {}),
    ...(context.searchOptions || {}),
  };
  const state = stableCopy(context.state);
  const key = browserAlphaAnalysisCacheKey({
    scenario: context.scenario,
    rules: context.rules,
    state,
    side: context.side,
    model: context.alpha?.model,
    searchOptions,
  });
  return {
    id: options.requestId || 0,
    key,
    alpha: context.alpha || null,
    scenario: context.scenario || null,
    rules: context.rules || null,
    state,
    side: context.side || null,
    legalActions: Array.isArray(context.legalActions) ? stableCopy(context.legalActions) : context.legalActions || null,
    searchOptions,
    logger: context.logger || console,
  };
}

async function fallbackBrowserAlphaAnalysis(alpha, payload, options) {
  if (!alpha?.analysisClient?.analyze) return null;
  const fallbackOptions = buildBrowserAlphaFallbackSearchOptions(options);
  try {
    return await alpha.analysisClient.analyze({
      ...payload,
      searchOptions: fallbackOptions,
    }, {
      timeoutMs: browserAlphaTimeoutMs(fallbackOptions),
    });
  } catch {
    return null;
  }
}

function isCancelledBrowserAlphaClient(client) {
  return client?.getLastRequestStatus?.() === "cancelled";
}

export function updateBrowserAlphaSummary(alpha, analysis, metadata = {}) {
  if (!alpha || typeof alpha !== "object") return null;
  alpha.lastAnalysis = analysis || null;
  alpha.lastAnalysisMeta = analysis
    ? {
      cacheHit: Boolean(metadata.cacheHit),
      cacheKey: metadata.cacheKey || null,
    }
    : null;
  if (analysis && metadata.cacheKey && !metadata.cacheHit) {
    rememberBrowserAlphaAnalysis(alpha, metadata.cacheKey, analysis);
  }
  alpha.lastSummary = analysis
    ? summarizeBrowserAlphaAnalysis(analysis, {
      modelStatus: alpha.modelStatus,
      cache: metadata.cacheKey
        ? {
          hit: Boolean(metadata.cacheHit),
        }
        : null,
    })
    : null;
  return alpha.lastSummary;
}

function clearBrowserAlphaChoiceState(alpha) {
  if (!alpha || typeof alpha !== "object") return;
  alpha.lastAnalysis = null;
  alpha.lastAnalysisMeta = null;
  alpha.lastSummary = null;
  alpha.lastLegalSelection = null;
}

function beginBrowserAlphaOperation(alpha) {
  if (!alpha || typeof alpha !== "object") return null;
  const nextSequence = (BROWSER_ALPHA_OPERATION_SEQUENCES.get(alpha) || 0) + 1;
  BROWSER_ALPHA_OPERATION_SEQUENCES.set(alpha, nextSequence);
  return nextSequence;
}

function isLatestBrowserAlphaOperation(alpha, sequence) {
  if (sequence === null || sequence === undefined) return false;
  return BROWSER_ALPHA_OPERATION_SEQUENCES.get(alpha) === sequence;
}

function isBrowserAlphaOperationCurrent(alpha, sequence) {
  if (sequence === null || sequence === undefined) {
    return !alpha || typeof alpha !== "object";
  }
  return isLatestBrowserAlphaOperation(alpha, sequence);
}

function resolveBrowserAlphaOperationSequence(alpha, sequence) {
  if (sequence !== undefined) {
    return isLatestBrowserAlphaOperation(alpha, sequence) ? sequence : null;
  }
  return beginBrowserAlphaOperation(alpha);
}

function stampDeferredBrowserAlphaResult(result, alpha, sequence) {
  if (result && typeof result === "object") {
    DEFERRED_BROWSER_ALPHA_RESULT_OPERATIONS.set(result, { alpha, sequence });
  }
  return result;
}

function isScheduledBrowserAlphaOperationCurrent(job) {
  if (job?.browserOperationSequence === null || job?.browserOperationSequence === undefined) {
    return true;
  }
  return isLatestBrowserAlphaOperation(job.alpha, job.browserOperationSequence);
}

function isCurrentDeferredBrowserAlphaResult(result, job) {
  if (!result || typeof result !== "object") return true;
  const stamp = DEFERRED_BROWSER_ALPHA_RESULT_OPERATIONS.get(result);
  if (!stamp) return true;
  return stamp.alpha === job?.alpha
    && stamp.sequence === job?.browserOperationSequence
    && isLatestBrowserAlphaOperation(stamp.alpha, stamp.sequence);
}

function staleBrowserAlphaGameRecommendation(resolved, snapshot) {
  return {
    schema: "zizi-el-alamein-alpha-game-recommendation-v1",
    ok: false,
    reason: "stale_operation",
    action: null,
    snapshot,
    legalSelection: null,
    context: {
      side: resolved?.side || null,
      turn: finiteOrNull(resolved?.state?.turn),
      phaseId: resolved?.state?.phaseId || resolved?.state?.phase?.id || null,
    },
  };
}

export function recordBrowserAlphaLegalSelection(alpha, selection = null) {
  if (!alpha || typeof alpha !== "object") return null;
  alpha.lastLegalSelection = selection || null;
  if (alpha.lastSummary) {
    alpha.lastSummary.legalSelection = summarizeBrowserAlphaLegalSelection(selection);
  }
  return alpha.lastLegalSelection;
}

export function createBrowserAlphaUiSnapshot({
  alpha = null,
  analysis = null,
  summary = null,
  legalSelection = undefined,
  legalActions = null,
  schedulerStatus = null,
  side = null,
  state = null,
  pending = false,
  stale = false,
  logger = console,
} = {}) {
  const sourceAnalysis = analysis || alpha?.lastAnalysis || null;
  const sourceSummary = summary || alpha?.lastSummary || (sourceAnalysis
    ? summarizeBrowserAlphaAnalysis(sourceAnalysis, { modelStatus: alpha?.modelStatus })
    : null);
  const model = summarizeBrowserAlphaModelValidation(
    sourceSummary?.model || alpha?.modelStatus || alpha?.modelValidation || null,
  );
  const rawLegalSelection = legalSelection === undefined
    ? browserAlphaUiLegalSelection({
      alpha,
      analysis: sourceAnalysis,
      legalActions,
      logger,
    })
    : legalSelection;
  const compactLegalSelection = summarizeBrowserAlphaLegalSelection(rawLegalSelection);
  const scheduler = summarizeBrowserAlphaSchedulerStatus(schedulerStatus);
  const isPending = Boolean(pending || scheduler?.scheduled || scheduler?.inFlight);
  const isStale = Boolean(stale || scheduler?.lastDiscarded);
  const action = browserAlphaUiAction({
    summary: sourceSummary,
    model,
    legalSelection: compactLegalSelection,
  });
  const status = browserAlphaUiSnapshotStatus({
    model,
    summary: sourceSummary,
    action,
    pending: isPending,
    stale: isStale,
  });
  return {
    schema: "zizi-el-alamein-alpha-ui-snapshot-v1",
    ready: Boolean(model.ok && sourceSummary),
    status,
    reason: browserAlphaUiSnapshotReason({
      model,
      summary: sourceSummary,
      action,
      pending: isPending,
    }),
    pending: isPending,
    stale: isStale,
    side: side || sourceSummary?.side || sourceAnalysis?.side || null,
    turn: finiteOrNull(state?.turn ?? sourceSummary?.turn ?? sourceAnalysis?.situation?.turn),
    phaseId: state?.phaseId || state?.phase?.id || sourceSummary?.phaseId || sourceAnalysis?.situation?.phaseId || null,
    stateHash: sourceSummary?.stateHash || sourceAnalysis?.stateHash || null,
    model,
    runtime: summarizeBrowserAlphaRuntime(alpha),
    analysis: summarizeBrowserAlphaUiAnalysis(sourceSummary),
    action,
    legalSelection: compactLegalSelection,
    scheduler,
  };
}

export function summarizeBrowserAlphaRuntime(alpha = null) {
  return {
    schema: "zizi-el-alamein-alpha-browser-runtime-v1",
    actionMode: alpha?.client?.getMode?.() || "unavailable",
    analysisMode: alpha?.analysisClient?.getMode?.() || "unavailable",
  };
}

export function summarizeBrowserAlphaAnalysis(analysis, options = {}) {
  if (!analysis || typeof analysis !== "object") return null;
  const policyLimit = Math.max(1, Number(options.policyLimit || 4));
  const featureLimit = Math.max(1, Number(options.featureLimit || 8));
  const explanationLimit = Math.max(0, Number(options.explanationLimit ?? featureLimit));
  const variationLimit = Math.max(0, Number(options.variationLimit || 4));
  const progressLimit = Math.max(0, Number(options.progressLimit ?? 3));
  const policy = (analysis.policy || [])
    .slice(0, policyLimit)
    .map((entry) => ({
      action: compactBrowserAction(entry.action),
      visits: finiteNumber(entry.visits, 0),
      visitShare: rounded(entry.visitShare),
      q: rounded(entry.q),
      prior: rounded(entry.prior),
    }));
  const summary = {
    schema: "zizi-el-alamein-alpha-browser-summary-v1",
    side: analysis.side || null,
    stateHash: analysis.stateHash || null,
    turn: analysis.situation?.turn ?? null,
    phaseId: analysis.situation?.phaseId || null,
    rootValue: rounded(analysis.rootValue),
    bestAction: compactBrowserAction(analysis.bestAction),
    recommendation: compactBrowserRecommendation(analysis.recommendation),
    awareness: summarizeSituationAwareness(browserAlphaSituationForAwareness(analysis), {
      rootValue: analysis.rootValue,
      signalLimit: featureLimit,
    }),
    decision: summarizeAlphaRuntimeDecision(analysis, {
      candidateLimit: policyLimit,
      pvLimit: variationLimit,
      featureLimit,
    }),
    topPolicy: policy,
    principalVariation: (analysis.principalVariation || [])
      .slice(0, variationLimit)
      .map(compactBrowserVariationStep),
    candidateLines: (analysis.candidateLines || [])
      .slice(0, policyLimit)
      .map((line) => ({
        action: compactBrowserAction(line.action),
        visits: finiteNumber(line.visits, 0),
        visitShare: rounded(line.visitShare),
        q: rounded(line.q),
        prior: rounded(line.prior),
        value: rounded(line.value),
        principalVariation: (line.principalVariation || [])
          .slice(0, variationLimit)
          .map(compactBrowserVariationStep),
      })),
    explanation: compactBrowserExplanation(analysis.explanation, explanationLimit),
    features: summarizeSituationFeatures(analysis.situation?.features, featureLimit),
    search: {
      iterations: finiteNumber(analysis.search?.iterations, 0),
      rootVisits: finiteNumber(analysis.search?.rootVisits, 0),
      rootChildren: finiteNumber(analysis.search?.rootChildren, 0),
      maxDepth: finiteNumber(analysis.search?.maxDepth, 0),
      actionLimit: finiteNumber(analysis.search?.actionLimit, 0),
      preApplyLimit: finiteNumber(analysis.search?.preApplyLimit, 0),
      elapsedMs: finiteNumber(analysis.search?.elapsedMs, 0),
    },
    progress: progressLimit > 0
      ? (analysis.progress || [])
        .slice(-progressLimit)
        .map((snapshot) => compactBrowserProgressSnapshot(snapshot, {
          policyLimit,
          variationLimit,
        }))
      : [],
    requiresChance: Boolean(analysis.requiresChance),
  };
  if (options.modelStatus) {
    summary.model = summarizeBrowserAlphaModelValidation(options.modelStatus);
  }
  if (options.cache) {
    summary.cache = {
      hit: Boolean(options.cache.hit),
      status: options.cache.hit ? "hit" : "fresh",
    };
  }
  return summary;
}

export function summarizeBrowserAlphaModelValidation(validation) {
  const status = validation?.schema === "zizi-el-alamein-alpha-browser-model-status-v1"
    ? validation
    : browserAlphaModelStatusFromValidation(validation);
  return {
    schema: "zizi-el-alamein-alpha-browser-model-status-v1",
    ok: Boolean(status?.ok),
    reason: status?.reason || null,
    sampleCount: finiteOrNull(status?.sampleCount),
    sourceSchema: status?.sourceSchema || null,
    sourceArtifact: status?.sourceArtifact || null,
    sourceHash: status?.sourceHash || null,
    releasedAt: status?.releasedAt || null,
    activeGeneration: finiteOrNull(status?.activeGeneration),
    evaluationSuiteGames: finiteOrNull(status?.evaluationSuiteGames),
    evaluationSuiteSides: finiteOrNull(status?.evaluationSuiteSides),
    evaluationSuiteFixedPositions: finiteOrNull(status?.evaluationSuiteFixedPositions),
    evaluationSuiteChallengePositions: finiteOrNull(status?.evaluationSuiteChallengePositions),
    trainingSamples: finiteOrNull(status?.trainingSamples),
    trainingValueSamples: finiteOrNull(status?.trainingValueSamples),
    trainingOutcomeClasses: finiteOrNull(status?.trainingOutcomeClasses),
    trainingPolicyRows: finiteOrNull(status?.trainingPolicyRows),
    trainingPolicyActionTypes: finiteOrNull(status?.trainingPolicyActionTypes),
    trainingUniqueStateHashes: finiteOrNull(status?.trainingUniqueStateHashes),
    trainingDuplicateStateRate: finiteOrNull(status?.trainingDuplicateStateRate),
    trainingSides: finiteOrNull(status?.trainingSides),
    trainingSources: finiteOrNull(status?.trainingSources),
    reanalysisSamples: finiteOrNull(status?.reanalysisSamples),
    stateSnapshots: finiteOrNull(status?.stateSnapshots),
    trainingExplorationShare: finiteOrNull(status?.trainingExplorationShare),
    validationSamples: finiteOrNull(status?.validationSamples),
    validationGroupBy: status?.validationGroupBy || null,
    validationValueMse: finiteOrNull(status?.validationValueMse),
    validationPolicyCrossEntropy: finiteOrNull(status?.validationPolicyCrossEntropy),
    environmentFingerprint: status?.environmentFingerprint || null,
    expectedEnvironmentFingerprint: status?.expectedEnvironmentFingerprint || null,
    environmentMatches: typeof status?.environmentMatches === "boolean" ? status.environmentMatches : null,
    featureContractFingerprint: status?.featureContractFingerprint || null,
    expectedFeatureContractFingerprint: status?.expectedFeatureContractFingerprint || null,
    featureContractMatches: typeof status?.featureContractMatches === "boolean" ? status.featureContractMatches : null,
    decisionCount: finiteOrNull(status?.decisionCount),
    fallbackActions: finiteOrNull(status?.fallbackActions),
    analyzedActions: finiteOrNull(status?.analyzedActions),
    averageRootVisits: finiteOrNull(status?.averageRootVisits),
    selectedActionShare: finiteOrNull(status?.selectedActionShare),
    averageRecommendationConfidence: finiteOrNull(status?.averageRecommendationConfidence),
    averageRecommendationUncertainty: finiteOrNull(status?.averageRecommendationUncertainty),
    minDecisionAverageRecommendationConfidence: finiteOrNull(status?.minDecisionAverageRecommendationConfidence),
    maxDecisionAverageRecommendationUncertainty: finiteOrNull(status?.maxDecisionAverageRecommendationUncertainty),
    minDecisionSelectedActionShare: finiteOrNull(status?.minDecisionSelectedActionShare),
    maxDecisionFallbackRate: finiteOrNull(status?.maxDecisionFallbackRate),
    promotionVerdict: summarizeBrowserAlphaPromotionVerdict(status?.promotionVerdict),
    runtimeTarget: status?.runtimeTarget || null,
    runtimeModelFile: status?.runtimeModelFile || null,
    runtimeInstallApproved: Boolean(status?.runtimeInstallApproved),
    validationMode: status?.validationMode || null,
    previewId: status?.previewId || null,
    candidateFingerprint: status?.candidateFingerprint || null,
  };
}

function browserAlphaModelStatusFromValidation(validation) {
  const model = validation?.model || null;
  const release = model?.release || null;
  const training = model?.training?.data || null;
  const validationEvidence = model?.training?.validation || null;
  const decisionEvidence = release?.decisionEvidence || null;
  const environment = validation?.environment || null;
  const modelEnvironment = environment?.environment || model?.environment || null;
  const expectedEnvironment = environment?.expected || null;
  const featureContract = validation?.featureContract || null;
  const modelFeatureContract = featureContract?.featureContract || model?.featureContract || null;
  const expectedFeatureContract = featureContract?.expected || null;
  return {
    ok: Boolean(validation?.ok),
    reason: validation?.reason || null,
    sampleCount: model?.sampleCount ?? null,
    sourceSchema: release?.sourceSchema || null,
    sourceArtifact: release?.sourceArtifact || null,
    sourceHash: release?.sourceHash || null,
    releasedAt: release?.releasedAt || null,
    activeGeneration: release?.activeGeneration ?? null,
    evaluationSuiteGames: release?.evaluationSuite?.games ?? null,
    evaluationSuiteSides: release?.evaluationSuite?.sides ?? null,
    evaluationSuiteFixedPositions: release?.evaluationSuite?.fixedPositions ?? null,
    evaluationSuiteChallengePositions: release?.evaluationSuite?.challengePositions ?? null,
    trainingSamples: training?.sampleCount ?? null,
    trainingValueSamples: training?.valueSamples ?? null,
    trainingOutcomeClasses: training ? countPositiveKeys(training.outcomeBuckets) : null,
    trainingPolicyRows: training?.policyRows ?? null,
    trainingPolicyActionTypes: training ? countPositiveKeys(training.policyActionTypes) : null,
    trainingUniqueStateHashes: training?.uniqueStateHashes ?? null,
    trainingDuplicateStateRate: training?.duplicateStateRate ?? null,
    trainingSides: training ? Object.keys(training.sides || {}).length : null,
    trainingSources: Array.isArray(training?.sources) ? training.sources.length : null,
    reanalysisSamples: training?.reanalysisSamples ?? null,
    stateSnapshots: training?.samplesWithStateSnapshot ?? null,
    trainingExplorationShare: training ? trainingExplorationShare(training) : null,
    validationSamples: validationEvidence?.sampleCount ?? null,
    validationGroupBy: validationEvidence?.validationGroupBy || null,
    validationValueMse: validationEvidence?.value?.mse ?? null,
    validationPolicyCrossEntropy: validationEvidence?.policy?.crossEntropy ?? null,
    environmentFingerprint: modelEnvironment?.fingerprint || null,
    expectedEnvironmentFingerprint: expectedEnvironment?.fingerprint || null,
    environmentMatches: typeof environment?.match === "boolean" ? environment.match : null,
    featureContractFingerprint: modelFeatureContract?.fingerprint || null,
    expectedFeatureContractFingerprint: expectedFeatureContract?.fingerprint || null,
    featureContractMatches: typeof featureContract?.match === "boolean" ? featureContract.match : null,
    decisionCount: decisionEvidence?.decisionCount ?? null,
    fallbackActions: decisionEvidence?.fallbackActions ?? null,
    analyzedActions: decisionEvidence?.analyzedActions ?? null,
    averageRootVisits: decisionEvidence?.averageRootVisits ?? null,
    selectedActionShare: decisionEvidence?.selectedActionShare ?? null,
    averageRecommendationConfidence: decisionEvidence?.averageRecommendationConfidence ?? null,
    averageRecommendationUncertainty: decisionEvidence?.averageRecommendationUncertainty ?? null,
    minDecisionAverageRecommendationConfidence: release?.minDecisionAverageRecommendationConfidence ?? null,
    maxDecisionAverageRecommendationUncertainty: release?.maxDecisionAverageRecommendationUncertainty ?? null,
    minDecisionSelectedActionShare: release?.minDecisionSelectedActionShare ?? null,
    maxDecisionFallbackRate: release?.maxDecisionFallbackRate ?? null,
    promotionVerdict: release?.promotionVerdict || null,
    runtimeTarget: release?.runtime?.target || null,
    runtimeModelFile: release?.runtime?.modelFile || null,
    runtimeInstallApproved: Boolean(release?.runtime?.installApproved),
    validationMode: validation?.validationMode || null,
    previewId: validation?.previewId || null,
    candidateFingerprint: validation?.candidateFingerprint || null,
  };
}

export function createBrowserAlphaAnalysisCache({
  maxEntries = DEFAULT_ALPHA_BROWSER_CACHE_ENTRIES,
} = {}) {
  const entries = new Map();
  const limit = Math.max(1, Number(maxEntries || DEFAULT_ALPHA_BROWSER_CACHE_ENTRIES));
  return {
    get size() {
      return entries.size;
    },
    get(key) {
      if (!key || !entries.has(key)) return null;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, analysis) {
      if (!key || !analysis) return null;
      entries.delete(key);
      entries.set(key, { analysis });
      while (entries.size > limit) entries.delete(entries.keys().next().value);
      return entries.get(key);
    },
    clear() {
      entries.clear();
    },
  };
}

export function browserAlphaAnalysisCacheKey({
  scenario = null,
  rules = null,
  state = null,
  side = null,
  model = null,
  searchOptions = {},
} = {}) {
  if (!state) return null;
  return stableStringify({
    schema: "zizi-el-alamein-alpha-browser-analysis-cache-key-v1",
    scenario: scenarioFingerprint(scenario),
    rules: rulesFingerprint(rules),
    side: side || searchOptions.side || null,
    model: modelFingerprint(model),
    searchOptions: normalizeSearchOptionsForCache(searchOptions),
    state: browserAlphaAnalysisPositionState(state),
  });
}

export function browserAlphaAnalysisPositionState(state = null) {
  if (!state || typeof state !== "object") return null;
  return {
    turn: state.turn ?? null,
    phaseIndex: state.phaseIndex ?? null,
    combatMode: state.combatMode || null,
    movedUnits: sortedStrings(state.movedUnits),
    usedAttackers: sortedStrings(state.usedAttackers),
    usedDefenders: sortedStrings(state.usedDefenders),
    retreatTask: compactBrowserRetreatTask(state.retreatTask),
    advanceTask: compactBrowserAdvanceTask(state.advanceTask),
    declaredCombats: (state.declaredCombats || []).map(compactBrowserBattleForPosition),
    winner: state.winner
      ? {
        side: state.winner.side || null,
        reason: state.winner.reason || null,
        type: state.winner.type || null,
        turn: state.winner.turn || state.turn || null,
      }
      : null,
    units: (state.units || [])
      .map((unit) => ({
        id: unit.id,
        side: unit.side,
        hexId: unit.hexId,
        disrupted: Boolean(unit.disrupted),
        eliminated: Boolean(unit.eliminated),
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  };
}

export function isBrowserAlphaActionLegal(action = null, legalActions = null) {
  return Boolean(browserAlphaMatchingLegalAction(action, legalActions));
}

export function selectBrowserAlphaLegalAction({
  action = null,
  analysis = null,
  legalActions = null,
  logger = console,
} = {}) {
  return selectBrowserAlphaLegalActionDecision({
    action,
    analysis,
    legalActions,
    logger,
  }).action;
}

export function selectBrowserAlphaLegalActionDecision({
  action = null,
  analysis = null,
  legalActions = null,
  logger = console,
} = {}) {
  const entries = browserAlphaActionCandidateEntries(action, analysis);
  const decision = {
    schema: "zizi-el-alamein-alpha-legal-selection-v1",
    ok: false,
    reason: null,
    action: null,
    actionIdentity: null,
    selectedCandidateIndex: null,
    selectedSource: null,
    selectedSourceIndex: null,
    candidateCount: entries.length,
    illegalCandidateCount: 0,
    legalActionCount: Array.isArray(legalActions) ? legalActions.length : null,
    skipped: [],
  };
  if (analysis?.requiresChance) {
    decision.reason = "requires_chance";
    return decision;
  }
  if (!entries.length) {
    decision.reason = "no_candidate_actions";
    return decision;
  }
  if (!Array.isArray(legalActions)) {
    return browserAlphaLegalSelectionWithAction(decision, entries[0], entries[0].action);
  }
  for (const entry of entries) {
    const legalAction = browserAlphaMatchingLegalAction(entry.action, legalActions);
    if (legalAction) {
      decision.illegalCandidateCount = decision.skipped.length;
      return browserAlphaLegalSelectionWithAction(decision, entry, legalAction);
    }
    decision.skipped.push(browserAlphaSkippedCandidate(entry));
  }
  decision.reason = "no_legal_candidate";
  decision.illegalCandidateCount = decision.skipped.length;
  logger?.warn?.("Ignoring illegal Alpha AI action for current position.", browserAlphaActionIdentity(entries[0].action));
  return decision;
}

export function summarizeBrowserAlphaLegalSelection(selection = null, options = {}) {
  if (!selection || typeof selection !== "object") return null;
  const skippedLimit = Math.max(0, Number(options.skippedLimit ?? 3));
  return {
    schema: "zizi-el-alamein-alpha-legal-selection-v1",
    ok: Boolean(selection.ok),
    reason: selection.reason || null,
    action: compactBrowserAction(selection.action),
    actionIdentity: selection.actionIdentity || compactBrowserAction(selection.action),
    selectedCandidateIndex: finiteOrNull(selection.selectedCandidateIndex),
    selectedSource: selection.selectedSource || null,
    selectedSourceIndex: finiteOrNull(selection.selectedSourceIndex),
    candidateCount: finiteNumber(selection.candidateCount, 0),
    illegalCandidateCount: finiteNumber(selection.illegalCandidateCount, 0),
    legalActionCount: finiteOrNull(selection.legalActionCount),
    skipped: (selection.skipped || [])
      .slice(0, skippedLimit)
      .map((candidate) => ({
        candidateIndex: finiteOrNull(candidate.candidateIndex),
        source: candidate.source || null,
        sourceIndex: finiteOrNull(candidate.sourceIndex),
        identity: candidate.identity || null,
      })),
  };
}

export function summarizeBrowserAlphaGameRecommendation(recommendation = null, options = {}) {
  if (!recommendation || typeof recommendation !== "object") return null;
  const snapshot = recommendation.snapshot || null;
  return {
    schema: "zizi-el-alamein-alpha-game-recommendation-summary-v1",
    ok: Boolean(recommendation.ok),
    reason: recommendation.reason || null,
    action: compactBrowserAction(recommendation.action),
    legalSelection: summarizeBrowserAlphaLegalSelection(recommendation.legalSelection, {
      skippedLimit: options.skippedLimit ?? 2,
    }),
    context: {
      side: recommendation.context?.side || null,
      turn: finiteOrNull(recommendation.context?.turn),
      phaseId: recommendation.context?.phaseId || null,
    },
    snapshot: snapshot
      ? {
        schema: "zizi-el-alamein-alpha-ui-snapshot-v1",
        ready: Boolean(snapshot.ready),
        status: snapshot.status || null,
        reason: snapshot.reason || null,
        pending: Boolean(snapshot.pending),
        stale: Boolean(snapshot.stale),
        stateHash: snapshot.stateHash || null,
        model: snapshot.model
          ? {
            ok: Boolean(snapshot.model.ok),
            reason: snapshot.model.reason || null,
            sourceHash: snapshot.model.sourceHash || null,
            promotionVerdict: snapshot.model.promotionVerdict || null,
          }
          : null,
        runtime: snapshot.runtime
          ? {
            actionMode: snapshot.runtime.actionMode || null,
            analysisMode: snapshot.runtime.analysisMode || null,
          }
          : null,
        analysis: snapshot.analysis
          ? {
            side: snapshot.analysis.side || null,
            turn: finiteOrNull(snapshot.analysis.turn),
            phaseId: snapshot.analysis.phaseId || null,
            rootValue: finiteOrNull(snapshot.analysis.rootValue),
            recommendation: snapshot.analysis.recommendation || null,
            awareness: snapshot.analysis.awareness || null,
            search: snapshot.analysis.search || null,
            requiresChance: Boolean(snapshot.analysis.requiresChance),
          }
          : null,
        action: snapshot.action
          ? {
            canApply: Boolean(snapshot.action.canApply),
            reason: snapshot.action.reason || null,
            selected: compactBrowserAction(snapshot.action.selected),
            recommended: compactBrowserAction(snapshot.action.recommended),
            selectedSource: snapshot.action.selectedSource || null,
            selectedCandidateIndex: finiteOrNull(snapshot.action.selectedCandidateIndex),
            legalActionCount: finiteOrNull(snapshot.action.legalActionCount),
            confidence: finiteOrNull(snapshot.action.confidence),
            label: snapshot.action.label || null,
          }
          : null,
      }
      : null,
  };
}

function browserAlphaUiLegalSelection({
  alpha = null,
  analysis = null,
  legalActions = null,
  logger = console,
} = {}) {
  if (analysis && Array.isArray(legalActions)) {
    return selectBrowserAlphaLegalActionDecision({
      analysis,
      legalActions,
      logger,
    });
  }
  return alpha?.lastLegalSelection || null;
}

function summarizeBrowserAlphaUiAnalysis(summary = null) {
  if (!summary || typeof summary !== "object") return null;
  return {
    schema: "zizi-el-alamein-alpha-ui-analysis-v1",
    side: summary.side || null,
    turn: finiteOrNull(summary.turn),
    phaseId: summary.phaseId || null,
    stateHash: summary.stateHash || null,
    rootValue: finiteOrNull(summary.rootValue),
    recommendation: summary.recommendation || null,
    awareness: summary.awareness || null,
    decision: summary.decision || null,
    topPolicy: Array.isArray(summary.topPolicy) ? summary.topPolicy.slice() : [],
    candidateLines: Array.isArray(summary.candidateLines) ? summary.candidateLines.slice() : [],
    principalVariation: Array.isArray(summary.principalVariation) ? summary.principalVariation.slice() : [],
    search: summary.search || null,
    progressCount: Array.isArray(summary.progress) ? summary.progress.length : 0,
    requiresChance: Boolean(summary.requiresChance),
    cache: summary.cache
      ? {
        hit: Boolean(summary.cache.hit),
        status: summary.cache.status || null,
      }
      : null,
  };
}

function browserAlphaUiAction({
  summary = null,
  model = null,
  legalSelection = null,
} = {}) {
  const recommendedAction = summary?.decision?.action || summary?.recommendation?.action || summary?.bestAction || null;
  const selectedAction = legalSelection?.ok ? legalSelection.action : null;
  const canApply = Boolean(model?.ok && selectedAction);
  return {
    schema: "zizi-el-alamein-alpha-ui-action-v1",
    canApply,
    reason: browserAlphaUiActionReason({
      summary,
      model,
      legalSelection,
      selectedAction,
    }),
    selected: selectedAction,
    recommended: compactBrowserAction(recommendedAction),
    selectedSource: legalSelection?.selectedSource || null,
    selectedCandidateIndex: finiteOrNull(legalSelection?.selectedCandidateIndex),
    legalActionCount: finiteOrNull(legalSelection?.legalActionCount),
    confidence: finiteOrNull(summary?.decision?.confidence ?? summary?.recommendation?.confidence),
    label: summary?.recommendation?.label || summary?.decision?.recommendationLabel || null,
  };
}

function browserAlphaUiActionReason({
  summary = null,
  model = null,
  legalSelection = null,
  selectedAction = null,
} = {}) {
  if (!model?.ok) return model?.reason || "model_untrusted";
  if (!summary) return "no_analysis";
  if (summary.requiresChance) return "requires_chance";
  if (!legalSelection) return "legal_actions_required";
  if (!legalSelection.ok) return legalSelection.reason || "no_legal_action";
  return selectedAction ? null : "no_legal_action";
}

function browserAlphaUiSnapshotStatus({
  model = null,
  summary = null,
  action = null,
  pending = false,
  stale = false,
} = {}) {
  if (!model?.ok) return "model_untrusted";
  if (pending && !summary) return "pending";
  if (!summary) return "idle";
  if (pending) return "refreshing";
  if (stale) return "stale";
  if (action?.canApply) return "ready";
  return "analysis_only";
}

function browserAlphaUiSnapshotReason({
  model = null,
  summary = null,
  action = null,
  pending = false,
} = {}) {
  if (!model?.ok) return model?.reason || "model_untrusted";
  if (pending && !summary) return "analysis_pending";
  if (!summary) return "no_analysis";
  return action?.reason || null;
}

function summarizeBrowserAlphaSchedulerStatus(status = null) {
  if (!status || typeof status !== "object") return null;
  return {
    schema: "zizi-el-alamein-alpha-scheduler-status-v1",
    scheduled: Boolean(status.scheduled),
    inFlight: Boolean(status.inFlight),
    queuedKey: status.queuedKey || null,
    inFlightKey: status.inFlightKey || null,
    lastCompletedKey: status.lastCompletedKey || null,
    discardedResults: finiteNumber(status.discardedResults, 0),
    lastDiscarded: status.lastDiscarded
      ? {
        schema: status.lastDiscarded.schema || "zizi-el-alamein-alpha-scheduler-discard-v1",
        reason: status.lastDiscarded.reason || null,
        key: status.lastDiscarded.key || null,
        jobId: finiteOrNull(status.lastDiscarded.jobId),
        latestRequestId: finiteOrNull(status.lastDiscarded.latestRequestId),
        queuedKey: status.lastDiscarded.queuedKey || null,
        resultStateHash: status.lastDiscarded.resultStateHash || null,
      }
      : null,
  };
}

export function getBrowserAlphaCachedAnalysis(alpha, cacheKey) {
  if (!cacheKey) return null;
  return ensureBrowserAlphaAnalysisCache(alpha)?.get(cacheKey) || null;
}

export function rememberBrowserAlphaAnalysis(alpha, cacheKey, analysis) {
  if (!cacheKey || !analysis) return null;
  return ensureBrowserAlphaAnalysisCache(alpha)?.set(cacheKey, analysis) || null;
}

export function buildBrowserAlphaSearchOptions({
  model = null,
  side = null,
  searchOptions = {},
} = {}) {
  if (searchOptions.engine === DEFAULT_ALPHA_BROWSER_GENERIC_SEARCH.engine) {
    const merged = { ...DEFAULT_ALPHA_BROWSER_GENERIC_SEARCH, ...searchOptions, side };
    return {
      ...merged,
      engine: DEFAULT_ALPHA_BROWSER_GENERIC_SEARCH.engine,
      simulations: boundedBrowserInteger(merged.simulations, 4, 1, 32),
      maxDepth: boundedBrowserInteger(merged.maxDepth, 1, 0, 2),
      actionLimit: boundedBrowserInteger(merged.actionLimit, 32, 1, 32),
      exploration: boundedBrowserNumber(merged.exploration, 1.35, 0, 4),
      policyTemperature: boundedBrowserNumber(merged.policyTemperature, 1, 0.1, 4),
      timeBudgetMs: boundedBrowserInteger(merged.timeBudgetMs, 2500, 250, 4500),
      responsePaddingMs: boundedBrowserInteger(merged.responsePaddingMs, 500, 100, 1000),
    };
  }
  return {
    side,
    iterations: DEFAULT_ALPHA_BROWSER_SEARCH.iterations,
    maxDepth: DEFAULT_ALPHA_BROWSER_SEARCH.maxDepth,
    actionLimit: DEFAULT_ALPHA_BROWSER_SEARCH.actionLimit,
    preApplyLimit: DEFAULT_ALPHA_BROWSER_SEARCH.preApplyLimit,
    timeBudgetMs: DEFAULT_ALPHA_BROWSER_SEARCH.timeBudgetMs,
    progressInterval: DEFAULT_ALPHA_BROWSER_SEARCH.progressInterval,
    progressLimit: DEFAULT_ALPHA_BROWSER_SEARCH.progressLimit,
    policyWeight: model ? DEFAULT_ALPHA_BROWSER_SEARCH.modelPolicyWeight : 0,
    ...searchOptions,
  };
}

export function buildBrowserAlphaFallbackSearchOptions(options = {}) {
  return {
    ...options,
    iterations: Math.min(2, Math.max(1, Number(options.iterations || 1))),
    maxDepth: 1,
    actionLimit: Math.min(4, Math.max(1, Number(options.actionLimit || 4))),
    preApplyLimit: Math.min(12, Math.max(4, Number(options.preApplyLimit || 12))),
    timeBudgetMs: Math.min(24, Math.max(8, Number(options.timeBudgetMs || 20))),
    progressInterval: Math.min(1, Math.max(0, Number(options.progressInterval ?? DEFAULT_ALPHA_BROWSER_SEARCH.progressInterval))),
    progressLimit: Math.min(1, Math.max(0, Number(options.progressLimit ?? DEFAULT_ALPHA_BROWSER_SEARCH.progressLimit))),
    engine: "legacy",
  };
}

function boundedBrowserInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Number.isInteger(number) ? number : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function boundedBrowserNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function browserAlphaTimeoutMs(options = {}) {
  return Number(options.timeBudgetMs || DEFAULT_ALPHA_BROWSER_SEARCH.timeBudgetMs)
    + Number(options.responsePaddingMs || DEFAULT_ALPHA_BROWSER_SEARCH.responsePaddingMs);
}

function ensureBrowserAlphaAnalysisCache(alpha) {
  if (!alpha || typeof alpha !== "object") return null;
  if (!alpha.analysisCache || typeof alpha.analysisCache.get !== "function" || typeof alpha.analysisCache.set !== "function") {
    alpha.analysisCache = createBrowserAlphaAnalysisCache();
  }
  return alpha.analysisCache;
}

function scenarioFingerprint(scenario) {
  if (!scenario || typeof scenario !== "object") return null;
  const units = Array.isArray(scenario.units) ? scenario.units : [];
  return stableCopy({
    id: scenario.id || scenario.name || scenario.title || null,
    boardImage: scenario.board?.image || null,
    unitCount: units.length,
    objectiveKeys: Object.keys(scenario.objectives || {}).sort(),
  });
}

function rulesFingerprint(rules) {
  if (!rules || typeof rules !== "object") return null;
  return stableCopy({
    schema: rules.schema || null,
    version: rules.version || null,
    phaseCount: Array.isArray(rules.phases) ? rules.phases.length : 0,
    combatResults: Object.keys(rules.combatResults || rules.crt || {}).sort(),
  });
}

function modelFingerprint(model) {
  if (!model || typeof model !== "object") return null;
  return stableCopy({
    schema: model.schema || null,
    generatedAt: model.generatedAt || null,
    sampleCount: model.sampleCount ?? null,
    release: {
      sourceArtifact: model.release?.sourceArtifact || null,
      sourceHash: model.release?.sourceHash || null,
      releasedAt: model.release?.releasedAt || null,
    },
    environment: model.environment?.fingerprint || null,
    featureContract: model.featureContract?.fingerprint || null,
    hasValue: Boolean(model.value),
    hasPolicy: Boolean(model.policy),
  });
}

function browserAlphaSituationForAwareness(analysis) {
  if (!analysis?.situation || typeof analysis.situation !== "object") return null;
  return {
    ...analysis.situation,
    side: analysis.situation.side || analysis.side || null,
    activeSide: analysis.situation.activeSide || analysis.side || null,
  };
}

function summarizeBrowserAlphaPromotionVerdict(verdict) {
  if (!verdict || typeof verdict !== "object") return null;
  const gates = Array.isArray(verdict.gates) ? verdict.gates : [];
  const failedGate = gates.find((gate) => gate && gate.ok === false) || null;
  const compactFailedGate = failedGate || verdict.failedGate || null;
  return {
    schema: "zizi-el-alamein-alpha-promotion-verdict-v1",
    ok: Boolean(verdict.ok),
    reason: verdict.reason || compactFailedGate?.reason || null,
    gateCount: gates.length || finiteNumber(verdict.gateCount, 0),
    failedGate: compactFailedGate
      ? {
        key: compactFailedGate.key || null,
        reason: compactFailedGate.reason || null,
        actual: finiteOrNull(compactFailedGate.actual),
        threshold: finiteOrNull(compactFailedGate.threshold),
      }
      : null,
  };
}

function sortedStrings(values) {
  return Array.isArray(values) ? values.slice().sort() : [];
}

function compactBrowserRetreatTask(task) {
  if (!task) return null;
  return {
    battleId: task.battleId || null,
    unitIds: (task.unitIds || []).slice(),
    index: task.index || 0,
    steps: task.steps,
    result: task.result,
    origins: stableCopy(task.origins || {}),
    disruptAfterRetreat: Boolean(task.disruptAfterRetreat),
    advanceAfter: Boolean(task.advanceAfter),
  };
}

function compactBrowserAdvanceTask(task) {
  if (!task) return null;
  return {
    battleId: task.battleId || null,
    targetHexId: task.targetHexId,
    attackerIds: (task.attackerIds || []).slice(),
  };
}

function compactBrowserBattleForPosition(battle) {
  return {
    id: battle.id,
    defenderId: battle.defenderId,
    attackerIds: (battle.attackerIds || []).slice(),
    resolved: Boolean(battle.resolved),
    result: battle.resultCode || battle.result || null,
    roll: battle.roll || null,
  };
}

function browserAlphaActionIdentity(action) {
  if (!action?.type) return null;
  const type = action.type;
  if (type === "MOVE_UNIT" || type === "RETREAT_UNIT") {
    return {
      type,
      unitId: action.unitId || null,
      toHexId: action.toHexId || null,
      battleId: action.battleId || null,
    };
  }
  if (type === "DECLARE_COMBAT") {
    return {
      type,
      defenderId: action.defenderId || null,
      attackerIds: sortedStrings(action.attackerIds),
    };
  }
  if (type === "ADVANCE_UNIT") {
    return {
      type,
      unitId: action.unitId || null,
      battleId: action.battleId || null,
      targetHexId: action.targetHexId || null,
    };
  }
  if (type === "SKIP_ADVANCE") {
    return {
      type,
      battleId: action.battleId || null,
      targetHexId: action.targetHexId || null,
    };
  }
  if (type === "RESOLVE_COMBAT") {
    return {
      type,
      battleId: action.battleId || null,
      dieRoll: action.dieRoll ?? null,
    };
  }
  return { type };
}

function browserAlphaMatchingLegalAction(action = null, legalActions = null) {
  if (!action?.type || !Array.isArray(legalActions)) return null;
  const target = stableStringify(browserAlphaActionIdentity(action));
  return legalActions.find((legalAction) => (
    stableStringify(browserAlphaActionIdentity(legalAction)) === target
  )) || null;
}

function browserAlphaActionCandidates(action = null, analysis = null) {
  return browserAlphaActionCandidateEntries(action, analysis).map((entry) => entry.action);
}

function browserAlphaActionCandidateEntries(action = null, analysis = null) {
  const entries = [];
  addBrowserAlphaActionCandidate(entries, action, { source: "worker" });
  addBrowserAlphaActionCandidate(entries, analysis?.bestAction, { source: "bestAction" });
  addBrowserAlphaActionCandidate(entries, analysis?.decision?.action, { source: "decision" });
  addBrowserAlphaActionCandidate(entries, analysis?.recommendation?.action, { source: "recommendation" });
  for (const line of analysis?.candidateLines || []) {
    addBrowserAlphaActionCandidate(entries, line?.action, {
      source: "candidateLine",
      sourceIndex: entriesFromSourceIndex(analysis?.candidateLines, line),
    });
  }
  for (const entry of analysis?.policy || []) {
    addBrowserAlphaActionCandidate(entries, entry?.action, {
      source: "policy",
      sourceIndex: entriesFromSourceIndex(analysis?.policy, entry),
    });
  }
  for (const step of analysis?.principalVariation || []) {
    addBrowserAlphaActionCandidate(entries, step?.action || step, {
      source: "principalVariation",
      sourceIndex: entriesFromSourceIndex(analysis?.principalVariation, step),
    });
  }
  return entries.map((entry, candidateIndex) => ({
    ...entry,
    candidateIndex,
  }));
}

function addBrowserAlphaActionCandidate(entries, action, metadata = {}) {
  if (!action?.type) return;
  const identity = stableStringify(browserAlphaActionIdentity(action));
  if (entries.some((entry) => stableStringify(browserAlphaActionIdentity(entry.action)) === identity)) return;
  entries.push({
    action,
    source: metadata.source || null,
    sourceIndex: finiteOrNull(metadata.sourceIndex),
    identity: browserAlphaActionIdentity(action),
  });
}

function entriesFromSourceIndex(collection, item) {
  return Array.isArray(collection) ? collection.indexOf(item) : null;
}

function browserAlphaLegalSelectionWithAction(decision, entry, action) {
  return {
    ...decision,
    ok: Boolean(action),
    reason: action ? null : "no_candidate_actions",
    action: action || null,
    actionIdentity: action ? browserAlphaActionIdentity(action) : null,
    selectedCandidateIndex: finiteOrNull(entry?.candidateIndex),
    selectedSource: entry?.source || null,
    selectedSourceIndex: finiteOrNull(entry?.sourceIndex),
  };
}

function browserAlphaSkippedCandidate(entry) {
  return {
    candidateIndex: finiteOrNull(entry?.candidateIndex),
    source: entry?.source || null,
    sourceIndex: finiteOrNull(entry?.sourceIndex),
    identity: entry?.identity || browserAlphaActionIdentity(entry?.action),
  };
}

function normalizeSearchOptionsForCache(options = {}) {
  const copy = stableCopy(options || {});
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) return copy;
  delete copy.model;
  delete copy.random;
  delete copy.responsePaddingMs;
  delete copy.useCache;
  return copy;
}

function stableStringify(value) {
  return JSON.stringify(stableCopy(value));
}

function stableCopy(value, seen = new WeakSet()) {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stableCopy(item, seen)).filter((item) => item !== undefined);
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [String(key), stableCopy(entryValue, seen)])
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
  }
  if (value instanceof Set) {
    return [...value.values()]
      .map((item) => stableCopy(item, seen))
      .filter((item) => item !== undefined)
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  }
  if (typeof value !== "object") return null;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const next = stableCopy(value[key], seen);
    if (next !== undefined) output[key] = next;
  }
  seen.delete(value);
  return output;
}

function summarizeSituationFeatures(features, limit) {
  if (!features || typeof features !== "object") return [];
  return Object.entries(features)
    .map(([key, value]) => ({
      key,
      value: rounded(value),
      magnitude: Math.abs(Number(value) || 0),
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => b.magnitude - a.magnitude || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, value }) => ({ key, value }));
}

function compactBrowserAction(action) {
  if (!action || typeof action !== "object") return null;
  const compact = {};
  for (const key of ["type", "unitId", "fromHexId", "toHexId", "targetHexId", "defenderId", "battleId", "dieRoll"]) {
    if (action[key] !== undefined) compact[key] = action[key];
  }
  if (Array.isArray(action.attackerIds)) compact.attackerIds = action.attackerIds.slice();
  if (action.route && typeof action.route === "object") {
    compact.route = {
      remaining: finiteNumber(action.route.remaining, 0),
      path: Array.isArray(action.route.path) ? action.route.path.slice() : [],
    };
  }
  return compact;
}

function compactBrowserVariationStep(step) {
  if (!step || typeof step !== "object") return null;
  if (step.action) {
    return {
      action: compactBrowserAction(step.action),
      visits: finiteNumber(step.visits, 0),
      q: rounded(step.q),
    };
  }
  return {
    action: compactBrowserAction(step),
    visits: 0,
    q: 0,
  };
}

function compactBrowserProgressSnapshot(snapshot, options = {}) {
  const policyLimit = Math.max(1, Number(options.policyLimit || 4));
  const variationLimit = Math.max(0, Number(options.variationLimit || 4));
  return {
    schema: "zizi-el-alamein-alpha-progress-v1",
    iterations: finiteNumber(snapshot?.iterations, 0),
    elapsedMs: finiteNumber(snapshot?.elapsedMs, 0),
    rootVisits: finiteNumber(snapshot?.rootVisits, 0),
    rootChildren: finiteNumber(snapshot?.rootChildren, 0),
    bestAction: compactBrowserAction(snapshot?.bestAction),
    recommendation: compactBrowserRecommendation(snapshot?.recommendation),
    topPolicy: (snapshot?.topPolicy || [])
      .slice(0, policyLimit)
      .map((entry) => ({
        action: compactBrowserAction(entry.action),
        visits: finiteNumber(entry.visits, 0),
        visitShare: rounded(entry.visitShare),
        q: rounded(entry.q),
        prior: rounded(entry.prior),
      })),
    principalVariation: (snapshot?.principalVariation || [])
      .slice(0, variationLimit)
      .map(compactBrowserVariationStep),
    candidateLines: (snapshot?.candidateLines || [])
      .slice(0, policyLimit)
      .map((line) => ({
        action: compactBrowserAction(line.action),
        visits: finiteNumber(line.visits, 0),
        visitShare: rounded(line.visitShare),
        q: rounded(line.q),
        prior: rounded(line.prior),
        principalVariation: (line.principalVariation || [])
          .slice(0, variationLimit)
          .map(compactBrowserVariationStep),
      })),
  };
}

function compactBrowserRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  return {
    schema: "zizi-el-alamein-alpha-recommendation-v1",
    action: compactBrowserAction(recommendation.action),
    label: typeof recommendation.label === "string" ? recommendation.label : "unknown",
    confidence: rounded(recommendation.confidence),
    bestVisitShare: rounded(recommendation.bestVisitShare),
    runnerUpVisitShare: rounded(recommendation.runnerUpVisitShare),
    visitMargin: rounded(recommendation.visitMargin),
    qMargin: recommendation.qMargin === null || recommendation.qMargin === undefined
      ? null
      : rounded(recommendation.qMargin),
    priorMargin: recommendation.priorMargin === null || recommendation.priorMargin === undefined
      ? null
      : rounded(recommendation.priorMargin),
    entropy: rounded(recommendation.entropy),
    choices: finiteNumber(recommendation.choices, 0),
  };
}

function compactBrowserExplanation(explanation, limit) {
  if (!explanation || typeof explanation !== "object") return null;
  const value = compactContributionExplanation(explanation.value, limit);
  const policy = compactContributionExplanation(explanation.policy, limit);
  if (!value && !policy) return null;
  return {
    schema: "zizi-el-alamein-alpha-browser-explanation-v1",
    value,
    policy: policy
      ? {
        ...policy,
        action: compactBrowserAction(explanation.policy?.action),
      }
      : null,
  };
}

function compactContributionExplanation(explanation, limit) {
  if (!explanation || typeof explanation !== "object") return null;
  const entries = (explanation.entries || [])
    .slice(0, Math.max(0, Number(limit || 0)))
    .map((entry) => ({
      key: String(entry.key || ""),
      contribution: rounded(entry.contribution),
      direction: typeof entry.direction === "string" ? entry.direction : "neutral",
      ...(entry.raw !== undefined ? { raw: rounded(entry.raw) } : {}),
      ...(entry.value !== undefined ? { value: rounded(entry.value) } : {}),
      ...(entry.normalized !== undefined ? { normalized: rounded(entry.normalized) } : {}),
      weight: rounded(entry.weight),
    }))
    .filter((entry) => entry.key);
  return {
    schema: typeof explanation.schema === "string" ? explanation.schema : null,
    ...(explanation.side ? { side: explanation.side } : {}),
    ...(explanation.turn !== undefined ? { turn: explanation.turn } : {}),
    ...(explanation.phaseId ? { phaseId: explanation.phaseId } : {}),
    ...(explanation.rawScore !== undefined ? { rawScore: rounded(explanation.rawScore) } : {}),
    ...(explanation.value !== undefined ? { value: rounded(explanation.value) } : {}),
    ...(explanation.logit !== undefined ? { logit: rounded(explanation.logit) } : {}),
    ...(explanation.probability !== undefined ? { probability: rounded(explanation.probability) } : {}),
    entries,
  };
}

function rounded(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Number(next.toFixed(6));
}

function finiteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function finiteOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function countPositiveKeys(value) {
  return Object.values(value || {}).filter((count) => Number(count) > 0).length;
}

function trainingExplorationShare(training) {
  const recorded = Number(training?.explorationDecisionShare);
  if (Number.isFinite(recorded)) return recorded;
  const decisions = Number(training?.samplesWithDecision || 0);
  if (!(decisions > 0)) return null;
  const modes = training?.selectionModes || {};
  const sampled = Number(training?.sampledDecisionCount ?? 0)
    || Number(modes.sampled || 0) + Number(modes.sampled_best || 0);
  const explored = Number(training?.explorationDecisionCount ?? sampled);
  if (!Number.isFinite(explored)) return null;
  return explored / decisions;
}

export function createAlphaWorkerFactory({
  workerUrl = "./src/app/ai-alpha-worker.js?v=20260713-generic-worker-3",
  WorkerCtor = globalThis.Worker,
} = {}) {
  return () => {
    if (typeof WorkerCtor !== "function") return null;
    return new WorkerCtor(workerUrl, { type: "module" });
  };
}
