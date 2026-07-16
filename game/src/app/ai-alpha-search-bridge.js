import { runAlphaSearch } from "../../../shared/wargame-alpha/search.js";
import { canonicalSerialize } from "../../../shared/wargame-alpha/environment-contract.js";
import { createEnvironment } from "../core/environment.js";
import {
  alphaHexGraphForward,
  scoreAlphaHexGraphSparsePolicies,
  scoreAlphaHexGraphSparsePolicy,
  scoreAlphaHexGraphValue,
} from "./ai-alpha-hex-graph.js";
import {
  alphaSpatialFeatureContract,
  encodeAlphaSpatialActionsSparse,
  encodeAlphaSpatialActionSparse,
  encodeAlphaSpatialState,
} from "./ai-alpha-spatial.js";
import {
  actionPolicyFeatures,
  scoreAlphaPolicyLogit,
  scoreAlphaValueSample,
} from "./ai-alpha-training.js";
import { createElAlameinAlphaEnvironmentAdapter } from "./ai-alpha-environment-adapter.js";
import { analyzeSituation, evaluateSituation } from "./ai-situation.js";

const EL_ALAMEIN_PLAYERS = Object.freeze(["axis", "allied"]);

function measureStage(instrumentation, stage, operation) {
  return typeof instrumentation?.measure === "function"
    ? instrumentation.measure(stage, operation)
    : operation();
}

function finiteValue(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must return a finite number`);
  return number;
}

function stableSoftmax(logits, temperature) {
  if (!Number.isFinite(temperature) || temperature <= 0) {
    throw new TypeError("policyTemperature must be finite and positive");
  }
  if (!logits.length) return [];
  const scaled = logits.map((value) => finiteValue(value, "policy logit") / temperature);
  const maximum = Math.max(...scaled);
  const weights = scaled.map((value) => Math.exp(Math.max(-60, Math.min(60, value - maximum))));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function makeBoundEnvironment(boundEnvironment, state) {
  return createEnvironment({
    scenario: boundEnvironment.scenario,
    rules: boundEnvironment.rules,
    board: boundEnvironment.board,
    state,
  });
}

function graphContext(environment, side, model) {
  if (!model) return null;
  const contract = alphaSpatialFeatureContract(environment.scenario, environment.board);
  const stateEncoding = encodeAlphaSpatialState({
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
    state: environment.state,
    side,
  });
  const forward = alphaHexGraphForward(stateEncoding, contract, model);
  return forward ? { contract, stateEncoding, forward } : null;
}

function modelForSide(singleModel, modelsBySide, side) {
  if (modelsBySide && Object.prototype.hasOwnProperty.call(modelsBySide, side)) {
    return modelsBySide[side] || null;
  }
  return singleModel;
}

function situationSample(environment, side) {
  const situation = analyzeSituation(environment, { side });
  return {
    situation,
    sample: {
      side,
      turn: situation.turn,
      phaseId: situation.phaseId,
      features: situation.features,
    },
  };
}

export function createElAlameinAlphaSearchEvaluator({
  scenario,
  rules,
  board = null,
  valueModel = null,
  valueModelsBySide = null,
  policyModel = null,
  policyModelsBySide = null,
  hexGraphModel = null,
  hexGraphModelsBySide = null,
  valueWeights = null,
  policyTemperature = 1,
  valueEvaluator = null,
  policyLogitEvaluator = null,
  sparsePolicyBatching = true,
  instrumentation = null,
} = {}) {
  const boundEnvironment = createEnvironment({ scenario, rules, board });
  const cache = new Map();

  function contextFor(stateKey, state) {
    const cacheKey = `${stateKey}|state:${canonicalSerialize(state, "El Alamein evaluator state")}`;
    let context = cache.get(cacheKey);
    if (!context) {
      context = {
        environment: makeBoundEnvironment(boundEnvironment, state),
        situations: new Map(),
        graphs: new Map(),
      };
      cache.set(cacheKey, context);
    }
    return context;
  }

  function sideSituation(context, side) {
    if (!context.situations.has(side)) {
      context.situations.set(side, situationSample(context.environment, side));
    }
    return context.situations.get(side);
  }

  function sideGraph(context, side) {
    if (!context.graphs.has(side)) {
      const model = modelForSide(hexGraphModel, hexGraphModelsBySide, side);
      const graph = graphContext(context.environment, side, model);
      context.graphs.set(side, graph ? { ...graph, model } : null);
    }
    return context.graphs.get(side);
  }

  function valueForSide(context, side) {
    if (!EL_ALAMEIN_PLAYERS.includes(side)) throw new TypeError(`Unsupported El Alamein player: ${String(side)}`);
    if (typeof valueEvaluator === "function") {
      return finiteValue(valueEvaluator({ environment: context.environment, side }), "valueEvaluator");
    }
    const graph = sideGraph(context, side);
    if (graph) {
      const value = scoreAlphaHexGraphValue(
        graph.stateEncoding,
        graph.contract,
        graph.model,
        graph.forward,
      );
      if (Number.isFinite(value)) return Number(value);
    }
    const { situation, sample } = sideSituation(context, side);
    const sideValueModel = modelForSide(valueModel, valueModelsBySide, side);
    if (sideValueModel) return finiteValue(scoreAlphaValueSample(sample, sideValueModel), "value model");
    return finiteValue(evaluateSituation(context.environment, {
      side,
      weights: valueWeights,
      analysis: situation,
    }), "situation evaluator");
  }

  function fallbackPolicyLogit(context, currentPlayer, legalEntry) {
    const sidePolicyModel = modelForSide(policyModel, policyModelsBySide, currentPlayer);
    if (sidePolicyModel) {
      const { sample } = sideSituation(context, currentPlayer);
      const features = actionPolicyFeatures(
        legalEntry.action,
        sample,
        context.environment.scenario,
        context.environment,
      );
      return finiteValue(scoreAlphaPolicyLogit(features, sidePolicyModel), "policy model");
    }
    return 0;
  }

  function policyLogit(context, currentPlayer, legalEntry) {
    if (typeof policyLogitEvaluator === "function") {
      return finiteValue(policyLogitEvaluator({
        environment: context.environment,
        side: currentPlayer,
        action: legalEntry.action,
        actionKey: legalEntry.key,
      }), "policyLogitEvaluator");
    }
    const graph = sideGraph(context, currentPlayer);
    if (graph) {
      const actionEncoding = encodeAlphaSpatialActionSparse(legalEntry.action, {
        scenario: context.environment.scenario,
        board: context.environment.board,
        state: context.environment.state,
      });
      const logit = scoreAlphaHexGraphSparsePolicy(
        graph.stateEncoding,
        actionEncoding,
        graph.contract,
        graph.model,
        graph.forward,
      );
      if (Number.isFinite(logit)) return Number(logit);
    }
    return fallbackPolicyLogit(context, currentPlayer, legalEntry);
  }

  function policyLogits(context, currentPlayer, legalActions) {
    if (!sparsePolicyBatching || typeof policyLogitEvaluator === "function") {
      return legalActions.map((entry) => policyLogit(context, currentPlayer, entry));
    }
    const graph = sideGraph(context, currentPlayer);
    if (!graph) return legalActions.map((entry) => fallbackPolicyLogit(context, currentPlayer, entry));
    const actionEncodings = measureStage(
      instrumentation,
      "batchActionEncoding",
      () => encodeAlphaSpatialActionsSparse(
        legalActions.map((entry) => entry.action),
        {
          scenario: context.environment.scenario,
          board: context.environment.board,
          state: context.environment.state,
        },
      ),
    );
    const logits = measureStage(
      instrumentation,
      "batchPolicyScoring",
      () => scoreAlphaHexGraphSparsePolicies(
        graph.stateEncoding,
        actionEncodings,
        graph.contract,
        graph.model,
        graph.forward,
      ),
    );
    if (!Array.isArray(logits) || logits.length !== legalActions.length) {
      return legalActions.map((entry) => policyLogit(context, currentPlayer, entry));
    }
    return logits.map((logit, index) => (
      Number.isFinite(logit)
        ? Number(logit)
        : fallbackPolicyLogit(context, currentPlayer, legalActions[index])
    ));
  }

  return function evaluateElAlameinState({
    adapter,
    state,
    stateKey,
    currentPlayer,
    legalActions,
  }) {
    const context = contextFor(stateKey, state);
    const values = adapter.players.map((playerId) => measureStage(
      instrumentation,
      "stateForwardValue",
      () => ({
        playerId,
        value: valueForSide(context, playerId),
      }),
    ));
    const logits = policyLogits(context, currentPlayer, legalActions);
    const priors = measureStage(
      instrumentation,
      "softmaxNormalization",
      () => stableSoftmax(logits, policyTemperature),
    );
    return {
      values,
      policy: legalActions.map((entry, index) => ({
        actionKey: entry.key,
        prior: priors[index],
      })),
    };
  };
}

export function searchElAlameinAlpha(environment, options = {}) {
  const adapter = options.adapter || createElAlameinAlphaEnvironmentAdapter({
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
  });
  const evaluate = options.evaluate || createElAlameinAlphaSearchEvaluator({
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
    valueModel: options.valueModel,
    valueModelsBySide: options.valueModelsBySide,
    policyModel: options.policyModel,
    policyModelsBySide: options.policyModelsBySide,
    hexGraphModel: options.hexGraphModel,
    hexGraphModelsBySide: options.hexGraphModelsBySide,
    valueWeights: options.valueWeights,
    policyTemperature: options.policyTemperature,
    valueEvaluator: options.valueEvaluator,
    policyLogitEvaluator: options.policyLogitEvaluator,
    sparsePolicyBatching: options.sparsePolicyBatching,
    instrumentation: options.instrumentation,
  });
  return runAlphaSearch({
    adapter,
    state: environment.state,
    evaluate,
    instrumentation: options.instrumentation,
    simulations: options.simulations,
    maxDepth: options.maxDepth,
    actionLimit: options.actionLimit,
    exploration: options.exploration,
    reuseValidatedLegalEntries: options.reuseValidatedLegalEntries,
  });
}
