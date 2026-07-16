import { createBoard, createEnvironment } from "../core/index.js";
import { canonicalSerialize } from "../../../shared/wargame-alpha/environment-contract.js";
import { createElAlameinAlphaEnvironmentAdapter } from "./ai-alpha-environment-adapter.js";
import { analyzePosition } from "./ai-alpha-search.js";
import { searchElAlameinAlpha } from "./ai-alpha-search-bridge.js";
import { normalizeAlphaModelArtifact } from "./ai-alpha-model.js";
import { analyzeSituation } from "./ai-situation.js";

export const ALPHA_RUNTIME_ENGINE = Object.freeze({
  LEGACY: "legacy",
  GENERIC: "generic-alpha-v1",
});

export const GENERIC_ALPHA_RUNTIME_LIMITS = Object.freeze({
  simulations: 4,
  maxSimulations: 32,
  maxDepth: 1,
  maxAllowedDepth: 2,
  actionLimit: 32,
  maxActionLimit: 32,
  exploration: 1.35,
  policyTemperature: 1,
});

export const ALPHA_RUNTIME_MESSAGE = Object.freeze({
  ANALYZE: "ANALYZE_ALPHA_POSITION",
  CHOOSE_ACTION: "CHOOSE_ALPHA_ACTION",
});

const INTERNAL_STAGE_INSTRUMENTATION_V1 = "internal-stage-v1";
const INTERNAL_STAGE_INSTRUMENTATION_V2 = "internal-stage-v2";
const ENVIRONMENT_CONTRACT_INSTRUMENTATION_V1 = "environment-contract-v1";
const BASE_INTERNAL_STAGES = Object.freeze([
  "legalActionGeneration",
  "stateForwardValue",
  "batchActionEncoding",
  "batchPolicyScoring",
  "softmaxNormalization",
]);
const SEARCH_TRAVERSAL_SUBSTAGES = Object.freeze([
  "environmentContractValidation",
  "stateCloning",
  "actionApplyRevalidation",
  "policyNormalizationSort",
  "treeTraversal",
]);
const ENVIRONMENT_CONTRACT_SUBSTAGES = Object.freeze([
  "adapterStaticValidation",
  "initialStateCanonicalSignature",
  "methodInputPreCanonicalization",
  "methodInputPostCanonicalization",
  "nonLegalMethodResultSerialization",
  "legalActionsWholeResultSerialization",
  "legalEntrySignatureSerialization",
  "legalEntryKeySerializationDuplicateCheck",
  "nodeKindCurrentPlayerChecks",
  "decisionBindingStateKeyConstruction",
]);

export function alphaSearchOptionsFromModel(model = null, options = {}) {
  return {
    ...options,
    model: normalizeAlphaModel(model),
  };
}

export function analyzeAlphaPosition({
  scenario,
  rules,
  board = null,
  state,
  model = null,
  searchOptions = {},
} = {}) {
  const environment = createEnvironment({
    scenario,
    rules,
    board: board || createBoard(scenario),
    state,
  });
  if (searchOptions.engine === ALPHA_RUNTIME_ENGINE.GENERIC) {
    return analyzeGenericAlphaPosition(environment, model, searchOptions);
  }
  return analyzePosition(environment, alphaSearchOptionsFromModel(model, searchOptions));
}

export function genericAlphaSearchOptionsFromModel(model = null, options = {}) {
  const normalizedModel = normalizeAlphaModel(model);
  const normalized = {
    simulations: boundedInteger(options.simulations, GENERIC_ALPHA_RUNTIME_LIMITS.simulations, 1, GENERIC_ALPHA_RUNTIME_LIMITS.maxSimulations),
    maxDepth: boundedInteger(options.maxDepth, GENERIC_ALPHA_RUNTIME_LIMITS.maxDepth, 0, GENERIC_ALPHA_RUNTIME_LIMITS.maxAllowedDepth),
    actionLimit: boundedInteger(options.actionLimit, GENERIC_ALPHA_RUNTIME_LIMITS.actionLimit, 1, GENERIC_ALPHA_RUNTIME_LIMITS.maxActionLimit),
    exploration: boundedNumber(options.exploration, GENERIC_ALPHA_RUNTIME_LIMITS.exploration, 0, 4),
    policyTemperature: boundedNumber(options.policyTemperature, GENERIC_ALPHA_RUNTIME_LIMITS.policyTemperature, 0.1, 4),
    valueModel: normalizedModel?.value || null,
    policyModel: normalizedModel?.policy || null,
    hexGraphModel: normalizedModel?.hexGraph || null,
    reuseValidatedLegalEntries: options.reuseValidatedLegalEntries !== false,
  };
  if ([
    INTERNAL_STAGE_INSTRUMENTATION_V1,
    INTERNAL_STAGE_INSTRUMENTATION_V2,
    ENVIRONMENT_CONTRACT_INSTRUMENTATION_V1,
  ].includes(options.instrumentation)) {
    normalized.instrumentation = options.instrumentation;
  }
  return normalized;
}

export function analyzeGenericAlphaPosition(environment, model = null, searchOptions = {}) {
  const options = genericAlphaSearchOptionsFromModel(model, searchOptions);
  const instrumentation = [
    INTERNAL_STAGE_INSTRUMENTATION_V1,
    INTERNAL_STAGE_INSTRUMENTATION_V2,
    ENVIRONMENT_CONTRACT_INSTRUMENTATION_V1,
  ]
    .includes(options.instrumentation)
    ? createInternalStageInstrumentation(options.instrumentation)
    : null;
  const adapter = createElAlameinAlphaEnvironmentAdapter({
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
    instrumentation,
  });
  const started = runtimeNow();
  const result = searchElAlameinAlpha(environment, { ...options, adapter, instrumentation });
  const elapsedMs = Math.max(0, runtimeNow() - started);
  const diagnostics = instrumentation?.finish(elapsedMs) || null;
  const side = result.nodeKind === "decision" ? adapter.currentPlayer(environment.state) : null;
  const rootValue = result.rootValues.find((entry) => entry.playerId === side)?.value ?? null;
  const rootVisits = result.policy.reduce((sum, entry) => sum + Number(entry.visits || 0), 0);
  const situation = side ? analyzeSituation(environment, { side }) : null;
  const policy = result.policy.map((entry) => {
    const value = entry.values?.find((item) => item.playerId === side)?.value ?? null;
    return {
      actionKey: entry.actionKey,
      action: entry.action,
      prior: entry.prior,
      visits: entry.visits,
      visitShare: rootVisits > 0 ? entry.visits / rootVisits : 0,
      q: value,
      value,
    };
  }).sort((left, right) => (
    right.visits - left.visits
    || Number(right.q || 0) - Number(left.q || 0)
    || right.prior - left.prior
    || codeUnitCompare(canonicalSerialize(left.actionKey), canonicalSerialize(right.actionKey))
  ));
  return {
    schema: "zizi-el-alamein-alpha-generic-analysis-v1",
    engine: ALPHA_RUNTIME_ENGINE.GENERIC,
    side,
    stateHash: adapter.stateHash(environment.state),
    nodeKind: result.nodeKind,
    rootStateKey: result.rootStateKey,
    rootValue,
    rootValues: result.rootValues,
    bestAction: result.selectedAction,
    selectedActionKey: result.selectedActionKey,
    policy,
    chanceOutcomes: result.chanceOutcomes,
    situation,
    recommendation: null,
    principalVariation: [],
    candidateLines: [],
    requiresChance: result.nodeKind === "chance",
    search: {
      engine: ALPHA_RUNTIME_ENGINE.GENERIC,
      iterations: result.simulations,
      simulations: result.simulations,
      rootVisits,
      rootChildren: result.policy.length,
      maxDepth: result.maxDepth,
      actionLimit: result.actionLimit,
      preApplyLimit: 0,
      elapsedMs,
      ...(diagnostics ? { diagnostics } : {}),
    },
  };
}

export function chooseAlphaRuntimeAction({
  scenario,
  rules,
  board = null,
  state,
  model = null,
  searchOptions = {},
} = {}) {
  return chooseAlphaRuntimeDecision({
    scenario,
    rules,
    board,
    state,
    model,
    searchOptions,
  }).action;
}

export function chooseAlphaRuntimeDecision({
  scenario,
  rules,
  board = null,
  state,
  model = null,
  searchOptions = {},
} = {}) {
  const analysis = analyzeAlphaPosition({
    scenario,
    rules,
    board,
    state,
    model,
    searchOptions,
  });
  return {
    action: analysis.requiresChance ? null : analysis.bestAction,
    analysis,
    decision: summarizeAlphaRuntimeDecision(analysis),
  };
}

export function summarizeAlphaRuntimeDecision(analysis, options = {}) {
  const candidateLimit = Math.max(1, Number(options.candidateLimit || 4));
  const pvLimit = Math.max(0, Number(options.pvLimit || 4));
  const featureLimit = Math.max(0, Number(options.featureLimit || 6));
  const reason = alphaRuntimeDecisionReason(analysis);
  const recommendation = compactAlphaRuntimeRecommendation(analysis?.recommendation);
  return {
    schema: "zizi-el-alamein-alpha-runtime-decision-v1",
    engine: analysis?.engine || ALPHA_RUNTIME_ENGINE.LEGACY,
    ok: reason === null,
    reason,
    side: analysis?.side || null,
    stateHash: analysis?.stateHash || null,
    turn: analysis?.situation?.turn ?? null,
    phaseId: analysis?.situation?.phaseId || null,
    action: reason === null ? compactAlphaRuntimeAction(analysis.bestAction) : null,
    rootValue: rounded(analysis?.rootValue),
    recommendation,
    confidence: recommendation?.confidence ?? null,
    candidates: summarizeAlphaRuntimeCandidates(analysis, {
      candidateLimit,
      pvLimit,
    }),
    principalVariation: (analysis?.principalVariation || [])
      .slice(0, pvLimit)
      .map(compactAlphaRuntimeVariationStep)
      .filter(Boolean),
    features: summarizeAlphaRuntimeFeatures(analysis?.situation?.features, featureLimit),
    search: {
      iterations: finiteNumber(analysis?.search?.iterations, 0),
      rootVisits: finiteNumber(analysis?.search?.rootVisits, 0),
      rootChildren: finiteNumber(analysis?.search?.rootChildren, 0),
      maxDepth: finiteNumber(analysis?.search?.maxDepth, 0),
      actionLimit: finiteNumber(analysis?.search?.actionLimit, 0),
      preApplyLimit: finiteNumber(analysis?.search?.preApplyLimit, 0),
      elapsedMs: finiteNumber(analysis?.search?.elapsedMs, 0),
    },
    requiresChance: Boolean(analysis?.requiresChance),
  };
}

export function handleAlphaRuntimeMessage(message) {
  try {
    if (!message || typeof message !== "object") return errorResponse(message, "invalid_message");
    if (message.type === ALPHA_RUNTIME_MESSAGE.ANALYZE) {
      const analysis = analyzeAlphaPosition(message.payload || {});
      return {
        id: message.id || null,
        type: `${message.type}_RESULT`,
        ok: true,
        analysis,
        decision: summarizeAlphaRuntimeDecision(analysis),
      };
    }
    if (message.type === ALPHA_RUNTIME_MESSAGE.CHOOSE_ACTION) {
      const decision = chooseAlphaRuntimeDecision(message.payload || {});
      return {
        id: message.id || null,
        type: `${message.type}_RESULT`,
        ok: true,
        action: decision.action,
        analysis: decision.analysis,
        decision: decision.decision,
      };
    }
    return errorResponse(message, "unknown_message_type");
  } catch (error) {
    return errorResponse(message, "alpha_runtime_failed", error);
  }
}

function alphaRuntimeDecisionReason(analysis) {
  if (!analysis || typeof analysis !== "object") return "missing_analysis";
  if (analysis.requiresChance) return "requires_chance";
  if (!analysis.bestAction) return "missing_best_action";
  return null;
}

function summarizeAlphaRuntimeCandidates(analysis, options = {}) {
  const candidateLimit = Math.max(1, Number(options.candidateLimit || 4));
  const pvLimit = Math.max(0, Number(options.pvLimit || 4));
  const source = Array.isArray(analysis?.candidateLines) && analysis.candidateLines.length
    ? analysis.candidateLines
    : (analysis?.policy || []);
  return source
    .slice(0, candidateLimit)
    .map((entry, index) => ({
      rank: index + 1,
      action: compactAlphaRuntimeAction(entry.action),
      visits: finiteNumber(entry.visits, 0),
      visitShare: rounded(entry.visitShare),
      q: rounded(entry.q),
      prior: rounded(entry.prior),
      value: entry.value === undefined ? null : rounded(entry.value),
      principalVariation: (entry.principalVariation || [])
        .slice(0, pvLimit)
        .map(compactAlphaRuntimeVariationStep)
        .filter(Boolean),
    }))
    .filter((entry) => entry.action);
}

function compactAlphaRuntimeRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") return null;
  return {
    schema: "zizi-el-alamein-alpha-runtime-recommendation-v1",
    action: compactAlphaRuntimeAction(recommendation.action),
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

function compactAlphaRuntimeVariationStep(step) {
  if (!step || typeof step !== "object") return null;
  return {
    action: compactAlphaRuntimeAction(step.action || step),
    visits: finiteNumber(step.visits, 0),
    q: rounded(step.q),
  };
}

function compactAlphaRuntimeAction(action) {
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
  return compact.type ? compact : null;
}

function summarizeAlphaRuntimeFeatures(features, limit) {
  if (!features || typeof features !== "object" || limit <= 0) return [];
  return Object.entries(features)
    .map(([key, value]) => ({
      key,
      value: rounded(value),
      magnitude: Math.abs(Number(value) || 0),
    }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => right.magnitude - left.magnitude || left.key.localeCompare(right.key))
    .slice(0, limit)
    .map(({ key, value }) => ({ key, value }));
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

function normalizeAlphaModel(model) {
  return normalizeAlphaModelArtifact(model);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Number.isInteger(number) ? number : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : fallback;
  return Math.max(minimum, Math.min(maximum, normalized));
}

function runtimeNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function cloneSafeDiagnosticScalar(value) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function createInternalStageInstrumentation(mode) {
  const v2 = mode === INTERNAL_STAGE_INSTRUMENTATION_V2;
  const environmentContractV1 = mode === ENVIRONMENT_CONTRACT_INSTRUMENTATION_V1;
  const exclusiveNestedTiming = v2 || environmentContractV1;
  const measuredStages = environmentContractV1
    ? [...BASE_INTERNAL_STAGES, ...SEARCH_TRAVERSAL_SUBSTAGES, ...ENVIRONMENT_CONTRACT_SUBSTAGES]
    : v2
      ? [...BASE_INTERNAL_STAGES, ...SEARCH_TRAVERSAL_SUBSTAGES]
      : BASE_INTERNAL_STAGES;
  const totals = Object.fromEntries(measuredStages.map((stage) => [stage, { ms: 0, calls: 0 }]));
  const stack = [];
  const environmentContractCalls = [];
  let environmentContractInclusiveMs = 0;
  let active = true;
  return {
    measure(stage, operation, metadata = null) {
      if (!active || !Object.prototype.hasOwnProperty.call(totals, stage)) return operation();
      const started = runtimeNow();
      const frame = exclusiveNestedTiming ? { childElapsedMs: 0 } : null;
      if (frame) stack.push(frame);
      let result;
      try {
        result = operation();
        return result;
      } finally {
        const elapsed = runtimeNow() - started;
        if (frame) {
          stack.pop();
          totals[stage].ms += Math.max(0, elapsed - frame.childElapsedMs);
          const parent = stack[stack.length - 1];
          if (parent) parent.childElapsedMs += elapsed;
        } else {
          totals[stage].ms += elapsed;
        }
        totals[stage].calls += 1;
        if (environmentContractV1 && stage === "environmentContractValidation") {
          environmentContractInclusiveMs += elapsed;
          environmentContractCalls.push({
            role: cloneSafeDiagnosticScalar(metadata?.role) || "unspecified",
            operation: cloneSafeDiagnosticScalar(metadata?.operation) || "unspecified",
            depth: cloneSafeDiagnosticScalar(metadata?.depth),
            stateHash: cloneSafeDiagnosticScalar(metadata?.stateHash ?? result?.stateHash),
            nodeKind: cloneSafeDiagnosticScalar(metadata?.nodeKind ?? result?.nodeKind),
            legalActionCount: cloneSafeDiagnosticScalar(
              metadata?.legalActionCount
                ?? (Array.isArray(result?.legalActions) ? result.legalActions.length : null),
            ),
            elapsedMs: elapsed,
          });
        }
      }
    },
    finish(internalSearchMs) {
      active = false;
      const total = Number(internalSearchMs);
      const stages = Object.fromEntries(measuredStages.map((stage) => [stage, {
        ms: totals[stage].ms,
        calls: totals[stage].calls,
      }]));
      const existingBaseSubtotalMs = BASE_INTERNAL_STAGES.reduce((sum, stage) => sum + stages[stage].ms, 0);
      if (environmentContractV1) {
        const splitSubstageSubtotalMs = SEARCH_TRAVERSAL_SUBSTAGES
          .reduce((sum, stage) => sum + stages[stage].ms, 0);
        const environmentSubstageSubtotalMs = ENVIRONMENT_CONTRACT_SUBSTAGES
          .reduce((sum, stage) => sum + stages[stage].ms, 0);
        const existingBaseSubtotalMs = BASE_INTERNAL_STAGES.reduce((sum, stage) => sum + stages[stage].ms, 0);
        const namedSubtotalMs = existingBaseSubtotalMs + splitSubstageSubtotalMs + environmentSubstageSubtotalMs;
        const rawSearchFrameworkResidualMs = total - namedSubtotalMs;
        stages.searchFrameworkResidual = {
          ms: Math.max(0, rawSearchFrameworkResidualMs),
          calls: 1,
        };
        const adapterLegalActionsGenerationExcludedMs = stages.legalActionGeneration.ms;
        const environmentContractSelfMs = Math.max(
          0,
          environmentContractInclusiveMs - adapterLegalActionsGenerationExcludedMs,
        );
        const environmentContractResidualMs = Math.max(
          0,
          environmentContractSelfMs - environmentSubstageSubtotalMs,
        );
        const legalActionsValidationCanonicalAggregateMs = [
          "legalActionsWholeResultSerialization",
          "legalEntrySignatureSerialization",
          "legalEntryKeySerializationDuplicateCheck",
        ].reduce((sum, stage) => sum + stages[stage].ms, 0);
        return {
          schema: "zizi-el-alamein-alpha-environment-contract-diagnostics-v1",
          instrumentation: ENVIRONMENT_CONTRACT_INSTRUMENTATION_V1,
          internalSearchMs: total,
          existingBaseSubtotalMs,
          splitSubstageSubtotalMs,
          environmentSubstageSubtotalMs,
          rawSearchFrameworkResidualMs,
          namedSubtotalMs,
          accountedTotalMs: namedSubtotalMs + stages.searchFrameworkResidual.ms,
          stages,
          environmentContract: {
            inclusiveMs: environmentContractInclusiveMs,
            adapterLegalActionsGenerationExcludedMs,
            selfMs: environmentContractSelfMs,
            substageSubtotalMs: environmentSubstageSubtotalMs,
            residualMs: environmentContractResidualMs,
            residualShare: environmentContractSelfMs > 0
              ? environmentContractResidualMs / environmentContractSelfMs
              : 0,
            legalActionsValidationCanonicalAggregateMs,
            stages: Object.fromEntries(ENVIRONMENT_CONTRACT_SUBSTAGES.map((stage) => [stage, stages[stage]])),
            calls: environmentContractCalls,
          },
        };
      }
      if (v2) {
        const splitSubstageSubtotalMs = SEARCH_TRAVERSAL_SUBSTAGES
          .reduce((sum, stage) => sum + stages[stage].ms, 0);
        const namedSubtotalMs = existingBaseSubtotalMs + splitSubstageSubtotalMs;
        const rawSearchFrameworkResidualMs = total - namedSubtotalMs;
        stages.searchFrameworkResidual = {
          ms: Math.max(0, rawSearchFrameworkResidualMs),
          calls: 1,
        };
        const searchTraversalOtherEquivalentMs = splitSubstageSubtotalMs
          + stages.searchFrameworkResidual.ms;
        return {
          schema: "zizi-el-alamein-alpha-internal-substage-diagnostics-v1",
          instrumentation: INTERNAL_STAGE_INSTRUMENTATION_V2,
          internalSearchMs: total,
          existingBaseSubtotalMs,
          splitSubstageSubtotalMs,
          searchTraversalOtherEquivalentMs,
          rawSearchFrameworkResidualMs,
          namedSubtotalMs,
          accountedTotalMs: namedSubtotalMs + stages.searchFrameworkResidual.ms,
          stages,
        };
      }
      const namedSubtotalMs = existingBaseSubtotalMs;
      stages.searchTraversalOther = {
        ms: total - namedSubtotalMs,
        calls: 1,
      };
      return {
        schema: "zizi-el-alamein-alpha-internal-stage-diagnostics-v1",
        instrumentation: INTERNAL_STAGE_INSTRUMENTATION_V1,
        internalSearchMs: total,
        namedSubtotalMs,
        accountedTotalMs: namedSubtotalMs + stages.searchTraversalOther.ms,
        stages,
      };
    },
  };
}

function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorResponse(message, reason, error = null) {
  return {
    id: message?.id || null,
    type: `${message?.type || "ALPHA_RUNTIME"}_RESULT`,
    ok: false,
    reason,
    message: error ? String(error?.message || error) : undefined,
  };
}
