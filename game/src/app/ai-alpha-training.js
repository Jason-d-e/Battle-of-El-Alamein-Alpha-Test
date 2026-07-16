import {
  createBoard,
  getHex,
  liveUnits,
  unitById,
} from "../core/index.js";
import {
  DEFAULT_SITUATION_WEIGHTS,
  nearestDistanceToAny,
} from "./ai-situation.js";
import {
  alphaDenseNetworkForward,
  applyAlphaDenseNetworkGradient,
  createAlphaDenseNetwork,
  normalizeAlphaDenseNetwork,
} from "./ai-alpha-network.js";
import {
  buildTrajectoryLineageComponents,
  unionTrajectoryIds,
} from "../../../shared/wargame-alpha/trajectory-lineage.js";
import { canonicalSerialize } from "../../../shared/wargame-alpha/environment-contract.js";
import { canonicalSha256 } from "../../../shared/wargame-alpha/fingerprint.js";
import {
  evaluateAlphaHexGraphModel,
  trainAlphaHexGraphModel,
} from "./ai-alpha-hex-graph.js";
import { buildAlphaSpatialDataset } from "./ai-alpha-spatial.js";
import {
  ALPHA_MODEL_SCHEMA,
  ALPHA_TRAINING_DATA_SUMMARY_SCHEMA,
  ALPHA_TRAINING_METADATA_SCHEMA,
  alphaModelFeatureContract,
  alphaModelEnvironmentFingerprint,
  alphaModelMetadata,
} from "./ai-alpha-model.js";

export const VALUE_FEATURE_SCALES = Object.freeze({
  turnProgress: 1,
  materialBalance: 80,
  unitBalance: 30,
  axisObjectiveHeld: 1,
  axisObjectiveProgress: 18,
  axisObjectivePressure: 8,
  axisObjectiveLocalAdvantage: 50,
  alliedExitPressure: 8,
  alliedExitLocalAdvantage: 50,
  alliedBreakthroughReady: 1,
  axisDeadlineRisk: 1,
  friendlyCohesion: 100,
  enemyCohesion: 100,
  friendlyThreats: 80,
  enemyThreats: 80,
});

export const POLICY_FEATURE_KEYS = Object.freeze([
  "bias",
  "axisSide",
  "alliedSide",
  "turnProgress",
  "movementPhase",
  "combatPhase",
  "retreatPhase",
  "advancePhase",
  "stateMaterialBalance",
  "stateUnitBalance",
  "stateAxisObjectiveHeld",
  "stateAxisObjectiveProgress",
  "stateAxisObjectivePressure",
  "stateAxisObjectiveLocalAdvantage",
  "stateAlliedExitPressure",
  "stateAlliedExitLocalAdvantage",
  "stateAlliedBreakthroughReady",
  "stateAxisDeadlineRisk",
  "stateFriendlyCohesion",
  "stateEnemyCohesion",
  "stateFriendlyThreats",
  "stateEnemyThreats",
  "move",
  "declareCombat",
  "finishDeclarations",
  "endPhase",
  "retreat",
  "advance",
  "skipAdvance",
  "routeRemaining",
  "routeSpent",
  "attackerCount",
  "movingUnitCombat",
  "movingUnitMovement",
  "targetFriendlyForceR1",
  "targetEnemyForceR1",
  "targetFriendlyForceR2",
  "targetEnemyForceR2",
  "targetForceAdvantageR1",
  "targetForceAdvantageR2",
  "axisObjectiveDistanceGain",
  "alliedExitDistanceGain",
  "attackerStrength",
  "defenderStrength",
  "combatForceAdvantage",
  "targetHighland",
  "targetSettlement",
  "targetRoad",
  "targetBritishPosition",
  "axisObjectiveDestination",
  "alliedExitDestination",
  "moveWithAxisObjectivePressure",
  "moveWithAxisObjectiveProgress",
  "moveWithAxisObjectiveLocalAdvantage",
  "combatWithFriendlyThreats",
  "combatWithEnemyThreats",
  "combatWithAxisObjectiveLocalAdvantage",
  "retreatWithEnemyThreats",
  "advanceWithAxisObjectivePressure",
  "advanceWithAxisObjectiveLocalAdvantage",
  "skipAdvanceWithEnemyThreats",
  "endPhaseWithAxisObjectivePressure",
  "moveWithAlliedExitLocalAdvantage",
  "endPhaseWithAlliedExitLocalAdvantage",
  "endPhaseWithAlliedBreakthroughReady",
  "endPhaseWithAxisDeadlineRisk",
  "endPhaseWithEnemyThreats",
]);

export const ALPHA_EXPLICIT_SAMPLES_SCHEMA = "zizi-el-alamein-alpha-explicit-samples-v1";

export const ALPHA_DENSE_RESIDUAL_ARCHITECTURE = "dense-residual-v1";

const VALUE_FEATURE_KEYS = Object.freeze(Object.keys(VALUE_FEATURE_SCALES));
const ALPHA_TRAINING_VALIDATION_SCHEMA = "zizi-el-alamein-alpha-training-validation-v1";
const ALPHA_TRAINING_VALIDATION_GROUP_BY = Object.freeze(["sample", "stateHash", "side", "phase", "trajectory"]);
const DEFAULT_ITERATIONS = 80;
const DEFAULT_VALUE_LEARNING_RATE = 0.035;
const DEFAULT_POLICY_LEARNING_RATE = 0.08;
const DEFAULT_POLICY_REFERENCE_VISITS = 64;
const MAX_WEIGHT = 8;
const BOARDS_BY_SCENARIO = new WeakMap();
const POLICY_ONLY_OUTCOME_SOURCES = new Set([
  "guard_zero",
  "human_policy_only",
  "policy_only_guard",
  "policy_only_merged",
  "policy_only_unresolved",
  "unresolved",
]);

export function flattenAlphaSelfPlaySamples(logs) {
  return (logs || []).flatMap((log, fileIndex) => {
    if (log?.schema === "wargame-alpha-human-demonstration-dataset-v1") {
      throw new Error("Human demonstration datasets require explicit rule-authoritative conversion");
    }
    const source = log?.source || log?.path || `input-${fileIndex + 1}`;
    if (Array.isArray(log)) {
      return log.map((sample, sampleIndex) => annotateSample(sample, source, sampleIndex));
    }
    if (Array.isArray(log?.results)) {
      return log.results.flatMap((result, resultIndex) => (
        (result.samples || []).map((sample, sampleIndex) => annotateSample(sample, source, sampleIndex, resultIndex))
      ));
    }
    if (Array.isArray(log?.samples)) {
      return log.samples.map((sample, sampleIndex) => annotateSample(sample, source, sampleIndex));
    }
    if (log?.schema === "zizi-el-alamein-alpha-training-sample-v1") return [annotateSample(log, source, 0)];
    return [];
  });
}

export function alphaTrainingValueTarget(sample) {
  const source = typeof sample?.outcomeSource === "string" ? sample.outcomeSource : null;
  const rawOutcome = sample?.outcome;
  const hasOutcome = sample?.outcome !== null && sample?.outcome !== undefined && sample?.outcome !== "";
  const outcome = hasOutcome ? Number(rawOutcome) : Number.NaN;
  const rawWeight = Number(sample?.outcomeWeight ?? 1);
  const outcomeWeight = Number.isFinite(rawWeight) ? clamp(rawWeight, 0, 1) : 1;
  if (POLICY_ONLY_OUTCOME_SOURCES.has(source)) {
    return { usable: false, reason: "policy_only", source, outcome: null, outcomeWeight: 0, authoritative: false };
  }
  if (
    source === "terminal_result"
    && (typeof rawOutcome !== "number" || !Number.isFinite(rawOutcome) || (rawOutcome !== -1 && rawOutcome !== 1))
  ) {
    return { usable: false, reason: "invalid_terminal_outcome", source, outcome: null, outcomeWeight: 0, authoritative: true };
  }
  if (!Number.isFinite(outcome)) {
    return { usable: false, reason: "missing_outcome", source, outcome: null, outcomeWeight: 0, authoritative: false };
  }
  if (!(outcomeWeight > 0)) {
    return { usable: false, reason: "zero_weight", source, outcome: clamp(outcome, -1, 1), outcomeWeight: 0, authoritative: false };
  }
  return {
    usable: true,
    reason: null,
    source,
    outcome: clamp(outcome, -1, 1),
    outcomeWeight,
    authoritative: source === "terminal_result",
  };
}

export function trainAlphaModelFromSelfPlay(logs, options = {}) {
  const samples = flattenAlphaSelfPlaySamples(logs);
  return trainAlphaModelFromSamples(samples, options);
}

export function trainAlphaModelFromSamples(samples, options = {}) {
  const inputSamples = Array.isArray(samples) ? samples : [];
  const hasExplicitValidation = Object.prototype.hasOwnProperty.call(options, "validationSamples");
  if (hasExplicitValidation && !Array.isArray(options.validationSamples)) {
    throw new Error("Alpha explicit validationSamples must be an array");
  }
  const explicitValidationSamples = hasExplicitValidation ? options.validationSamples : [];
  const featureContract = options.featureContract || alphaTrainingFeatureContract();
  const sampleFeatureContractGate = validateAlphaTrainingSampleFeatureContracts(
    hasExplicitValidation ? [...inputSamples, ...explicitValidationSamples] : inputSamples,
    featureContract,
    {
    requireFeatureContract: options.requireSampleFeatureContract,
    },
  );
  if (!sampleFeatureContractGate.ok) {
    throw new Error(`Alpha training sample feature contract check failed: ${sampleFeatureContractGate.reason}`);
  }
  const split = hasExplicitValidation
    ? makeExplicitAlphaTrainingSplit(inputSamples, explicitValidationSamples, {
      ...(options.validation || {}),
      ...(options.explicitValidation || {}),
    })
    : splitAlphaTrainingSamples(inputSamples, options.validation || options);
  const trainingSamples = split.trainingSamples;
  const validationSamples = split.validationSamples;
  const valueOptions = options.value || options;
  const policyOptions = { scenario: options.scenario, ...(options.policy || options) };
  const value = valueOptions.freeze && options.parentModel?.value
    ? frozenValueModel(options.parentModel.value, trainingSamples)
    : trainAlphaValueModel(trainingSamples, valueOptions);
  const policy = policyOptions.freeze && options.parentModel?.policy
    ? frozenPolicyModel(options.parentModel.policy, trainingSamples, policyOptions)
    : trainAlphaPolicyModel(trainingSamples, policyOptions);
  const hexGraphDataset = spatialDatasetForTraining(trainingSamples, options);
  const hexGraph = hexGraphDataset
    ? trainAlphaHexGraphModel(hexGraphDataset, {
      ...(options.hexGraph || {}),
      baseModel: options.hexGraph?.baseModel || options.parentModel?.hexGraph || null,
    })
    : null;
  let validation = validationSamples.length
    ? evaluateAlphaTrainingValidation(validationSamples, {
      value,
      policy,
      scenario: options.scenario,
      split,
    })
    : null;
  if (validation && hexGraph) {
    const validationDataset = spatialDatasetForTraining(validationSamples, options, { requireEnabled: false });
    validation = {
      ...validation,
      hexGraph: validationDataset ? evaluateAlphaHexGraphModel(validationDataset, hexGraph) : null,
    };
  }
  return makeAlphaModelArtifact({
    value,
    policy,
    hexGraph,
    sampleCount: inputSamples.length,
    sources: [...new Set(inputSamples.map((sample) => sample.__source).filter(Boolean))],
    environment: options.environment || alphaModelEnvironmentFingerprint({
      scenario: options.scenario,
      rules: options.rules,
    }),
    featureContract,
    training: makeAlphaTrainingMetadata(options.parentModel, trainingSamples, validation),
  });
}

export function validateAlphaExplicitSamplesArtifact(value, expectedSplit = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid_explicit_samples_artifact" };
  }
  if (value.schema !== ALPHA_EXPLICIT_SAMPLES_SCHEMA) {
    return { ok: false, reason: "invalid_explicit_samples_schema" };
  }
  if (!["training", "validation"].includes(value.split) || (expectedSplit && value.split !== expectedSplit)) {
    return { ok: false, reason: "invalid_explicit_samples_split" };
  }
  if (!isCanonicalSha256(value.environmentFingerprint)) {
    return { ok: false, reason: "invalid_explicit_samples_environment_fingerprint" };
  }
  if (!Array.isArray(value.samples) || value.samples.length !== Number(value.sampleCount)) {
    return { ok: false, reason: "invalid_explicit_samples_count" };
  }
  if (!value.samples.length) return { ok: false, reason: "empty_explicit_samples" };
  if (!Array.isArray(value.sampleFingerprints) || value.sampleFingerprints.length !== value.samples.length) {
    return { ok: false, reason: "invalid_explicit_sample_fingerprints" };
  }
  for (const [index, sample] of value.samples.entries()) {
    if (typeof sample?.stateHash !== "string" || !sample.stateHash) {
      return { ok: false, reason: `explicit_sample_missing_state_hash:${index}` };
    }
    if (!Array.isArray(sample.trajectoryIds) || !sample.trajectoryIds.length) {
      return { ok: false, reason: `explicit_sample_missing_trajectory_ids:${index}` };
    }
    if (!sample.trajectoryIds.every(isCanonicalSha256)) {
      return { ok: false, reason: `explicit_sample_invalid_trajectory_id:${index}` };
    }
  }
  const sampleFingerprints = value.samples.map((sample) => canonicalSha256(sample, "Alpha explicit sample"));
  if (!sameOrderedStrings(sampleFingerprints, value.sampleFingerprints)) {
    return { ok: false, reason: "explicit_sample_fingerprint_mismatch" };
  }
  const trajectoryIds = unionTrajectoryIds(...value.samples.map((sample) => sample.trajectoryIds));
  if (
    !Array.isArray(value.trajectoryIds)
    || Number(value.trajectoryCount) !== trajectoryIds.length
    || !sameOrderedStrings(trajectoryIds, value.trajectoryIds)
  ) {
    return { ok: false, reason: "explicit_trajectory_manifest_mismatch" };
  }
  const fingerprintPayload = { ...value };
  delete fingerprintPayload.samples;
  delete fingerprintPayload.artifactFingerprint;
  if (
    !isCanonicalSha256(value.artifactFingerprint)
    || canonicalSha256(fingerprintPayload, "Alpha explicit samples artifact") !== value.artifactFingerprint
  ) {
    return { ok: false, reason: "explicit_artifact_fingerprint_mismatch" };
  }
  return {
    ok: true,
    reason: null,
    samples: value.samples.slice(),
    metadata: {
      schema: value.schema,
      split: value.split,
      environmentFingerprint: value.environmentFingerprint,
      artifactFingerprint: value.artifactFingerprint,
      sampleCount: value.samples.length,
      trajectoryCount: trajectoryIds.length,
      trajectoryIds,
    },
  };
}

function frozenValueModel(parentValue, samples) {
  const model = JSON.parse(JSON.stringify(parentValue));
  return { ...model, metrics: evaluateAlphaValueModel(samples, model) };
}

function frozenPolicyModel(parentPolicy, samples, options) {
  const model = JSON.parse(JSON.stringify(parentPolicy));
  return { ...model, metrics: evaluateAlphaPolicyModel(policyRowsFromSamples(samples, options), model) };
}

export function alphaTrainingFeatureContract() {
  return alphaModelFeatureContract({
    valueFeatureScales: VALUE_FEATURE_SCALES,
    policyFeatureKeys: POLICY_FEATURE_KEYS,
  });
}

export function alphaTrainingSampleFeatureContract(contract = alphaTrainingFeatureContract()) {
  if (!contract?.schema || !contract?.fingerprint) return null;
  return {
    schema: contract.schema,
    fingerprint: contract.fingerprint,
  };
}

export function alphaTrainingSampleFeatureContractFingerprint(sample) {
  const contract = sample?.featureContract;
  if (contract && typeof contract === "object" && typeof contract.fingerprint === "string") {
    return contract.fingerprint;
  }
  if (typeof sample?.featureContractFingerprint === "string") return sample.featureContractFingerprint;
  return null;
}

export function validateAlphaTrainingSampleFeatureContracts(samples = [], expectedContract = alphaTrainingFeatureContract(), options = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const expected = alphaTrainingSampleFeatureContract(expectedContract);
  const requireFeatureContract = Boolean(options.requireFeatureContract);
  let missingSampleCount = 0;
  let mismatchedSampleCount = 0;
  const featureContracts = {};
  for (const sample of rows) {
    const fingerprint = alphaTrainingSampleFeatureContractFingerprint(sample);
    if (!fingerprint) {
      missingSampleCount += 1;
      continue;
    }
    featureContracts[fingerprint] = (featureContracts[fingerprint] || 0) + 1;
    if (expected?.fingerprint && fingerprint !== expected.fingerprint) mismatchedSampleCount += 1;
  }
  const ok = mismatchedSampleCount === 0 && (!requireFeatureContract || missingSampleCount === 0);
  return {
    ok,
    reason: ok
      ? null
      : mismatchedSampleCount > 0
        ? "sample_feature_contract_mismatch"
        : "missing_sample_feature_contract",
    expectedFingerprint: expected?.fingerprint || null,
    sampleCount: rows.length,
    samplesWithFeatureContract: rows.length - missingSampleCount,
    missingSampleCount,
    mismatchedSampleCount,
    featureContracts,
  };
}

export function trainAlphaValueModel(samples, options = {}) {
  const usable = (samples || []).filter((sample) => sample?.features && alphaTrainingValueTarget(sample).usable);
  const weights = initializeValueWeights(options.baseWeights);
  const architecture = normalizeAlphaHeadArchitecture(options.architecture, options.baseNetwork);
  const network = architecture === ALPHA_DENSE_RESIDUAL_ARCHITECTURE
    ? createAlphaDenseNetwork({
      featureKeys: VALUE_FEATURE_KEYS,
      hiddenSize: options.hiddenSize,
      seed: options.networkSeed || "el-alamein-alpha-value-v1",
      baseNetwork: options.baseNetwork,
      weightScale: options.weightScale,
    })
    : null;
  const learningRate = Number(options.learningRate || DEFAULT_VALUE_LEARNING_RATE);
  const iterations = Math.max(1, Number(options.iterations || DEFAULT_ITERATIONS));
  const shuffleSeed = options.shuffleSeed || options.networkSeed || "el-alamein-alpha-value-shuffle-v1";

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const epochSamples = options.shuffle === false
      ? usable
      : deterministicEpochOrder(usable, shuffleSeed, iteration, trainingSampleKey);
    for (const sample of epochSamples) {
      const target = clamp(Number(sample.outcome), -1, 1);
      const forward = alphaValueHeadForward(sample, {
        weights,
        featureKeys: VALUE_FEATURE_KEYS,
        featureScales: VALUE_FEATURE_SCALES,
        network,
      });
      const prediction = forward.value;
      const error = prediction - target;
      const slope = 1 - prediction * prediction;
      const sampleWeight = valueSampleWeight(sample);
      for (const key of VALUE_FEATURE_KEYS) {
        const featureValue = Number(forward.features[key] || 0);
        weights[key] = clampWeight(weights[key] - learningRate * sampleWeight * error * slope * featureValue);
      }
      if (network && forward.network) {
        applyAlphaDenseNetworkGradient(
          network,
          forward.network,
          sampleWeight * error * slope,
          learningRate,
        );
      }
    }
  }

  const model = {
    schema: "zizi-el-alamein-alpha-value-model-v1",
    featureKeys: VALUE_FEATURE_KEYS.slice(),
    featureScales: { ...VALUE_FEATURE_SCALES },
    weights,
    ...(network ? { architecture, network } : {}),
  };
  return {
    ...model,
    metrics: evaluateAlphaValueModel(usable, model),
  };
}

export function evaluateAlphaValueModel(samples, model = {}) {
  const usable = (samples || []).filter((sample) => sample?.features && alphaTrainingValueTarget(sample).usable);
  if (!usable.length) {
    return {
      samples: 0,
      mse: null,
      mae: null,
      weightedMse: null,
      weightedMae: null,
      averageWeight: 0,
      signAccuracy: null,
      averagePrediction: null,
      averageTarget: null,
      calibrationBias: null,
      weightedCalibrationBias: null,
      averageConfidence: null,
      confidentSamples: 0,
      confidentSignAccuracy: null,
    };
  }
  let squared = 0;
  let absolute = 0;
  let weightedSquared = 0;
  let weightedAbsolute = 0;
  let weightSum = 0;
  let signMatches = 0;
  let predictionSum = 0;
  let targetSum = 0;
  let weightedPredictionSum = 0;
  let weightedTargetSum = 0;
  let confidenceSum = 0;
  let confidentSamples = 0;
  let confidentSignMatches = 0;
  for (const sample of usable) {
    const target = clamp(Number(sample.outcome), -1, 1);
    const prediction = scoreAlphaValueSample(sample, model);
    const error = prediction - target;
    const sampleWeight = valueSampleWeight(sample);
    squared += error * error;
    absolute += Math.abs(error);
    weightedSquared += sampleWeight * error * error;
    weightedAbsolute += sampleWeight * Math.abs(error);
    weightSum += sampleWeight;
    predictionSum += prediction;
    targetSum += target;
    weightedPredictionSum += sampleWeight * prediction;
    weightedTargetSum += sampleWeight * target;
    confidenceSum += Math.abs(prediction);
    if (Math.sign(prediction) === Math.sign(target) || target === 0) signMatches += 1;
    if (Math.abs(prediction) >= 0.5) {
      confidentSamples += 1;
      if (Math.sign(prediction) === Math.sign(target) || target === 0) confidentSignMatches += 1;
    }
  }
  const averagePrediction = predictionSum / usable.length;
  const averageTarget = targetSum / usable.length;
  const weightedAveragePrediction = weightSum > 0 ? weightedPredictionSum / weightSum : null;
  const weightedAverageTarget = weightSum > 0 ? weightedTargetSum / weightSum : null;
  return {
    samples: usable.length,
    mse: round(squared / usable.length, 6),
    mae: round(absolute / usable.length, 6),
    weightedMse: weightSum > 0 ? round(weightedSquared / weightSum, 6) : null,
    weightedMae: weightSum > 0 ? round(weightedAbsolute / weightSum, 6) : null,
    averageWeight: round(weightSum / usable.length, 4),
    signAccuracy: round(signMatches / usable.length, 4),
    averagePrediction: round(averagePrediction, 6),
    averageTarget: round(averageTarget, 6),
    calibrationBias: round(averagePrediction - averageTarget, 6),
    weightedCalibrationBias: weightSum > 0
      ? round(Number(weightedAveragePrediction) - Number(weightedAverageTarget), 6)
      : null,
    averageConfidence: round(confidenceSum / usable.length, 6),
    confidentSamples,
    confidentSignAccuracy: confidentSamples ? round(confidentSignMatches / confidentSamples, 4) : null,
  };
}

export function scoreAlphaValueSample(sample, model = {}) {
  return alphaValueHeadForward(sample, model).value;
}

export function alphaValueFeatureContributions(sample, model = {}) {
  const weights = model.weights || initializeValueWeights(model.baseWeights);
  const featureScales = {
    ...VALUE_FEATURE_SCALES,
    ...(model.featureScales || {}),
  };
  const featureKeys = Array.isArray(model.featureKeys) && model.featureKeys.length
    ? model.featureKeys.map(String)
    : VALUE_FEATURE_KEYS;
  const signed = signedValueFeatures(sample);
  const normalizedFeatures = {};
  let linearScore = 0;
  const entries = featureKeys.map((key) => {
    const raw = Number(signed[key] || 0);
    const normalized = normalizeValueFeature(key, raw, featureScales);
    normalizedFeatures[key] = normalized;
    const weight = Number(weights[key] || 0);
    const contribution = weight * normalized;
    linearScore += contribution;
    return {
      key,
      raw: round(raw, 6),
      normalized: round(normalized, 6),
      weight: round(weight, 6),
      contribution: round(contribution, 6),
      direction: contribution > 0 ? "supports" : contribution < 0 ? "opposes" : "neutral",
    };
  });
  const networkForward = alphaDenseNetworkForward(normalizedFeatures, model.network);
  const networkScore = Number(networkForward?.output || 0);
  const rawScore = linearScore + networkScore;
  return {
    schema: "zizi-el-alamein-alpha-value-explanation-v1",
    side: sample?.side || null,
    turn: sample?.turn ?? null,
    phaseId: sample?.phaseId || null,
    rawScore: round(rawScore, 6),
    value: round(Math.tanh(rawScore), 6),
    architecture: networkForward ? ALPHA_DENSE_RESIDUAL_ARCHITECTURE : "linear-v1",
    linearScore: round(linearScore, 6),
    networkScore: round(networkScore, 6),
    entries: sortFeatureContributions(entries),
  };
}

export function trainAlphaPolicyModel(samples, options = {}) {
  const rows = policyRowsFromSamples(samples, options);
  const groups = groupPolicyRows(rows);
  const weights = initializePolicyWeights(options.baseWeights);
  const architecture = normalizeAlphaHeadArchitecture(options.architecture, options.baseNetwork);
  const network = architecture === ALPHA_DENSE_RESIDUAL_ARCHITECTURE
    ? createAlphaDenseNetwork({
      featureKeys: POLICY_FEATURE_KEYS,
      hiddenSize: options.hiddenSize,
      seed: options.networkSeed || "el-alamein-alpha-policy-v1",
      baseNetwork: options.baseNetwork,
      weightScale: options.weightScale,
    })
    : null;
  const learningRate = Number(options.learningRate || DEFAULT_POLICY_LEARNING_RATE);
  const iterations = Math.max(1, Number(options.iterations || DEFAULT_ITERATIONS));
  const shuffleSeed = options.shuffleSeed || options.networkSeed || "el-alamein-alpha-policy-shuffle-v1";

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const epochGroups = options.shuffle === false
      ? groups
      : deterministicEpochOrder(groups, shuffleSeed, iteration, policyGroupKey);
    for (const group of epochGroups) {
      const groupWeight = policyGroupWeight(group);
      const forwards = group.map((row) => alphaPolicyHeadForward(row.features, {
        weights,
        featureKeys: POLICY_FEATURE_KEYS,
        network,
      }));
      const probabilities = softmax(forwards.map((forward) => forward.logit));
      const targets = normalizePolicyTargets(group);
      for (let rowIndex = 0; rowIndex < group.length; rowIndex += 1) {
        const row = group[rowIndex];
        const error = (probabilities[rowIndex] - targets[rowIndex]) * groupWeight;
        for (const key of POLICY_FEATURE_KEYS) {
          weights[key] = clampWeight(weights[key] - learningRate * error * Number(row.features[key] || 0));
        }
        if (network && forwards[rowIndex].network) {
          applyAlphaDenseNetworkGradient(network, forwards[rowIndex].network, error, learningRate);
        }
      }
    }
  }

  const model = {
    schema: "zizi-el-alamein-alpha-policy-model-v1",
    featureKeys: POLICY_FEATURE_KEYS.slice(),
    weights,
    ...(network ? { architecture, network } : {}),
  };
  return {
    ...model,
    metrics: evaluateAlphaPolicyModel(rows, model),
  };
}

export function evaluateAlphaPolicyModel(rowsOrSamples, model = {}) {
  const rows = rowsOrSamples?.[0]?.features && rowsOrSamples?.[0]?.target !== undefined
    ? rowsOrSamples
    : policyRowsFromSamples(rowsOrSamples || [], model);
  if (!rows.length) {
    return {
      rows: 0,
      mse: null,
      crossEntropy: null,
      weightedMse: null,
      weightedCrossEntropy: null,
      averageWeight: 0,
      topChoiceAccuracy: null,
    };
  }
  let squared = 0;
  let crossEntropy = 0;
  let weightedSquared = 0;
  let weightedCrossEntropy = 0;
  let weightSum = 0;
  let topMatches = 0;
  let groups = 0;
  for (const group of groupPolicyRows(rows)) {
    groups += 1;
    const groupWeight = policyGroupWeight(group);
    const probabilities = softmax(group.map((row) => scoreAlphaPolicyLogit(row.features, model)));
    const targets = normalizePolicyTargets(group);
    for (let index = 0; index < group.length; index += 1) {
      const error = probabilities[index] - targets[index];
      const rowCrossEntropy = -targets[index] * Math.log(Math.max(1e-12, probabilities[index]));
      squared += error * error;
      crossEntropy += rowCrossEntropy;
      weightedSquared += groupWeight * error * error;
      weightedCrossEntropy += groupWeight * rowCrossEntropy;
    }
    weightSum += groupWeight * group.length;
    const predicted = group
      .map((row, index) => ({ ...row, prediction: probabilities[index] }))
      .sort((a, b) => b.prediction - a.prediction || a.actionKey.localeCompare(b.actionKey))[0];
    const target = group
      .slice()
      .sort((a, b) => b.target - a.target || a.actionKey.localeCompare(b.actionKey))[0];
    if (predicted?.actionKey === target?.actionKey) topMatches += 1;
  }

  return {
    rows: rows.length,
    mse: round(squared / rows.length, 6),
    crossEntropy: round(crossEntropy / Math.max(1, groups), 6),
    weightedMse: weightSum > 0 ? round(weightedSquared / weightSum, 6) : null,
    weightedCrossEntropy: weightSum > 0 ? round(weightedCrossEntropy / Math.max(1, groups), 6) : null,
    averageWeight: round(weightSum / rows.length, 4),
    topChoiceAccuracy: groups ? round(topMatches / groups, 4) : null,
  };
}

export function scoreAlphaPolicyFeatures(features, model = {}) {
  return sigmoid(scoreAlphaPolicyLogit(features, model));
}

export function scoreAlphaPolicyLogit(features, model = {}) {
  return alphaPolicyHeadForward(features, model).logit;
}

function alphaValueHeadForward(sample, model = {}) {
  const weights = model.weights || initializeValueWeights(model.baseWeights);
  const featureScales = {
    ...VALUE_FEATURE_SCALES,
    ...(model.featureScales || {}),
  };
  const featureKeys = Array.isArray(model.featureKeys) && model.featureKeys.length
    ? model.featureKeys.map(String)
    : VALUE_FEATURE_KEYS;
  const signed = signedValueFeatures(sample);
  const features = Object.fromEntries(featureKeys.map((key) => [
    key,
    normalizeValueFeature(key, signed[key], featureScales),
  ]));
  let linearScore = 0;
  for (const key of featureKeys) linearScore += Number(weights[key] || 0) * Number(features[key] || 0);
  const network = alphaDenseNetworkForward(features, model.network);
  const rawScore = linearScore + Number(network?.output || 0);
  return {
    value: Math.tanh(rawScore),
    rawScore,
    linearScore,
    features,
    network,
  };
}

function alphaPolicyHeadForward(features, model = {}) {
  const weights = model.weights || initializePolicyWeights(model.baseWeights);
  const featureKeys = Array.isArray(model.featureKeys) && model.featureKeys.length
    ? model.featureKeys.map(String)
    : POLICY_FEATURE_KEYS;
  let linearScore = 0;
  for (const key of featureKeys) linearScore += Number(weights[key] || 0) * Number(features?.[key] || 0);
  const network = alphaDenseNetworkForward(features, model.network);
  return {
    logit: linearScore + Number(network?.output || 0),
    linearScore,
    network,
  };
}

function normalizeAlphaHeadArchitecture(value, baseNetwork = null) {
  const name = String(value || "").trim().toLowerCase();
  if (
    name === ALPHA_DENSE_RESIDUAL_ARCHITECTURE
    || name === "dense"
    || name === "mlp"
    || name === "network"
    || normalizeAlphaDenseNetwork(baseNetwork)
  ) {
    return ALPHA_DENSE_RESIDUAL_ARCHITECTURE;
  }
  return "linear-v1";
}

export function alphaPolicyFeatureContributions(features, model = {}) {
  const weights = model.weights || initializePolicyWeights(model.baseWeights);
  const featureKeys = Array.isArray(model.featureKeys) && model.featureKeys.length
    ? model.featureKeys.map(String)
    : POLICY_FEATURE_KEYS;
  let linearScore = 0;
  const entries = featureKeys.map((key) => {
    const value = Number(features?.[key] || 0);
    const weight = Number(weights[key] || 0);
    const contribution = weight * value;
    linearScore += contribution;
    return {
      key,
      value: round(value, 6),
      weight: round(weight, 6),
      contribution: round(contribution, 6),
      direction: contribution > 0 ? "supports" : contribution < 0 ? "opposes" : "neutral",
    };
  });
  const networkForward = alphaDenseNetworkForward(features, model.network);
  const networkScore = Number(networkForward?.output || 0);
  const logit = linearScore + networkScore;
  return {
    schema: "zizi-el-alamein-alpha-policy-explanation-v1",
    logit: round(logit, 6),
    probability: round(sigmoid(logit), 6),
    architecture: networkForward ? ALPHA_DENSE_RESIDUAL_ARCHITECTURE : "linear-v1",
    linearScore: round(linearScore, 6),
    networkScore: round(networkScore, 6),
    entries: sortFeatureContributions(entries),
  };
}

export function policyRowsFromSamples(samples, options = {}) {
  const board = options.board || boardForScenario(options.scenario);
  return (samples || []).flatMap((sample, sampleIndex) => (
    (sample.policy || []).map((entry) => ({
      stateHash: sample.stateHash || null,
      groupKey: sample.stateHash || `sample-${sampleIndex}`,
      side: sample.side || null,
      action: entry.action,
      actionKey: stableActionKey(entry.action),
      target: clamp(Number(entry.visitShare || 0), 0, 1),
      sampleWeight: policySampleWeight(sample, options),
      features: actionPolicyFeatures(entry.action, sample, options.scenario, {
        board,
        state: sample.initialState || null,
      }),
    }))
  ));
}

export function splitAlphaTrainingSamples(samples = [], options = {}) {
  let rows = Array.isArray(samples) ? samples.slice() : [];
  const validationFraction = clamp(Number(options.validationFraction ?? options.holdoutFraction ?? 0), 0, 0.9);
  const minValidationSamples = Math.max(0, Math.floor(Number(options.minValidationSamples ?? 1)));
  const seed = String(options.validationSeed ?? options.seed ?? "alpha-training-validation-v1");
  const validationGroupBy = normalizeValidationGroupBy(
    options.validationGroupBy
      ?? options.holdoutGroupBy
      ?? (validationFraction > 0 ? "trajectory" : "sample"),
  );
  if (validationGroupBy === "trajectory") rows = canonicalTrajectorySampleOrder(rows);
  if (!rows.length || !(validationFraction > 0)) {
    return makeTrainingSplit({ seed, validationFraction, validationGroupBy, trainingSamples: rows, validationSamples: [] });
  }
  const validationCount = Math.min(
    Math.max(1, minValidationSamples, Math.round(rows.length * validationFraction)),
    Math.max(0, rows.length - 1),
  );
  if (!(validationCount > 0)) {
    return makeTrainingSplit({ seed, validationFraction, validationGroupBy, trainingSamples: rows, validationSamples: [] });
  }
  if (validationGroupBy !== "sample") {
    return splitAlphaTrainingSamplesByGroup(rows, {
      seed,
      validationFraction,
      validationCount,
      validationGroupBy,
    });
  }
  const ranked = rows
    .map((sample, index) => ({
      sample,
      index,
      key: stableTrainingSplitKey(sample, index, seed),
    }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);
  const validationIndexes = new Set(ranked.slice(0, validationCount).map((entry) => entry.index));
  return makeTrainingSplit({
    seed,
    validationFraction,
    validationGroupBy,
    trainingSamples: rows.filter((sample, index) => !validationIndexes.has(index)),
    validationSamples: rows.filter((sample, index) => validationIndexes.has(index)),
  });
}

export function makeExplicitAlphaTrainingSplit(trainingSamples = [], validationSamples = [], options = {}) {
  if (!Array.isArray(trainingSamples) || !Array.isArray(validationSamples)) {
    throw new Error("Alpha explicit training and validation samples must be arrays");
  }
  if (!trainingSamples.length || !validationSamples.length) {
    throw new Error("Alpha explicit training and validation samples must both be non-empty");
  }
  if (Number(options.validationFraction || 0) > 0) {
    throw new Error("Alpha explicit validation cannot be combined with validationFraction");
  }
  const validationGroupBy = normalizeValidationGroupBy(options.validationGroupBy || "trajectory");
  if (validationGroupBy !== "trajectory") {
    throw new Error("Alpha explicit validation requires validationGroupBy trajectory");
  }
  const trainingRows = trainingSamples.slice();
  const validationRows = validationSamples.slice();
  const combinedRows = [...trainingRows, ...validationRows];
  const combinedGroups = groupedTrajectoryValidationSamples(combinedRows);
  const boundary = trainingRows.length;
  const crossingComponent = combinedGroups.find((group) => {
    const hasTraining = group.indexes.some((index) => index < boundary);
    const hasValidation = group.indexes.some((index) => index >= boundary);
    return hasTraining && hasValidation;
  });
  if (crossingComponent) {
    throw new Error("Alpha explicit validation split leaked a trajectory/shared-state component");
  }
  const trainingStateHashes = new Set(trainingRows.map((sample) => sample.stateHash));
  const stateHashOverlap = [...new Set(validationRows.map((sample) => sample.stateHash))]
    .filter((stateHash) => trainingStateHashes.has(stateHash));
  if (stateHashOverlap.length) {
    throw new Error(`Alpha explicit validation split leaked ${stateHashOverlap.length} state hashes`);
  }
  const totalCount = trainingRows.length + validationRows.length;
  const split = makeTrainingSplit({
    seed: String(options.validationSeed || options.seed || "alpha-explicit-validation-v1"),
    validationFraction: validationRows.length / totalCount,
    validationGroupBy,
    trainingSamples: trainingRows,
    validationSamples: validationRows,
  });
  return {
    ...split,
    explicitValidation: true,
    stateHashOverlapCount: 0,
    crossSplitComponentCount: 0,
    environmentFingerprint: canonicalSha256OrNull(options.environmentFingerprint),
    trainingArtifactFingerprint: canonicalSha256OrNull(options.trainingArtifactFingerprint),
    validationArtifactFingerprint: canonicalSha256OrNull(options.validationArtifactFingerprint),
    trainingFileSha256: canonicalSha256OrNull(options.trainingFileSha256),
    validationFileSha256: canonicalSha256OrNull(options.validationFileSha256),
  };
}

export function evaluateAlphaTrainingValidation(samples = [], options = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  return {
    schema: ALPHA_TRAINING_VALIDATION_SCHEMA,
    seed: options.split?.seed || null,
    validationFraction: Number(options.split?.validationFraction || 0),
    validationGroupBy: options.split?.validationGroupBy || "sample",
    trainingGroups: Number(options.split?.trainingGroupCount || 0),
    validationGroups: Number(options.split?.validationGroupCount || 0),
    trainingSamples: Number(options.split?.trainingCount || 0),
    sampleCount: rows.length,
    explicitValidation: Boolean(options.split?.explicitValidation),
    stateHashOverlapCount: options.split?.explicitValidation
      ? Number(options.split.stateHashOverlapCount || 0)
      : null,
    crossSplitComponentCount: options.split?.explicitValidation
      ? Number(options.split.crossSplitComponentCount || 0)
      : null,
    environmentFingerprint: options.split?.environmentFingerprint || null,
    trainingArtifactFingerprint: options.split?.trainingArtifactFingerprint || null,
    validationArtifactFingerprint: options.split?.validationArtifactFingerprint || null,
    trainingFileSha256: options.split?.trainingFileSha256 || null,
    validationFileSha256: options.split?.validationFileSha256 || null,
    ...(options.split?.validationGroupBy === "trajectory" ? {
      trainingTrajectories: Number(options.split.trainingTrajectoryCount || 0),
      validationTrajectories: Number(options.split.validationTrajectoryCount || 0),
      trajectoryOverlapCount: Number(options.split.trajectoryOverlapCount || 0),
    } : {}),
    sides: countByString(rows, (sample) => sample?.side),
    phases: countByString(rows, (sample) => sample?.phaseId),
    outcomeSources: countByString(rows, (sample) => sample?.outcomeSource),
    value: options.value ? evaluateAlphaValueModel(rows, options.value) : null,
    policy: options.policy ? evaluateAlphaPolicyModel(rows, {
      ...options.policy,
      scenario: options.scenario,
    }) : null,
  };
}

export function actionPolicyFeatures(action, sample = {}, scenario = null, context = null) {
  const objectives = scenario?.objectives || {};
  const axisTargets = new Set([
    ...(objectives.alamHalfaRidge || []),
    ...(objectives.coastalRoadEast || []),
  ]);
  const alliedExit = new Set(objectives.alliedWestExitEdge || []);
  const stateFeatures = sample.features || {};
  const phaseId = sample.phaseId || "";
  const isMove = action?.type === "MOVE_UNIT";
  const isCombat = action?.type === "DECLARE_COMBAT";
  const isRetreat = action?.type === "RETREAT_UNIT";
  const isAdvance = action?.type === "ADVANCE_UNIT";
  const isSkipAdvance = action?.type === "SKIP_ADVANCE";
  const isEndPhase = action?.type === "END_PHASE";
  const axisObjectiveProgress = normalizePolicyStateFeature("axisObjectiveProgress", stateFeatures.axisObjectiveProgress);
  const axisObjectivePressure = normalizePolicyStateFeature("axisObjectivePressure", stateFeatures.axisObjectivePressure);
  const axisObjectiveLocalAdvantage = normalizePolicyStateFeature(
    "axisObjectiveLocalAdvantage",
    stateFeatures.axisObjectiveLocalAdvantage,
  );
  const alliedExitLocalAdvantage = normalizePolicyStateFeature(
    "alliedExitLocalAdvantage",
    stateFeatures.alliedExitLocalAdvantage,
  );
  const alliedBreakthroughReady = clamp(Number(stateFeatures.alliedBreakthroughReady || 0), 0, 1);
  const axisDeadlineRisk = clamp(Number(stateFeatures.axisDeadlineRisk || 0), 0, 1);
  const spatial = spatialActionPolicyFeatures(action, sample, scenario, context);
  const friendlyThreats = normalizePolicyStateFeature("friendlyThreats", stateFeatures.friendlyThreats);
  const enemyThreats = normalizePolicyStateFeature("enemyThreats", stateFeatures.enemyThreats);
  return {
    bias: 1,
    axisSide: sample.side === "axis" ? 1 : 0,
    alliedSide: sample.side === "allied" ? 1 : 0,
    turnProgress: clamp(Number(stateFeatures.turnProgress ?? ((Number(sample.turn || 1) - 1) / 3)), 0, 1),
    movementPhase: phaseId.includes("movement") || phaseId.endsWith("-move") ? 1 : 0,
    combatPhase: phaseId.includes("combat") ? 1 : 0,
    retreatPhase: phaseId.includes("retreat") ? 1 : 0,
    advancePhase: phaseId.includes("advance") ? 1 : 0,
    stateMaterialBalance: normalizePolicyStateFeature("materialBalance", stateFeatures.materialBalance),
    stateUnitBalance: normalizePolicyStateFeature("unitBalance", stateFeatures.unitBalance),
    stateAxisObjectiveHeld: clamp(Number(stateFeatures.axisObjectiveHeld || 0), 0, 1),
    stateAxisObjectiveProgress: axisObjectiveProgress,
    stateAxisObjectivePressure: axisObjectivePressure,
    stateAxisObjectiveLocalAdvantage: axisObjectiveLocalAdvantage,
    stateAlliedExitPressure: normalizePolicyStateFeature("alliedExitPressure", stateFeatures.alliedExitPressure),
    stateAlliedExitLocalAdvantage: alliedExitLocalAdvantage,
    stateAlliedBreakthroughReady: alliedBreakthroughReady,
    stateAxisDeadlineRisk: axisDeadlineRisk,
    stateFriendlyCohesion: normalizePolicyStateFeature("friendlyCohesion", stateFeatures.friendlyCohesion),
    stateEnemyCohesion: normalizePolicyStateFeature("enemyCohesion", stateFeatures.enemyCohesion),
    stateFriendlyThreats: friendlyThreats,
    stateEnemyThreats: enemyThreats,
    move: isMove ? 1 : 0,
    declareCombat: isCombat ? 1 : 0,
    finishDeclarations: action?.type === "FINISH_DECLARATIONS" ? 1 : 0,
    endPhase: isEndPhase ? 1 : 0,
    retreat: isRetreat ? 1 : 0,
    advance: isAdvance ? 1 : 0,
    skipAdvance: isSkipAdvance ? 1 : 0,
    routeRemaining: clamp(Number(action?.route?.remaining || 0) / 10, 0, 1),
    routeSpent: clamp(Number(action?.route?.spent || 0) / 10, 0, 1),
    attackerCount: clamp(Number(action?.attackerIds?.length || 0) / 6, 0, 1),
    ...spatial,
    axisObjectiveDestination: axisTargets.has(action?.toHexId || action?.targetHexId) ? 1 : 0,
    alliedExitDestination: alliedExit.has(action?.toHexId || action?.targetHexId) ? 1 : 0,
    moveWithAxisObjectivePressure: isMove ? axisObjectivePressure : 0,
    moveWithAxisObjectiveProgress: isMove ? axisObjectiveProgress : 0,
    moveWithAxisObjectiveLocalAdvantage: isMove ? axisObjectiveLocalAdvantage : 0,
    combatWithFriendlyThreats: isCombat ? friendlyThreats : 0,
    combatWithEnemyThreats: isCombat ? enemyThreats : 0,
    combatWithAxisObjectiveLocalAdvantage: isCombat ? axisObjectiveLocalAdvantage : 0,
    retreatWithEnemyThreats: isRetreat ? enemyThreats : 0,
    advanceWithAxisObjectivePressure: isAdvance ? axisObjectivePressure : 0,
    advanceWithAxisObjectiveLocalAdvantage: isAdvance ? axisObjectiveLocalAdvantage : 0,
    skipAdvanceWithEnemyThreats: isSkipAdvance ? enemyThreats : 0,
    endPhaseWithAxisObjectivePressure: isEndPhase ? axisObjectivePressure : 0,
    moveWithAlliedExitLocalAdvantage: isMove ? alliedExitLocalAdvantage : 0,
    endPhaseWithAlliedExitLocalAdvantage: isEndPhase ? alliedExitLocalAdvantage : 0,
    endPhaseWithAlliedBreakthroughReady: isEndPhase ? alliedBreakthroughReady : 0,
    endPhaseWithAxisDeadlineRisk: isEndPhase ? axisDeadlineRisk : 0,
    endPhaseWithEnemyThreats: isEndPhase ? enemyThreats : 0,
  };
}

function spatialActionPolicyFeatures(action, sample, scenario, context) {
  const empty = emptySpatialPolicyFeatures();
  const state = context?.state || sample?.initialState || null;
  const board = context?.board || boardForScenario(scenario);
  if (!state?.units || !board) return empty;
  const side = sample.side;
  const units = liveUnits(state.units);
  const movingUnit = action?.unitId ? unitById(state.units, action.unitId) : null;
  const defender = action?.defenderId ? unitById(state.units, action.defenderId) : null;
  const attackers = (action?.attackerIds || []).map((id) => unitById(state.units, id)).filter(Boolean);
  const targetHexId = action?.toHexId || action?.targetHexId || defender?.hexId || null;
  const fromHexId = action?.fromHexId || movingUnit?.hexId || null;
  const local = targetHexId ? localForceFeatures(board, units, targetHexId, side) : empty;
  const axisTargets = [
    ...(scenario?.objectives?.alamHalfaRidge || []),
    ...(scenario?.objectives?.coastalRoadEast || []),
  ];
  const alliedExitTargets = scenario?.objectives?.alliedWestExitEdge || [];
  const targetHex = targetHexId ? getHex(board, targetHexId) : null;
  const attackerStrength = attackers.reduce((sum, unit) => sum + Number(unit.combat || 0), 0);
  const defenderStrength = Number(defender?.combat || 0);
  return {
    ...empty,
    ...local,
    movingUnitCombat: clamp(Number(movingUnit?.combat || 0) / 12, 0, 1),
    movingUnitMovement: clamp(Number(movingUnit?.movement || 0) / 12, 0, 1),
    axisObjectiveDistanceGain: distanceGain(board, fromHexId, targetHexId, axisTargets),
    alliedExitDistanceGain: distanceGain(board, fromHexId, targetHexId, alliedExitTargets),
    attackerStrength: clamp(attackerStrength / 36, 0, 1),
    defenderStrength: clamp(defenderStrength / 12, 0, 1),
    combatForceAdvantage: safeForceAdvantage(attackerStrength, defenderStrength),
    targetHighland: targetHex?.terrain === "highland" ? 1 : 0,
    targetSettlement: targetHex?.terrain === "settlement" ? 1 : 0,
    targetRoad: targetHex?.road ? 1 : 0,
    targetBritishPosition: targetHex?.britishPosition ? 1 : 0,
  };
}

function emptySpatialPolicyFeatures() {
  return {
    movingUnitCombat: 0,
    movingUnitMovement: 0,
    targetFriendlyForceR1: 0,
    targetEnemyForceR1: 0,
    targetFriendlyForceR2: 0,
    targetEnemyForceR2: 0,
    targetForceAdvantageR1: 0,
    targetForceAdvantageR2: 0,
    axisObjectiveDistanceGain: 0,
    alliedExitDistanceGain: 0,
    attackerStrength: 0,
    defenderStrength: 0,
    combatForceAdvantage: 0,
    targetHighland: 0,
    targetSettlement: 0,
    targetRoad: 0,
    targetBritishPosition: 0,
  };
}

function localForceFeatures(board, units, targetHexId, side) {
  let friendlyR1 = 0;
  let enemyR1 = 0;
  let friendlyR2 = 0;
  let enemyR2 = 0;
  for (const unit of units) {
    const distance = nearestDistanceToAny({ board }, unit.hexId, [targetHexId]);
    if (distance > 2) continue;
    const strength = Number(unit.combat || 0);
    const friendly = unit.side === side;
    if (distance <= 1) {
      if (friendly) friendlyR1 += strength;
      else enemyR1 += strength;
    }
    if (friendly) friendlyR2 += strength;
    else enemyR2 += strength;
  }
  return {
    targetFriendlyForceR1: clamp(friendlyR1 / 40, 0, 1),
    targetEnemyForceR1: clamp(enemyR1 / 40, 0, 1),
    targetFriendlyForceR2: clamp(friendlyR2 / 60, 0, 1),
    targetEnemyForceR2: clamp(enemyR2 / 60, 0, 1),
    targetForceAdvantageR1: safeForceAdvantage(friendlyR1, enemyR1),
    targetForceAdvantageR2: safeForceAdvantage(friendlyR2, enemyR2),
  };
}

function distanceGain(board, fromHexId, toHexId, targets) {
  if (!fromHexId || !toHexId || !targets?.length) return 0;
  const fromDistance = nearestDistanceToAny({ board }, fromHexId, targets);
  const toDistance = nearestDistanceToAny({ board }, toHexId, targets);
  if (!Number.isFinite(fromDistance) || !Number.isFinite(toDistance)) return 0;
  return clamp((fromDistance - toDistance) / 6, -1, 1);
}

function safeForceAdvantage(friendly, enemy) {
  const total = Number(friendly || 0) + Number(enemy || 0);
  return total > 0 ? clamp((Number(friendly || 0) - Number(enemy || 0)) / total, -1, 1) : 0;
}

function boardForScenario(scenario) {
  if (!scenario || typeof scenario !== "object") return null;
  let board = BOARDS_BY_SCENARIO.get(scenario);
  if (!board) {
    board = createBoard(scenario);
    BOARDS_BY_SCENARIO.set(scenario, board);
  }
  return board;
}

function normalizePolicyStateFeature(key, value) {
  return clamp(Number(value || 0) / Number(VALUE_FEATURE_SCALES[key] || 1), -1, 1);
}

export function makeAlphaModelArtifact({
  value,
  policy,
  hexGraph = null,
  sampleCount = 0,
  sources = [],
  environment = null,
  featureContract = null,
  training = null,
} = {}) {
  return {
    schema: ALPHA_MODEL_SCHEMA,
    generatedAt: new Date().toISOString(),
    method: hexGraph
      ? "hex-graph-policy-value-self-play"
      : value?.network || policy?.network
        ? "dense-residual-policy-value-self-play"
        : "linear-policy-value-self-play",
    sampleCount,
    sources,
    environment,
    featureContract,
    training: training || makeAlphaTrainingMetadata(null),
    value,
    policy,
    ...(hexGraph ? { hexGraph } : {}),
  };
}

function spatialDatasetForTraining(samples, options, { requireEnabled = true } = {}) {
  const enabled = options.hexGraph?.enabled === true;
  if (requireEnabled && !enabled) return null;
  if (!options.scenario || !options.rules) {
    if (enabled) throw new Error("Alpha hex graph training requires scenario and rules data");
    return null;
  }
  const dataset = buildAlphaSpatialDataset(samples, {
    scenario: options.scenario,
    rules: options.rules,
    source: "alpha-training",
  });
  if (!dataset.sampleCount) {
    if (enabled) throw new Error("Alpha hex graph training requires state snapshots");
    return null;
  }
  return dataset;
}

export function makeAlphaTrainingMetadata(parentModel = null, samples = [], validation = null) {
  const parent = compactParentModelMetadata(parentModel);
  return {
    schema: ALPHA_TRAINING_METADATA_SCHEMA,
    warmStarted: Boolean(parent),
    parent,
    data: summarizeAlphaTrainingData(samples),
    validation,
  };
}

export function summarizeAlphaTrainingData(samples = []) {
  const rows = Array.isArray(samples) ? samples : [];
  const featureContracts = validateAlphaTrainingSampleFeatureContracts(rows);
  const valueRows = rows.filter((sample) => sample?.features && alphaTrainingValueTarget(sample).usable);
  const decisionRows = rows.filter((sample) => sample?.decision && typeof sample.decision === "object");
  const explorationDecisionRows = decisionRows.filter(isExplorationDecisionSample);
  const outcomeBuckets = countByString(valueRows, trainingOutcomeBucket, { missing: null });
  const stateHashes = rows
    .map((sample) => trainingStateHash(sample))
    .filter(Boolean);
  const uniqueStateHashes = new Set(stateHashes).size;
  const duplicateStateSamples = Math.max(0, stateHashes.length - uniqueStateHashes);
  const policyActionTypes = countByString(trainingPolicyEntries(rows), (entry) => entry?.action?.type, { missing: null });
  return {
    schema: ALPHA_TRAINING_DATA_SUMMARY_SCHEMA,
    sampleCount: rows.length,
    sources: uniqueStrings(rows.map(trainingSampleSource)),
    sides: countByString(rows, (sample) => sample?.side),
    phases: countByString(rows, (sample) => sample?.phaseId),
    outcomeSources: countByString(rows, (sample) => sample?.outcomeSource),
    selectionModes: countByString(rows, (sample) => sample?.decision?.selectionMode, { missing: null }),
    valueSamples: valueRows.length,
    outcomeBuckets,
    outcomeClassCount: Object.keys(outcomeBuckets).length,
    averageOutcome: averageFinite(valueRows.map((sample) => sample.outcome), 6),
    samplesWithPolicy: rows.filter((sample) => Array.isArray(sample?.policy) && sample.policy.length > 0).length,
    policyRows: rows.reduce((sum, sample) => sum + (Array.isArray(sample?.policy) ? sample.policy.length : 0), 0),
    policyActionTypes,
    policyActionTypeCount: Object.keys(policyActionTypes).length,
    stateHashSamples: stateHashes.length,
    uniqueStateHashes,
    duplicateStateSamples,
    stateHashCoverage: rows.length ? round(stateHashes.length / rows.length, 6) : null,
    duplicateStateRate: stateHashes.length ? round(duplicateStateSamples / stateHashes.length, 6) : null,
    samplesWithDecision: decisionRows.length,
    sampledDecisionCount: decisionRows.filter(isSampledDecisionSample).length,
    explorationDecisionCount: explorationDecisionRows.length,
    explorationDecisionShare: decisionRows.length ? round(explorationDecisionRows.length / decisionRows.length, 6) : null,
    temperatureDecisionCount: decisionRows.filter((sample) => Number(sample?.decision?.temperature || 0) > 0).length,
    rootNoiseDecisionCount: decisionRows.filter((sample) => Number(sample?.decision?.rootNoiseWeight || 0) > 0).length,
    nonBestSelectedActions: decisionRows.filter((sample) => sample?.decision?.selectedIsBest === false).length,
    samplesWithStateSnapshot: rows.filter((sample) => Boolean(sample?.initialState || sample?.stateSnapshot || sample?.stateBefore)).length,
    reanalysisSamples: rows.filter((sample) => Boolean(sample?.reanalysis) || sample?.decision?.selectionMode === "reanalyzed").length,
    samplesWithFeatureContract: featureContracts.samplesWithFeatureContract,
    featureContracts: featureContracts.featureContracts,
    featureContractMissingSamples: featureContracts.missingSampleCount,
    featureContractMismatchedSamples: featureContracts.mismatchedSampleCount,
    expectedFeatureContractFingerprint: featureContracts.expectedFingerprint,
    averageOutcomeWeight: averageFinite(rows.map((sample) => sample?.outcomeWeight ?? 1), 4),
    averageRootVisits: averageFinite(rows.map((sample) => sample?.decision?.rootVisits), 4),
    averageTemperature: averageFinite(decisionRows.map((sample) => sample?.decision?.temperature), 6),
    averageRootNoiseWeight: averageFinite(decisionRows.map((sample) => sample?.decision?.rootNoiseWeight), 6),
    averagePolicyEntropy: averageFinite(rows.map((sample) => sample?.decision?.policyEntropy), 6),
    averageSelectedVisitShare: averageFinite(rows.map((sample) => sample?.decision?.selectedVisitShare), 6),
    averageSelectedPolicyRank: averageFinite(rows.map((sample) => sample?.decision?.selectedPolicyRank), 4),
    selectedBestActions: rows.filter((sample) => sample?.decision?.selectedIsBest === true).length,
    averageRecommendationConfidence: averageFinite(rows.map((sample) => sample?.decision?.recommendationConfidence), 6),
    averageRecommendationVisitMargin: averageFinite(rows.map((sample) => sample?.decision?.recommendationVisitMargin), 6),
  };
}

function annotateSample(sample, source, sampleIndex, resultIndex = null) {
  return {
    ...sample,
    __source: source,
    __sampleIndex: sampleIndex,
    __resultIndex: resultIndex,
  };
}

function compactParentModelMetadata(parentModel) {
  const metadata = alphaModelMetadata(parentModel);
  if (!metadata) return null;
  return {
    schema: metadata.schema,
    generatedAt: metadata.generatedAt,
    method: metadata.method,
    sampleCount: metadata.sampleCount,
    sources: metadata.sources || [],
    hasValue: metadata.hasValue,
    hasPolicy: metadata.hasPolicy,
    valueWeights: metadata.valueWeights,
    policyWeights: metadata.policyWeights,
    valueArchitecture: metadata.valueArchitecture,
    policyArchitecture: metadata.policyArchitecture,
    valueNetworkParameters: metadata.valueNetworkParameters,
    policyNetworkParameters: metadata.policyNetworkParameters,
    hasHexGraph: metadata.hasHexGraph,
    hexGraphParameters: metadata.hexGraphParameters,
    trainingData: metadata.training?.data || null,
    trainingValidation: metadata.training?.validation || null,
    release: metadata.release ? {
      schema: metadata.release.schema,
      sourceSchema: metadata.release.sourceSchema,
      sourceArtifact: metadata.release.sourceArtifact,
      sourceHash: metadata.release.sourceHash,
      activeGeneration: metadata.release.activeGeneration ?? null,
    } : null,
  };
}

function trainingSampleSource(sample) {
  return sample?.__source || sample?.source || sample?.replay?.source || null;
}

function isSampledDecisionSample(sample) {
  const mode = sample?.decision?.selectionMode;
  return mode === "sampled" || mode === "sampled_best";
}

function isExplorationDecisionSample(sample) {
  const decision = sample?.decision || null;
  if (!decision || typeof decision !== "object") return false;
  if (isSampledDecisionSample(sample)) return true;
  if (Number(decision.temperature || 0) > 0) return true;
  if (Number(decision.rootNoiseWeight || 0) > 0) return true;
  return decision.selectedIsBest === false;
}

function trainingStateHash(sample) {
  return typeof sample?.stateHash === "string" && sample.stateHash ? sample.stateHash : null;
}

function trainingOutcomeBucket(sample) {
  const outcome = Number(sample?.outcome);
  if (!Number.isFinite(outcome)) return null;
  if (outcome > 0.05) return "positive";
  if (outcome < -0.05) return "negative";
  return "neutral";
}

function trainingPolicyEntries(samples) {
  return (samples || []).flatMap((sample) => (Array.isArray(sample?.policy) ? sample.policy : []));
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value.length > 0))];
}

function sortFeatureContributions(entries) {
  return (entries || [])
    .filter((entry) => Number.isFinite(Number(entry.contribution)))
    .sort((left, right) => (
      Math.abs(Number(right.contribution || 0)) - Math.abs(Number(left.contribution || 0))
      || String(left.key).localeCompare(String(right.key))
    ));
}

function countByString(items, select, { missing = "unknown" } = {}) {
  const counts = {};
  for (const item of items || []) {
    const raw = select(item);
    const key = typeof raw === "string" && raw ? raw : missing;
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function averageFinite(values, digits = 4) {
  const finite = (values || []).map(Number).filter(Number.isFinite);
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, digits);
}

function signedValueFeatures(sample) {
  const features = sample.features || {};
  const axisSign = sample.side === "axis" ? 1 : -1;
  return {
    turnProgress: Number(features.turnProgress || 0),
    materialBalance: Number(features.materialBalance || 0),
    unitBalance: Number(features.unitBalance || 0),
    axisObjectiveHeld: axisSign * Number(features.axisObjectiveHeld || 0),
    axisObjectiveProgress: axisSign * Number(features.axisObjectiveProgress || 0),
    axisObjectivePressure: axisSign * Number(features.axisObjectivePressure || 0),
    axisObjectiveLocalAdvantage: axisSign * Number(features.axisObjectiveLocalAdvantage || 0),
    alliedExitPressure: -axisSign * Number(features.alliedExitPressure || 0),
    alliedExitLocalAdvantage: -axisSign * Number(features.alliedExitLocalAdvantage || 0),
    alliedBreakthroughReady: -axisSign * Number(features.alliedBreakthroughReady || 0),
    axisDeadlineRisk: -axisSign * Number(features.axisDeadlineRisk || 0),
    friendlyCohesion: Number(features.friendlyCohesion || 0),
    enemyCohesion: Number(features.enemyCohesion || 0),
    friendlyThreats: Number(features.friendlyThreats || 0),
    enemyThreats: Number(features.enemyThreats || 0),
  };
}

function valueSampleWeight(sample) {
  const target = alphaTrainingValueTarget(sample);
  if (!target.usable) return 0;
  return target.outcomeWeight * trainingSampleWeight(sample, "valueTrainingWeight");
}

function trainingSampleWeight(sample, specializedField = null) {
  const rawTrainingWeight = Number(
    specializedField && sample?.[specializedField] !== undefined
      ? sample[specializedField]
      : sample?.trainingWeight ?? 1,
  );
  return Number.isFinite(rawTrainingWeight) ? clamp(rawTrainingWeight, 0, 4) : 1;
}

function policySampleWeight(sample, options = {}) {
  const rawPolicyWeight = Number(sample?.policyWeight ?? 1);
  const policyWeight = (Number.isFinite(rawPolicyWeight) ? clamp(rawPolicyWeight, 0, 1) : 1)
    * trainingSampleWeight(sample, "policyTrainingWeight");
  const decision = sample?.decision || {};
  if (!decision || typeof decision !== "object" || !Object.keys(decision).length) return policyWeight;
  const visits = Math.max(
    0,
    Number(decision.rootVisits || 0),
    Number(decision.searchIterations || 0),
    policyVisitCount(sample.policy),
  );
  const referenceVisits = Math.max(1, Number(options.policyReferenceVisits || DEFAULT_POLICY_REFERENCE_VISITS));
  const visitWeight = visits > 0
    ? clamp(Math.log2(visits + 1) / Math.log2(referenceVisits + 1), 0.1, 1)
    : 0.5;
  const rootNoiseWeight = clamp(Number(decision.rootNoiseWeight || 0), 0, 1);
  const temperature = Math.max(0, Number(decision.temperature || 0));
  const explorationPenalty = clamp(1 - (rootNoiseWeight * 0.35) - (Math.min(1, temperature) * 0.15), 0.35, 1);
  return clamp(policyWeight * visitWeight * explorationPenalty, 0, 4);
}

function policyVisitCount(policy) {
  return (policy || []).reduce((sum, entry) => sum + Math.max(0, Number(entry.visits || 0)), 0);
}

function deterministicEpochOrder(items, seed, epoch, keyForItem) {
  return items
    .map((item, index) => ({
      item,
      index,
      order: deterministicOrderHash(`${seed}:${epoch}:${keyForItem(item)}`),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.item);
}

function trainingSampleKey(sample) {
  return `${sample?.stateHash || "state"}:${sample?.side || "side"}:${sample?.phaseId || "phase"}:${sample?.turn ?? "turn"}:${sample?.outcome ?? "outcome"}`;
}

function policyGroupKey(group) {
  const row = group?.[0] || null;
  return `${row?.stateHash || "state"}:${row?.side || "side"}:${row?.phaseId || "phase"}:${row?.turn ?? "turn"}`;
}

function deterministicOrderHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeValueFeature(key, value, featureScales = VALUE_FEATURE_SCALES) {
  return clamp(Number(value || 0) / Number(featureScales[key] || VALUE_FEATURE_SCALES[key] || 1), -1, 1);
}

function initializeValueWeights(baseWeights = null) {
  const weights = {};
  for (const key of VALUE_FEATURE_KEYS) {
    weights[key] = Number(baseWeights?.[key] ?? DEFAULT_SITUATION_WEIGHTS[key] ?? 0);
  }
  return weights;
}

function initializePolicyWeights(baseWeights = null) {
  return POLICY_FEATURE_KEYS.reduce((weights, key) => {
    weights[key] = Number(baseWeights?.[key] || 0);
    return weights;
  }, {});
}

function groupPolicyRows(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = row.groupKey || row.stateHash || row.actionKey || "__unknown__";
    const group = grouped.get(key) || [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()].filter((group) => group.length);
}

function policyGroupWeight(group) {
  if (!group?.length) return 1;
  const total = group.reduce((sum, row) => sum + clamp(Number(row.sampleWeight ?? 1), 0, 1), 0);
  return total / group.length;
}

function normalizePolicyTargets(group) {
  const raw = group.map((row) => clamp(Number(row.target || 0), 0, 1));
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return raw.map(() => 1 / raw.length);
  return raw.map((value) => value / total);
}

function softmax(logits) {
  if (!logits.length) return [];
  const max = Math.max(...logits.map((value) => Number(value || 0)));
  const exp = logits.map((value) => Math.exp(Math.max(-40, Math.min(40, Number(value || 0) - max))));
  const total = exp.reduce((sum, value) => sum + value, 0) || 1;
  return exp.map((value) => value / total);
}

function splitAlphaTrainingSamplesByGroup(rows, options) {
  const groups = groupedTrainingSamplesForValidation(rows, options.validationGroupBy);
  if (groups.length < 2) {
    return makeTrainingSplit({
      seed: options.seed,
      validationFraction: options.validationFraction,
      validationGroupBy: options.validationGroupBy,
      trainingSamples: rows,
      validationSamples: [],
    });
  }
  const ranked = groups
    .map((group, index) => ({
      ...group,
      index,
      key: stableHash(
        options.validationGroupBy === "trajectory"
          ? `${options.seed}|${options.validationGroupBy}|${group.key}`
          : `${options.seed}|${options.validationGroupBy}|${group.key}|${index}`,
      ),
    }))
    .sort((left, right) => left.key.localeCompare(right.key) || left.index - right.index);
  const validationIndexes = new Set();
  for (const group of ranked) {
    if (validationIndexes.size >= options.validationCount) break;
    if (validationIndexes.size + group.indexes.length >= rows.length) continue;
    for (const index of group.indexes) validationIndexes.add(index);
  }
  const trainingSamples = rows.filter((sample, index) => !validationIndexes.has(index));
  const validationSamples = rows.filter((sample, index) => validationIndexes.has(index));
  return makeTrainingSplit({
    seed: options.seed,
    validationFraction: options.validationFraction,
    validationGroupBy: options.validationGroupBy,
    trainingSamples: options.validationGroupBy === "trajectory"
      ? canonicalTrajectorySampleOrder(trainingSamples)
      : trainingSamples,
    validationSamples: options.validationGroupBy === "trajectory"
      ? canonicalTrajectorySampleOrder(validationSamples)
      : validationSamples,
  });
}

function groupedTrainingSamplesForValidation(rows, validationGroupBy) {
  if (validationGroupBy === "trajectory") {
    return groupedTrajectoryValidationSamples(rows);
  }
  const groups = new Map();
  for (const [index, sample] of rows.entries()) {
    const key = trainingValidationGroupKey(sample, index, validationGroupBy);
    const group = groups.get(key) || { key, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function groupedTrajectoryValidationSamples(rows) {
  const lineageComponents = buildTrajectoryLineageComponents(rows);
  const componentBySampleIndex = new Map();
  for (const [componentIndex, component] of lineageComponents.entries()) {
    for (const sampleIndex of component.sampleIndexes) componentBySampleIndex.set(sampleIndex, componentIndex);
  }
  const parents = lineageComponents.map((_, index) => index);
  const ownerByStateHash = new Map();
  for (const [sampleIndex, sample] of rows.entries()) {
    if (typeof sample?.stateHash !== "string" || !sample.stateHash) {
      throw new Error(`Alpha trajectory validation sample ${sampleIndex} is missing stateHash`);
    }
    const componentIndex = componentBySampleIndex.get(sampleIndex);
    const owner = ownerByStateHash.get(sample.stateHash);
    if (owner === undefined) ownerByStateHash.set(sample.stateHash, componentIndex);
    else unionValidationComponents(parents, componentIndex, owner);
  }
  const indexesByRoot = new Map();
  for (const [sampleIndex, componentIndex] of componentBySampleIndex) {
    const root = findValidationComponent(parents, componentIndex);
    const indexes = indexesByRoot.get(root) || [];
    indexes.push(sampleIndex);
    indexesByRoot.set(root, indexes);
  }
  return [...indexesByRoot.values()].map((indexes) => ({
    key: unionTrajectoryIds(...indexes.map((index) => rows[index].trajectoryIds)).join("|"),
    indexes,
  })).sort((left, right) => left.key.localeCompare(right.key));
}

function findValidationComponent(parents, index) {
  if (parents[index] === index) return index;
  parents[index] = findValidationComponent(parents, parents[index]);
  return parents[index];
}

function unionValidationComponents(parents, left, right) {
  const leftRoot = findValidationComponent(parents, left);
  const rightRoot = findValidationComponent(parents, right);
  if (leftRoot === rightRoot) return;
  parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

function canonicalTrajectorySampleOrder(samples) {
  return samples.slice().sort((left, right) => (
    compareCanonicalText(
      canonicalSerialize(left, "trajectory training sample"),
      canonicalSerialize(right, "trajectory training sample"),
    )
  ));
}

function compareCanonicalText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function trainingValidationGroupKey(sample, index, validationGroupBy) {
  if (validationGroupBy === "stateHash") return sample?.stateHash || `sample-${index}`;
  if (validationGroupBy === "side") return sample?.side || `sample-${index}`;
  if (validationGroupBy === "phase") return sample?.phaseId || `sample-${index}`;
  return `sample-${index}`;
}

function normalizeValidationGroupBy(value) {
  const next = String(value || "sample");
  if (ALPHA_TRAINING_VALIDATION_GROUP_BY.includes(next)) return next;
  throw new Error(`Unsupported Alpha training validationGroupBy "${next}". Expected ${ALPHA_TRAINING_VALIDATION_GROUP_BY.join(", ")}.`);
}

function makeTrainingSplit({ seed, validationFraction, validationGroupBy = "sample", trainingSamples, validationSamples }) {
  const trainingGroups = groupedTrainingSamplesForValidation(trainingSamples || [], validationGroupBy);
  const validationGroups = groupedTrainingSamplesForValidation(validationSamples || [], validationGroupBy);
  const trajectoryMetadata = validationGroupBy === "trajectory"
    ? trainingSplitTrajectoryMetadata(trainingSamples, validationSamples)
    : null;
  return {
    schema: "zizi-el-alamein-alpha-training-split-v1",
    seed,
    validationFraction,
    validationGroupBy,
    trainingSamples,
    validationSamples,
    trainingCount: trainingSamples.length,
    validationCount: validationSamples.length,
    trainingGroupCount: trainingGroups.length,
    validationGroupCount: validationGroups.length,
    ...(trajectoryMetadata || {}),
  };
}

function trainingSplitTrajectoryMetadata(trainingSamples, validationSamples) {
  const trainingTrajectoryIds = unionTrajectoryIds(...trainingSamples.map((sample) => sample.trajectoryIds));
  const validationTrajectoryIds = unionTrajectoryIds(...validationSamples.map((sample) => sample.trajectoryIds));
  const validationSet = new Set(validationTrajectoryIds);
  const trajectoryOverlap = trainingTrajectoryIds.filter((trajectoryId) => validationSet.has(trajectoryId));
  if (trajectoryOverlap.length) {
    throw new Error(`Alpha trajectory validation split leaked ${trajectoryOverlap.length} trajectory IDs`);
  }
  return {
    trainingTrajectoryCount: trainingTrajectoryIds.length,
    validationTrajectoryCount: validationTrajectoryIds.length,
    trajectoryOverlapCount: 0,
  };
}

function stableTrainingSplitKey(sample, index, seed) {
  return stableHash(`${seed}|${sample?.stateHash || ""}|${sample?.side || ""}|${sample?.phaseId || ""}|${sample?.turn ?? ""}|${sample?.__source || ""}|${index}`);
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index += 1) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableActionKey(action) {
  if (!action) return "";
  const keys = Object.keys(action).sort();
  return keys.map((key) => `${key}:${stableValue(action[key])}`).join("|");
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

function isCanonicalSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function canonicalSha256OrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).toLowerCase();
  const canonical = /^[0-9a-f]{64}$/.test(text) ? `sha256:${text}` : text;
  if (!isCanonicalSha256(canonical)) throw new Error(`Invalid canonical SHA-256 fingerprint: ${value}`);
  return canonical;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sigmoid(value) {
  if (value > 40) return 1;
  if (value < -40) return 0;
  return 1 / (1 + Math.exp(-value));
}

function clampWeight(value) {
  return clamp(Number(value || 0), -MAX_WEIGHT, MAX_WEIGHT);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
