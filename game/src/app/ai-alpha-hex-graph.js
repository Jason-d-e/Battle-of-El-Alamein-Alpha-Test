import {
  ALPHA_SPATIAL_ACTION_CHANNELS,
  ALPHA_SPATIAL_ACTION_GLOBAL_KEYS,
  ALPHA_SPATIAL_GLOBAL_KEYS,
  ALPHA_SPATIAL_STATE_CHANNELS,
  validateAlphaSpatialDataset,
  validateAlphaSpatialEncoding,
} from "./ai-alpha-spatial.js";

export const ALPHA_HEX_GRAPH_SCHEMA = "zizi-el-alamein-alpha-hex-graph-v1";
export const ALPHA_HEX_GRAPH_SCHEMA_V2 = "zizi-el-alamein-alpha-hex-graph-v2";
export const ALPHA_HEX_GRAPH_SCHEMA_V3 = "zizi-el-alamein-alpha-hex-graph-v3";
export const ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS = Object.freeze([
  "turnProgress",
  "turnProgressSquared",
  "movementPhase",
  "combatPhase",
  "retreatPending",
  "advancePending",
]);

const DEFAULT_HIDDEN_SIZE = 8;
const DEFAULT_LAYER_COUNT = 2;
const MAX_LAYER_COUNT = 16;
const DEFAULT_EPOCHS = 16;
const DEFAULT_LEARNING_RATE = 0.025;
const DEFAULT_BATCH_SIZE = 1;
const DEFAULT_ADAM_BETA1 = 0.9;
const DEFAULT_ADAM_BETA2 = 0.999;
const DEFAULT_ADAM_EPSILON = 1e-8;
const DEFAULT_MAX_GRADIENT_NORM = 8;
const MAX_PARAMETER = 8;
const MAX_GRADIENT = 4;

export function createAlphaHexGraphModel({
  contract,
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  layerCount = null,
  seed = "el-alamein-alpha-hex-graph-v1",
  baseModel = null,
  sideSpecificHeads = false,
  sideSpecificTrunks = false,
  policyContextInteractions = false,
} = {}) {
  const normalizedBase = normalizeAlphaHexGraphModel(baseModel, contract);
  if (normalizedBase) {
    let cloned = resizeModelDepth(normalizedBase, layerCount, seed);
    if (policyContextInteractions && cloned.schema !== ALPHA_HEX_GRAPH_SCHEMA_V3) {
      cloned = upgradePolicyContextInteractions(cloned);
    }
    if (sideSpecificHeads && !cloned.sideHeads) cloned.sideHeads = createSideHeads(cloned.valueHead, cloned.policyHead);
    if (sideSpecificTrunks && !cloned.sideLayers) cloned.sideLayers = createSideLayers(cloned.layers);
    return cloned;
  }
  if (!contract?.fingerprint || !Number(contract?.shape?.hexes)) {
    throw new TypeError("Alpha hex graph model requires a spatial contract");
  }
  const units = Math.max(1, Math.floor(Number(hiddenSize || DEFAULT_HIDDEN_SIZE)));
  const depth = normalizeLayerCount(layerCount ?? DEFAULT_LAYER_COUNT);
  const inputSize = ALPHA_SPATIAL_STATE_CHANNELS.length;
  const valueSize = units * 3 + ALPHA_SPATIAL_GLOBAL_KEYS.length;
  const schema = policyContextInteractions
    ? ALPHA_HEX_GRAPH_SCHEMA_V3
    : depth === DEFAULT_LAYER_COUNT ? ALPHA_HEX_GRAPH_SCHEMA : ALPHA_HEX_GRAPH_SCHEMA_V2;
  const policySize = policyVectorSize(units, schema);
  const model = {
    schema,
    activation: "tanh",
    contractFingerprint: contract.fingerprint,
    stateChannels: ALPHA_SPATIAL_STATE_CHANNELS.slice(),
    actionChannels: ALPHA_SPATIAL_ACTION_CHANNELS.slice(),
    globalKeys: ALPHA_SPATIAL_GLOBAL_KEYS.slice(),
    actionGlobalKeys: ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.slice(),
    hiddenSize: units,
    ...(schema === ALPHA_HEX_GRAPH_SCHEMA ? {} : { layerCount: depth }),
    ...(schema === ALPHA_HEX_GRAPH_SCHEMA_V3
      ? { policyContextKeys: ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS.slice() }
      : {}),
    layers: Array.from({ length: depth }, (_, index) => createGraphLayer(
      index === 0 ? inputSize : units,
      units,
      `${seed}:layer-${index + 1}`,
    )),
    valueHead: createHead(valueSize, `${seed}:value`),
    policyHead: createHead(policySize, `${seed}:policy`),
    metrics: {},
  };
  if (sideSpecificHeads) model.sideHeads = createSideHeads(model.valueHead, model.policyHead);
  if (sideSpecificTrunks) model.sideLayers = createSideLayers(model.layers);
  return model;
}

export function normalizeAlphaHexGraphModel(value, expectedContract = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!isAlphaHexGraphSchema(value.schema) || value.activation !== "tanh") return null;
  if (expectedContract?.fingerprint && value.contractFingerprint !== expectedContract.fingerprint) return null;
  if (!sameStrings(value.stateChannels, ALPHA_SPATIAL_STATE_CHANNELS)) return null;
  if (!sameStrings(value.actionChannels, ALPHA_SPATIAL_ACTION_CHANNELS)) return null;
  if (!sameStrings(value.globalKeys, ALPHA_SPATIAL_GLOBAL_KEYS)) return null;
  if (!sameStrings(value.actionGlobalKeys, ALPHA_SPATIAL_ACTION_GLOBAL_KEYS)) return null;
  if (
    value.schema === ALPHA_HEX_GRAPH_SCHEMA_V3
    && !sameStrings(value.policyContextKeys, ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS)
  ) return null;
  const hiddenSize = Math.max(0, Math.floor(Number(value.hiddenSize || 0)));
  if (!hiddenSize) return null;
  const layerCount = normalizedModelLayerCount(value);
  if (!layerCount) return null;
  const layers = value.layers.map((layer, index) => normalizeGraphLayer(
    layer,
    index === 0 ? ALPHA_SPATIAL_STATE_CHANNELS.length : hiddenSize,
    hiddenSize,
  ));
  if (layers.some((layer) => !layer)) return null;
  const valueSize = hiddenSize * 3 + ALPHA_SPATIAL_GLOBAL_KEYS.length;
  const policySize = policyVectorSize(hiddenSize, value.schema);
  const valueHead = normalizeHead(value.valueHead, valueSize);
  const policyHead = normalizeHead(value.policyHead, policySize);
  if (!valueHead || !policyHead) return null;
  const sideHeads = value.sideHeads ? normalizeSideHeads(value.sideHeads, valueSize, policySize) : null;
  if (value.sideHeads && !sideHeads) return null;
  const sideLayers = value.sideLayers ? normalizeSideLayers(value.sideLayers, hiddenSize, layerCount) : null;
  if (value.sideLayers && !sideLayers) return null;
  return {
    schema: value.schema,
    activation: "tanh",
    contractFingerprint: String(value.contractFingerprint || ""),
    stateChannels: ALPHA_SPATIAL_STATE_CHANNELS.slice(),
    actionChannels: ALPHA_SPATIAL_ACTION_CHANNELS.slice(),
    globalKeys: ALPHA_SPATIAL_GLOBAL_KEYS.slice(),
    actionGlobalKeys: ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.slice(),
    hiddenSize,
    ...(value.schema === ALPHA_HEX_GRAPH_SCHEMA ? {} : { layerCount }),
    ...(value.schema === ALPHA_HEX_GRAPH_SCHEMA_V3
      ? { policyContextKeys: ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS.slice() }
      : {}),
    layers,
    valueHead,
    policyHead,
    ...(sideHeads ? { sideHeads } : {}),
    ...(sideLayers ? { sideLayers } : {}),
    metrics: normalizeMetrics(value.metrics),
  };
}

export function alphaHexGraphForward(stateEncoding, contract, model) {
  const runtimeModel = alphaHexGraphRuntimeShape(model, contract)
    ? model
    : normalizeAlphaHexGraphModel(model, contract);
  if (!runtimeModel) return null;
  if (!validateAlphaSpatialEncoding(stateEncoding, contract).ok) return null;
  const inputs = transposePlanes(stateEncoding.planes);
  const layerSide = runtimeModel.sideLayers?.[stateEncoding.side] ? stateEncoding.side : null;
  const graphLayers = layerSide ? runtimeModel.sideLayers[layerSide] : runtimeModel.layers;
  const layers = [];
  let activations = inputs;
  for (const layer of graphLayers) {
    const forward = graphLayerForward(activations, contract.topology, layer);
    layers.push(forward);
    activations = forward.activations;
  }
  const pools = valuePools(activations, contract);
  return {
    model: runtimeModel,
    inputs,
    layers,
    graphLayers,
    layerSide,
    embeddings: activations,
    globalPool: pools[0],
    valueVector: [...pools.flat(), ...stateEncoding.global],
  };
}

function alphaHexGraphRuntimeShape(value, contract) {
  if (!value || !isAlphaHexGraphSchema(value.schema) || value.activation !== "tanh") return false;
  if (contract?.fingerprint && value.contractFingerprint !== contract.fingerprint) return false;
  const hiddenSize = Number(value.hiddenSize || 0);
  const layerCount = normalizedModelLayerCount(value);
  if (!Number.isInteger(hiddenSize) || hiddenSize < 1 || !layerCount) return false;
  const layerShape = (layer, inputSize, outputSize) => (
    layer?.inputSize === inputSize
    && layer?.outputSize === outputSize
    && Array.isArray(layer.selfWeights)
    && layer.selfWeights.length === outputSize
    && layer.selfWeights.every((row) => Array.isArray(row) && row.length === inputSize)
    && Array.isArray(layer.neighborWeights)
    && layer.neighborWeights.length === outputSize
    && layer.neighborWeights.every((row) => Array.isArray(row) && row.length === inputSize)
    && Array.isArray(layer.biases)
    && layer.biases.length === outputSize
  );
  if (!value.layers.every((layer, index) => layerShape(
    layer,
    index === 0 ? ALPHA_SPATIAL_STATE_CHANNELS.length : hiddenSize,
    hiddenSize,
  ))) return false;
  const valueSize = hiddenSize * 3 + ALPHA_SPATIAL_GLOBAL_KEYS.length;
  if (
    value.schema === ALPHA_HEX_GRAPH_SCHEMA_V3
    && !sameStrings(value.policyContextKeys, ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS)
  ) return false;
  const policySize = policyVectorSize(hiddenSize, value.schema);
  return value.valueHead?.inputSize === valueSize
    && Array.isArray(value.valueHead.weights)
    && value.valueHead.weights.length === valueSize
    && value.policyHead?.inputSize === policySize
    && Array.isArray(value.policyHead.weights)
    && value.policyHead.weights.length === policySize
    && (!value.sideHeads || validSideHeadsShape(value.sideHeads, valueSize, policySize))
    && (!value.sideLayers || validSideLayersShape(value.sideLayers, hiddenSize, layerCount));
}

export function scoreAlphaHexGraphValue(stateEncoding, contract, model, forward = null) {
  const graph = forward || alphaHexGraphForward(stateEncoding, contract, model);
  if (!graph) return null;
  return Math.tanh(headLogit(graph.valueVector, headsForState(graph.model, stateEncoding).valueHead));
}

export function scoreAlphaHexGraphPolicy(stateEncoding, actionEncoding, contract, model, forward = null) {
  const graph = forward || alphaHexGraphForward(stateEncoding, contract, model);
  if (!graph || !validateAlphaSpatialEncoding(actionEncoding, contract).ok) return null;
  const vector = policyVector(graph.embeddings, stateEncoding, actionEncoding, contract, graph.model);
  return headLogit(vector, headsForState(graph.model, stateEncoding).policyHead);
}

export function scoreAlphaHexGraphSparsePolicy(stateEncoding, sparseActionEncoding, contract, model, forward = null) {
  const graph = forward || alphaHexGraphForward(stateEncoding, contract, model);
  if (!graph || sparseActionEncoding?.contractFingerprint !== contract?.fingerprint) return null;
  if (!Array.isArray(sparseActionEncoding.global) || sparseActionEncoding.global.length !== contract.actionGlobalKeys.length) return null;
  if (!contract.actionChannels.every((channel) => Array.isArray(sparseActionEncoding.indexes?.[channel]))) return null;
  const vector = policyVectorFromSelections(
    graph.embeddings,
    stateEncoding,
    sparseActionEncoding.indexes,
    sparseActionEncoding.global,
    contract,
    graph.model,
  );
  return headLogit(vector, headsForState(graph.model, stateEncoding).policyHead);
}

export function scoreAlphaHexGraphSparsePolicies(
  stateEncoding,
  sparseActionEncodings,
  contract,
  model,
  forward = null,
) {
  const graph = forward || alphaHexGraphForward(stateEncoding, contract, model);
  if (!graph || !Array.isArray(sparseActionEncodings)) return null;
  const globalPool = meanRows(graph.embeddings, contract.topology.map((_, index) => index));
  const policyHead = headsForState(graph.model, stateEncoding).policyHead;
  const logits = [];
  for (const sparseActionEncoding of sparseActionEncodings) {
    if (sparseActionEncoding?.contractFingerprint !== contract?.fingerprint) return null;
    if (
      !Array.isArray(sparseActionEncoding.global)
      || sparseActionEncoding.global.length !== contract.actionGlobalKeys.length
      || !contract.actionChannels.every((channel) => Array.isArray(sparseActionEncoding.indexes?.[channel]))
    ) return null;
    const vector = policyVectorFromSelections(
      graph.embeddings,
      stateEncoding,
      sparseActionEncoding.indexes,
      sparseActionEncoding.global,
      contract,
      graph.model,
      globalPool,
    );
    logits.push(headLogit(vector, policyHead));
  }
  return logits;
}

export function trainAlphaHexGraphModel(dataset, options = {}) {
  const validation = validateAlphaSpatialDataset(dataset);
  if (!validation.ok) throw new Error(`Alpha hex graph training dataset is invalid: ${validation.reason}`);
  const model = createAlphaHexGraphModel({
    contract: dataset.contract,
    hiddenSize: options.hiddenSize,
    layerCount: options.layerCount,
    seed: options.seed,
    baseModel: options.baseModel,
    sideSpecificHeads: options.sideSpecificHeads,
    sideSpecificTrunks: options.sideSpecificTrunks,
    policyContextInteractions: options.policyContextInteractions,
  });
  const epochs = Math.max(1, Math.floor(Number(options.epochs || DEFAULT_EPOCHS)));
  const learningRate = finitePositive(options.learningRate, DEFAULT_LEARNING_RATE);
  const valueWeight = finiteNonNegative(options.valueWeight, 1);
  const policyWeight = finiteNonNegative(options.policyWeight, 1);
  const trainSides = normalizeTrainSides(options.trainSides);
  const freezeTrunk = Boolean(options.freezeTrunk);
  const optimizer = normalizeOptimizer(options.optimizer);
  const batchSize = Math.max(1, Math.floor(finitePositive(options.batchSize, DEFAULT_BATCH_SIZE)));
  const beta1 = clamp(finiteNonNegative(options.beta1, DEFAULT_ADAM_BETA1), 0, 0.999999);
  const beta2 = clamp(finiteNonNegative(options.beta2, DEFAULT_ADAM_BETA2), 0, 0.999999);
  const epsilon = finitePositive(options.epsilon, DEFAULT_ADAM_EPSILON);
  const maxGradientNorm = finitePositive(options.maxGradientNorm, DEFAULT_MAX_GRADIENT_NORM);
  const shuffleSeed = options.shuffleSeed || options.seed || "el-alamein-alpha-hex-graph-shuffle-v1";
  const optimizerState = optimizer === "adam" ? createOptimizerState(model) : null;
  const before = evaluateAlphaHexGraphModel(dataset, model);
  let updateCount = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const examples = options.shuffle === false
      ? dataset.examples
      : deterministicEpochExamples(dataset.examples, shuffleSeed, epoch);
    for (let offset = 0; offset < examples.length; offset += batchSize) {
      const batch = examples.slice(offset, offset + batchSize);
      const gradient = createModelGradient(model);
      let gradientExamples = 0;
      for (const example of batch) {
        const exampleGradient = computeExampleGradient(example, dataset.contract, model, {
          valueWeight,
          policyWeight,
          trainSides,
          freezeTrunk,
        });
        if (!exampleGradient) continue;
        addModelGradient(gradient, exampleGradient);
        gradientExamples += 1;
      }
      if (!gradientExamples) continue;
      applyModelGradient(model, gradient, {
        optimizer,
        optimizerState,
        learningRate,
        beta1,
        beta2,
        epsilon,
        maxGradientNorm,
        gradientScale: 1 / gradientExamples,
      });
      updateCount += 1;
    }
  }
  model.metrics = {
    schema: "zizi-el-alamein-alpha-hex-graph-training-v1",
    epochs,
    learningRate,
    valueWeight,
    policyWeight,
    ...(model.schema === ALPHA_HEX_GRAPH_SCHEMA ? {} : { layerCount: model.layers.length }),
    policyContextInteractions: model.schema === ALPHA_HEX_GRAPH_SCHEMA_V3,
    sideSpecificHeads: Boolean(model.sideHeads),
    sideSpecificTrunks: Boolean(model.sideLayers),
    trainSides,
    freezeTrunk,
    optimizer,
    batchSize,
    updateCount,
    ...(optimizer === "adam" ? { beta1, beta2, epsilon, maxGradientNorm } : {}),
    shuffled: options.shuffle !== false,
    before,
    after: evaluateAlphaHexGraphModel(dataset, model),
  };
  return model;
}

export function evaluateAlphaHexGraphModel(dataset, model) {
  const validation = validateAlphaSpatialDataset(dataset);
  const normalized = validation.ok ? normalizeAlphaHexGraphModel(model, dataset.contract) : null;
  if (!validation.ok || !normalized) {
    return { valueSamples: 0, valueMse: null, policyGroups: 0, policyCrossEntropy: null, policyTopChoiceAccuracy: null };
  }
  let valueSamples = 0;
  let valueSquared = 0;
  let policyGroups = 0;
  let policyCrossEntropy = 0;
  let policyTopMatches = 0;
  for (const example of dataset.examples) {
    const forward = alphaHexGraphForward(example.state, dataset.contract, normalized);
    if (!forward) continue;
    const valueTarget = graphValueTarget(example);
    if (valueTarget.usable) {
      const prediction = scoreAlphaHexGraphValue(example.state, dataset.contract, normalized, forward);
      const error = prediction - valueTarget.outcome;
      valueSquared += error * error;
      valueSamples += 1;
    }
    if (example.policy.length) {
      const logits = example.policy.map((row) => scoreAlphaHexGraphPolicy(
        example.state,
        row.encoding,
        dataset.contract,
        normalized,
        forward,
      ));
      const probabilities = softmax(logits);
      const targets = normalizedTargets(example.policy.map((row) => row.target));
      for (let index = 0; index < targets.length; index += 1) {
        if (targets[index] > 0) policyCrossEntropy -= targets[index] * Math.log(Math.max(1e-9, probabilities[index]));
      }
      const predicted = maxIndex(probabilities);
      const target = maxIndex(targets);
      if (predicted === target) policyTopMatches += 1;
      policyGroups += 1;
    }
  }
  return {
    valueSamples,
    valueMse: valueSamples ? round(valueSquared / valueSamples, 6) : null,
    policyGroups,
    policyCrossEntropy: policyGroups ? round(policyCrossEntropy / policyGroups, 6) : null,
    policyTopChoiceAccuracy: policyGroups ? round(policyTopMatches / policyGroups, 6) : null,
  };
}

export function alphaHexGraphParameterCount(model) {
  const normalized = normalizeAlphaHexGraphModel(model);
  if (!normalized) return 0;
  const sharedParameters = normalized.layers.reduce((sum, layer) => (
    sum + matrixSize(layer.selfWeights) + matrixSize(layer.neighborWeights) + layer.biases.length
  ), 0) + normalized.valueHead.weights.length + 1 + normalized.policyHead.weights.length + 1;
  const sideParameters = normalized.sideHeads
    ? Object.values(normalized.sideHeads).reduce((sum, heads) => (
      sum + heads.valueHead.weights.length + 1 + heads.policyHead.weights.length + 1
    ), 0)
    : 0;
  const sideLayerParameters = normalized.sideLayers
    ? Object.values(normalized.sideLayers).reduce((sum, layers) => sum + layers.reduce((layerSum, layer) => (
      layerSum + matrixSize(layer.selfWeights) + matrixSize(layer.neighborWeights) + layer.biases.length
    ), 0), 0)
    : 0;
  return sharedParameters + sideParameters + sideLayerParameters;
}

function computeExampleGradient(example, contract, model, options) {
  const headSide = model.sideHeads && ["axis", "allied"].includes(example.state?.side)
    ? example.state.side
    : null;
  const trainHead = !options.trainSides.length || (headSide && options.trainSides.includes(headSide));
  if (!trainHead) return null;
  const forward = alphaHexGraphForward(example.state, contract, model);
  if (!forward) return null;
  const nodeCount = forward.embeddings.length;
  const hiddenSize = model.hiddenSize;
  const embeddingGradient = makeMatrix(nodeCount, hiddenSize);
  const valueHeadGradient = makeHeadGradient(model.valueHead.weights.length);
  const policyHeadGradient = makeHeadGradient(model.policyHead.weights.length);
  const heads = headSide ? model.sideHeads[headSide] : model;
  const sharedTrainingWeight = clamp(Number(example.trainingWeight ?? 1), 0, 4);
  const valueTrainingWeight = clamp(Number(example.valueTrainingWeight ?? sharedTrainingWeight), 0, 4);
  const policyTrainingWeight = clamp(Number(example.policyTrainingWeight ?? sharedTrainingWeight), 0, 4);
  const valueSampleWeight = clamp(Number(example.outcomeWeight ?? 1), 0, 1) * valueTrainingWeight;
  const policySampleWeight = clamp(Number(example.policyWeight ?? 1), 0, 1) * policyTrainingWeight;

  const valueTarget = graphValueTarget(example);
  if (valueTarget.usable && options.valueWeight > 0) {
    const raw = headLogit(forward.valueVector, heads.valueHead);
    const prediction = Math.tanh(raw);
    const target = valueTarget.outcome;
    const outputGradient = valueSampleWeight * options.valueWeight * (prediction - target) * (1 - prediction * prediction);
    addHeadGradient(valueHeadGradient, forward.valueVector, outputGradient);
    const vectorGradient = heads.valueHead.weights.map((weight) => outputGradient * weight);
    addValuePoolGradient(embeddingGradient, vectorGradient, contract, hiddenSize);
  }

  if (example.policy.length && options.policyWeight > 0) {
    const vectors = example.policy.map((row) => policyVector(
      forward.embeddings,
      example.state,
      row.encoding,
      contract,
      model,
    ));
    const probabilities = softmax(vectors.map((vector) => headLogit(vector, heads.policyHead)));
    const targets = normalizedTargets(example.policy.map((row) => row.target));
    for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
      const outputGradient = policySampleWeight * options.policyWeight * (probabilities[rowIndex] - targets[rowIndex]);
      addHeadGradient(policyHeadGradient, vectors[rowIndex], outputGradient);
      const vectorGradient = heads.policyHead.weights.map((weight) => outputGradient * weight);
      addPolicyPoolGradient(
        embeddingGradient,
        vectorGradient,
        example.policy[rowIndex].encoding,
        example.state,
        contract,
        hiddenSize,
        model,
      );
    }
  }

  return {
    layers: options.freezeTrunk
      ? createModelGradient(model).layers
      : backpropGraph(forward.graphLayers, forward, embeddingGradient, contract.topology),
    valueHead: valueHeadGradient,
    policyHead: policyHeadGradient,
    headSide,
    layerSide: forward.layerSide,
  };
}

function graphValueTarget(example) {
  const rawOutcome = example?.outcome;
  const outcomeWeight = Number(example?.outcomeWeight ?? 1);
  const valueTrainingWeight = Number(example?.valueTrainingWeight ?? example?.trainingWeight ?? 1);
  if (
    typeof rawOutcome !== "number"
    || !Number.isFinite(rawOutcome)
    || !Number.isFinite(outcomeWeight)
    || !Number.isFinite(valueTrainingWeight)
    || !(outcomeWeight > 0)
    || !(valueTrainingWeight > 0)
  ) {
    return { usable: false, outcome: null };
  }
  return { usable: true, outcome: clamp(rawOutcome, -1, 1) };
}

function graphLayerForward(inputs, topology, layer) {
  const neighborMeans = topology.map((hex) => meanRows(inputs, hex.neighbors));
  const activations = inputs.map((input, nodeIndex) => layer.biases.map((bias, outputIndex) => {
    let value = bias;
    value += dot(layer.selfWeights[outputIndex], input);
    value += dot(layer.neighborWeights[outputIndex], neighborMeans[nodeIndex]);
    return Math.tanh(value);
  }));
  return { inputs, neighborMeans, activations };
}

function backpropGraph(layers, forward, outputGradient, topology) {
  const gradients = Array.from({ length: layers.length });
  let inputGradient = outputGradient;
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const result = backpropLayer(layers[index], forward.layers[index], inputGradient, topology);
    gradients[index] = result.gradient;
    inputGradient = result.inputGradient;
  }
  return gradients;
}

function backpropLayer(layer, forward, outputGradient, topology) {
  const outputSize = layer.biases.length;
  const inputSize = layer.selfWeights[0].length;
  const inputGradient = makeMatrix(forward.inputs.length, inputSize);
  const gradient = {
    selfWeights: makeMatrix(outputSize, inputSize),
    neighborWeights: makeMatrix(outputSize, inputSize),
    biases: Array.from({ length: outputSize }, () => 0),
  };
  for (let nodeIndex = 0; nodeIndex < forward.inputs.length; nodeIndex += 1) {
    const neighbors = topology[nodeIndex].neighbors;
    for (let outputIndex = 0; outputIndex < outputSize; outputIndex += 1) {
      const activation = forward.activations[nodeIndex][outputIndex];
      const delta = Number(outputGradient[nodeIndex][outputIndex] || 0) * (1 - activation * activation);
      gradient.biases[outputIndex] += delta;
      for (let inputIndex = 0; inputIndex < inputSize; inputIndex += 1) {
        gradient.selfWeights[outputIndex][inputIndex] += delta * forward.inputs[nodeIndex][inputIndex];
        gradient.neighborWeights[outputIndex][inputIndex] += delta * forward.neighborMeans[nodeIndex][inputIndex];
        inputGradient[nodeIndex][inputIndex] += delta * layer.selfWeights[outputIndex][inputIndex];
        if (neighbors.length) {
          const neighborDelta = delta * layer.neighborWeights[outputIndex][inputIndex] / neighbors.length;
          for (const neighborIndex of neighbors) inputGradient[neighborIndex][inputIndex] += neighborDelta;
        }
      }
    }
  }
  return { gradient, inputGradient };
}

function valuePools(embeddings, contract) {
  const all = contract.topology.map((_, index) => index);
  const axisObjectives = contract.topology.flatMap((hex, index) => hex.axisObjective ? [index] : []);
  const alliedExit = contract.topology.flatMap((hex, index) => hex.alliedExit ? [index] : []);
  return [
    meanRows(embeddings, all),
    meanRows(embeddings, axisObjectives),
    meanRows(embeddings, alliedExit),
  ];
}

function policyVector(embeddings, stateEncoding, actionEncoding, contract, model) {
  const actionPlanes = Object.fromEntries(contract.actionChannels.map((name, index) => [name, actionEncoding.planes[index]]));
  const selections = Object.fromEntries(contract.actionChannels.map((channel) => [
    channel,
    positiveIndexes(actionPlanes[channel]),
  ]));
  return policyVectorFromSelections(embeddings, stateEncoding, selections, actionEncoding.global, contract, model);
}

function policyVectorFromSelections(
  embeddings,
  stateEncoding,
  selections,
  actionGlobal,
  contract,
  model,
  globalPool = null,
) {
  const pools = [globalPool || meanRows(embeddings, contract.topology.map((_, index) => index))];
  for (const channel of contract.actionChannels) pools.push(meanRows(embeddings, selections[channel]));
  const base = [...pools.flat(), ...stateEncoding.global, ...actionGlobal];
  if (model?.schema !== ALPHA_HEX_GRAPH_SCHEMA_V3) return base;
  const actionFeatures = [...pools.slice(1).flat(), ...actionGlobal];
  return [...base, ...contextActionProducts(policyContextVector(stateEncoding), actionFeatures)];
}

function addValuePoolGradient(embeddingGradient, vectorGradient, contract, hiddenSize) {
  const selections = [
    contract.topology.map((_, index) => index),
    contract.topology.flatMap((hex, index) => hex.axisObjective ? [index] : []),
    contract.topology.flatMap((hex, index) => hex.alliedExit ? [index] : []),
  ];
  for (let poolIndex = 0; poolIndex < selections.length; poolIndex += 1) {
    distributePoolGradient(
      embeddingGradient,
      selections[poolIndex],
      vectorGradient.slice(poolIndex * hiddenSize, (poolIndex + 1) * hiddenSize),
    );
  }
}

function addPolicyPoolGradient(
  embeddingGradient,
  vectorGradient,
  actionEncoding,
  stateEncoding,
  contract,
  hiddenSize,
  model,
) {
  const actionPlanes = Object.fromEntries(contract.actionChannels.map((name, index) => [name, actionEncoding.planes[index]]));
  const selections = [
    contract.topology.map((_, index) => index),
    ...contract.actionChannels.map((channel) => positiveIndexes(actionPlanes[channel])),
  ];
  for (let poolIndex = 0; poolIndex < selections.length; poolIndex += 1) {
    distributePoolGradient(
      embeddingGradient,
      selections[poolIndex],
      vectorGradient.slice(poolIndex * hiddenSize, (poolIndex + 1) * hiddenSize),
    );
  }
  if (model?.schema !== ALPHA_HEX_GRAPH_SCHEMA_V3) return;
  const baseSize = basePolicyVectorSize(hiddenSize);
  const actionFeatureSize = policyActionFeatureSize(hiddenSize);
  const context = policyContextVector(stateEncoding);
  const interactionGradient = vectorGradient.slice(baseSize);
  const actionGradient = Array.from({ length: actionFeatureSize }, () => 0);
  for (let contextIndex = 0; contextIndex < context.length; contextIndex += 1) {
    for (let featureIndex = 0; featureIndex < actionFeatureSize; featureIndex += 1) {
      actionGradient[featureIndex] += Number(context[contextIndex] || 0)
        * Number(interactionGradient[contextIndex * actionFeatureSize + featureIndex] || 0);
    }
  }
  for (let channelIndex = 0; channelIndex < contract.actionChannels.length; channelIndex += 1) {
    distributePoolGradient(
      embeddingGradient,
      selections[channelIndex + 1],
      actionGradient.slice(channelIndex * hiddenSize, (channelIndex + 1) * hiddenSize),
    );
  }
}

function distributePoolGradient(output, indexes, gradient) {
  if (!indexes.length) return;
  for (const index of indexes) {
    for (let feature = 0; feature < gradient.length; feature += 1) {
      output[index][feature] += Number(gradient[feature] || 0) / indexes.length;
    }
  }
}

function basePolicyVectorSize(hiddenSize) {
  return hiddenSize * (1 + ALPHA_SPATIAL_ACTION_CHANNELS.length)
    + ALPHA_SPATIAL_GLOBAL_KEYS.length
    + ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.length;
}

function policyActionFeatureSize(hiddenSize) {
  return hiddenSize * ALPHA_SPATIAL_ACTION_CHANNELS.length
    + ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.length;
}

function policyVectorSize(hiddenSize, schema) {
  const baseSize = basePolicyVectorSize(hiddenSize);
  return schema === ALPHA_HEX_GRAPH_SCHEMA_V3
    ? baseSize + ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS.length * policyActionFeatureSize(hiddenSize)
    : baseSize;
}

function policyContextVector(stateEncoding) {
  const valueByKey = Object.fromEntries(ALPHA_SPATIAL_GLOBAL_KEYS.map((key, index) => [
    key,
    Number(stateEncoding?.global?.[index] || 0),
  ]));
  const turnProgress = valueByKey.turnProgress;
  return [
    turnProgress,
    turnProgress * turnProgress,
    valueByKey.movementPhase,
    valueByKey.combatPhase,
    valueByKey.retreatPending,
    valueByKey.advancePending,
  ];
}

function contextActionProducts(context, actionFeatures) {
  return context.flatMap((contextValue) => actionFeatures.map((actionValue) => (
    Number(contextValue || 0) * Number(actionValue || 0)
  )));
}

function createGraphLayer(inputSize, outputSize, seed) {
  const scale = Math.sqrt(3 / Math.max(1, inputSize + outputSize));
  return {
    inputSize,
    outputSize,
    selfWeights: Array.from({ length: outputSize }, (_, outputIndex) => (
      Array.from({ length: inputSize }, (_, inputIndex) => deterministicParameter(seed, `self:${outputIndex}:${inputIndex}`, scale))
    )),
    neighborWeights: Array.from({ length: outputSize }, (_, outputIndex) => (
      Array.from({ length: inputSize }, (_, inputIndex) => deterministicParameter(seed, `neighbor:${outputIndex}:${inputIndex}`, scale))
    )),
    biases: Array.from({ length: outputSize }, () => 0),
  };
}

function normalizeGraphLayer(value, inputSize, outputSize) {
  if (!value || Number(value.inputSize) !== inputSize || Number(value.outputSize) !== outputSize) return null;
  const selfWeights = finiteMatrix(value.selfWeights, outputSize, inputSize);
  const neighborWeights = finiteMatrix(value.neighborWeights, outputSize, inputSize);
  const biases = finiteVector(value.biases, outputSize);
  if (!selfWeights || !neighborWeights || !biases) return null;
  return { inputSize, outputSize, selfWeights, neighborWeights, biases };
}

function createHead(inputSize, seed) {
  const scale = Math.sqrt(2 / Math.max(1, inputSize));
  return {
    inputSize,
    weights: Array.from({ length: inputSize }, (_, index) => deterministicParameter(seed, `weight:${index}`, scale)),
    bias: 0,
  };
}

function createSideHeads(valueHead, policyHead) {
  return Object.fromEntries(["axis", "allied"].map((side) => [side, {
    valueHead: cloneModel(valueHead),
    policyHead: cloneModel(policyHead),
  }]));
}

function createSideLayers(layers) {
  return Object.fromEntries(["axis", "allied"].map((side) => [side, cloneModel(layers)]));
}

function upgradePolicyContextInteractions(model) {
  const upgraded = cloneModel(model);
  const policySize = policyVectorSize(upgraded.hiddenSize, ALPHA_HEX_GRAPH_SCHEMA_V3);
  upgraded.schema = ALPHA_HEX_GRAPH_SCHEMA_V3;
  upgraded.layerCount = upgraded.layers.length;
  upgraded.policyContextKeys = ALPHA_HEX_GRAPH_POLICY_CONTEXT_KEYS.slice();
  upgraded.policyHead = expandHeadWithZeros(upgraded.policyHead, policySize);
  if (upgraded.sideHeads) {
    for (const side of ["axis", "allied"]) {
      upgraded.sideHeads[side].policyHead = expandHeadWithZeros(upgraded.sideHeads[side].policyHead, policySize);
    }
  }
  return upgraded;
}

function expandHeadWithZeros(head, inputSize) {
  if (head.inputSize > inputSize) throw new Error("Alpha graph policy head cannot shrink during interaction upgrade");
  return {
    inputSize,
    weights: [
      ...head.weights,
      ...Array.from({ length: inputSize - head.weights.length }, () => 0),
    ],
    bias: Number(head.bias || 0),
  };
}

function resizeModelDepth(model, requestedLayerCount, seed) {
  if (requestedLayerCount === null || requestedLayerCount === undefined || requestedLayerCount === "") {
    return cloneModel(model);
  }
  const target = normalizeLayerCount(requestedLayerCount);
  if (target === model.layers.length) return cloneModel(model);
  const resized = cloneModel(model);
  if (target < resized.layers.length) {
    resized.layers = resized.layers.slice(0, target);
    if (resized.sideLayers) {
      for (const side of ["axis", "allied"]) resized.sideLayers[side] = resized.sideLayers[side].slice(0, target);
    }
  } else {
    const additions = Array.from({ length: target - resized.layers.length }, (_, offset) => createGraphLayer(
      resized.hiddenSize,
      resized.hiddenSize,
      `${seed}:layer-${resized.layers.length + offset + 1}`,
    ));
    resized.layers.push(...additions);
    if (resized.sideLayers) {
      for (const side of ["axis", "allied"]) resized.sideLayers[side].push(...cloneModel(additions));
    }
  }
  if (resized.schema === ALPHA_HEX_GRAPH_SCHEMA_V3) {
    resized.layerCount = target;
  } else {
    resized.schema = target === DEFAULT_LAYER_COUNT ? ALPHA_HEX_GRAPH_SCHEMA : ALPHA_HEX_GRAPH_SCHEMA_V2;
    if (target === DEFAULT_LAYER_COUNT) delete resized.layerCount;
    else resized.layerCount = target;
  }
  return resized;
}

function normalizeSideHeads(value, valueSize, policySize) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const side of ["axis", "allied"]) {
    const valueHead = normalizeHead(value[side]?.valueHead, valueSize);
    const policyHead = normalizeHead(value[side]?.policyHead, policySize);
    if (!valueHead || !policyHead) return null;
    normalized[side] = { valueHead, policyHead };
  }
  return normalized;
}

function validSideHeadsShape(value, valueSize, policySize) {
  return ["axis", "allied"].every((side) => (
    value?.[side]?.valueHead?.inputSize === valueSize
    && Array.isArray(value[side].valueHead.weights)
    && value[side].valueHead.weights.length === valueSize
    && value[side].policyHead?.inputSize === policySize
    && Array.isArray(value[side].policyHead.weights)
    && value[side].policyHead.weights.length === policySize
  ));
}

function normalizeSideLayers(value, hiddenSize, layerCount) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = {};
  for (const side of ["axis", "allied"]) {
    if (!Array.isArray(value[side]) || value[side].length !== layerCount) return null;
    const layers = value[side].map((layer, index) => normalizeGraphLayer(
      layer,
      index === 0 ? ALPHA_SPATIAL_STATE_CHANNELS.length : hiddenSize,
      hiddenSize,
    ));
    if (layers.some((layer) => !layer)) return null;
    normalized[side] = layers;
  }
  return normalized;
}

function validSideLayersShape(value, hiddenSize, layerCount) {
  return ["axis", "allied"].every((side) => {
    const layers = value?.[side];
    return Array.isArray(layers)
      && layers.length === layerCount
      && layers.every((layer, index) => validGraphLayerShape(
        layer,
        index === 0 ? ALPHA_SPATIAL_STATE_CHANNELS.length : hiddenSize,
        hiddenSize,
      ));
  });
}

function isAlphaHexGraphSchema(value) {
  return value === ALPHA_HEX_GRAPH_SCHEMA
    || value === ALPHA_HEX_GRAPH_SCHEMA_V2
    || value === ALPHA_HEX_GRAPH_SCHEMA_V3;
}

function normalizeLayerCount(value) {
  const count = Math.floor(Number(value || DEFAULT_LAYER_COUNT));
  return Math.min(MAX_LAYER_COUNT, Math.max(DEFAULT_LAYER_COUNT, Number.isFinite(count) ? count : DEFAULT_LAYER_COUNT));
}

function normalizedModelLayerCount(value) {
  if (!Array.isArray(value?.layers)) return 0;
  const count = value.layers.length;
  if (value.schema === ALPHA_HEX_GRAPH_SCHEMA) return count === DEFAULT_LAYER_COUNT ? count : 0;
  if (value.schema !== ALPHA_HEX_GRAPH_SCHEMA_V2 && value.schema !== ALPHA_HEX_GRAPH_SCHEMA_V3) return 0;
  if (count < DEFAULT_LAYER_COUNT || count > MAX_LAYER_COUNT) return 0;
  return Number(value.layerCount) === count ? count : 0;
}

function validGraphLayerShape(layer, inputSize, outputSize) {
  return layer?.inputSize === inputSize
    && layer?.outputSize === outputSize
    && Array.isArray(layer.selfWeights)
    && layer.selfWeights.length === outputSize
    && layer.selfWeights.every((row) => Array.isArray(row) && row.length === inputSize)
    && Array.isArray(layer.neighborWeights)
    && layer.neighborWeights.length === outputSize
    && layer.neighborWeights.every((row) => Array.isArray(row) && row.length === inputSize)
    && Array.isArray(layer.biases)
    && layer.biases.length === outputSize;
}

function headsForState(model, stateEncoding) {
  const side = stateEncoding?.side;
  return model.sideHeads?.[side] || model;
}

function normalizeHead(value, inputSize) {
  if (!value || Number(value.inputSize) !== inputSize) return null;
  const weights = finiteVector(value.weights, inputSize);
  const bias = Number(value.bias);
  if (!weights || !Number.isFinite(bias)) return null;
  return { inputSize, weights, bias };
}

function makeHeadGradient(inputSize) {
  return { weights: Array.from({ length: inputSize }, () => 0), bias: 0 };
}

function addHeadGradient(output, inputs, gradient) {
  output.bias += gradient;
  for (let index = 0; index < output.weights.length; index += 1) output.weights[index] += gradient * Number(inputs[index] || 0);
}

function createModelGradient(model) {
  const gradient = {
    layers: model.layers.map((layer) => ({
      selfWeights: makeMatrix(layer.outputSize, layer.inputSize),
      neighborWeights: makeMatrix(layer.outputSize, layer.inputSize),
      biases: Array.from({ length: layer.outputSize }, () => 0),
    })),
    valueHead: makeHeadGradient(model.valueHead.weights.length),
    policyHead: makeHeadGradient(model.policyHead.weights.length),
  };
  if (model.sideHeads) {
    gradient.sideHeads = Object.fromEntries(["axis", "allied"].map((side) => [side, {
      valueHead: makeHeadGradient(model.sideHeads[side].valueHead.weights.length),
      policyHead: makeHeadGradient(model.sideHeads[side].policyHead.weights.length),
    }]));
  }
  if (model.sideLayers) {
    gradient.sideLayers = Object.fromEntries(["axis", "allied"].map((side) => [side, model.sideLayers[side].map((layer) => ({
      selfWeights: makeMatrix(layer.outputSize, layer.inputSize),
      neighborWeights: makeMatrix(layer.outputSize, layer.inputSize),
      biases: Array.from({ length: layer.outputSize }, () => 0),
    }))]));
  }
  return gradient;
}

function createOptimizerState(model) {
  return {
    step: 0,
    first: createModelGradient(model),
    second: createModelGradient(model),
  };
}

function addModelGradient(output, addition) {
  const targetLayers = addition.layerSide && output.sideLayers?.[addition.layerSide]
    ? output.sideLayers[addition.layerSide]
    : output.layers;
  for (let layerIndex = 0; layerIndex < targetLayers.length; layerIndex += 1) {
    addMatrix(targetLayers[layerIndex].selfWeights, addition.layers[layerIndex].selfWeights);
    addMatrix(targetLayers[layerIndex].neighborWeights, addition.layers[layerIndex].neighborWeights);
    addVector(targetLayers[layerIndex].biases, addition.layers[layerIndex].biases);
  }
  const targetHeads = addition.headSide && output.sideHeads?.[addition.headSide]
    ? output.sideHeads[addition.headSide]
    : output;
  addHeadGradientValues(targetHeads.valueHead, addition.valueHead);
  addHeadGradientValues(targetHeads.policyHead, addition.policyHead);
}

function addHeadGradientValues(output, addition) {
  output.bias += Number(addition.bias || 0);
  addVector(output.weights, addition.weights);
}

function addMatrix(output, addition) {
  for (let row = 0; row < output.length; row += 1) addVector(output[row], addition[row]);
}

function addVector(output, addition) {
  for (let index = 0; index < output.length; index += 1) output[index] += Number(addition[index] || 0);
}

function applyModelGradient(model, gradient, options) {
  const state = options.optimizerState;
  if (state) state.step += 1;
  const gradientNorm = modelGradientNorm(gradient, options.gradientScale);
  const normScale = gradientNorm > options.maxGradientNorm
    ? options.maxGradientNorm / gradientNorm
    : 1;
  const scale = options.gradientScale * normScale;
  applyLayerModelGradient(model.layers, gradient.layers, state?.first.layers, state?.second.layers, scale, options);
  if (model.sideLayers) {
    for (const side of ["axis", "allied"]) {
      applyLayerModelGradient(
        model.sideLayers[side],
        gradient.sideLayers[side],
        state?.first.sideLayers[side],
        state?.second.sideLayers[side],
        scale,
        options,
      );
    }
  }
  applyHeadModelGradient(model.valueHead, gradient.valueHead, state?.first.valueHead, state?.second.valueHead, scale, options);
  applyHeadModelGradient(model.policyHead, gradient.policyHead, state?.first.policyHead, state?.second.policyHead, scale, options);
  if (model.sideHeads) {
    for (const side of ["axis", "allied"]) {
      applyHeadModelGradient(
        model.sideHeads[side].valueHead,
        gradient.sideHeads[side].valueHead,
        state?.first.sideHeads[side].valueHead,
        state?.second.sideHeads[side].valueHead,
        scale,
        options,
      );
      applyHeadModelGradient(
        model.sideHeads[side].policyHead,
        gradient.sideHeads[side].policyHead,
        state?.first.sideHeads[side].policyHead,
        state?.second.sideHeads[side].policyHead,
        scale,
        options,
      );
    }
  }
}

function applyLayerModelGradient(layers, gradients, first, second, scale, options) {
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    applyMatrixGradient(
      layers[layerIndex].selfWeights,
      gradients[layerIndex].selfWeights,
      first?.[layerIndex].selfWeights,
      second?.[layerIndex].selfWeights,
      scale,
      options,
    );
    applyMatrixGradient(
      layers[layerIndex].neighborWeights,
      gradients[layerIndex].neighborWeights,
      first?.[layerIndex].neighborWeights,
      second?.[layerIndex].neighborWeights,
      scale,
      options,
    );
    applyVectorGradient(
      layers[layerIndex].biases,
      gradients[layerIndex].biases,
      first?.[layerIndex].biases,
      second?.[layerIndex].biases,
      scale,
      options,
    );
  }
}

function applyHeadModelGradient(head, gradient, first, second, scale, options) {
  applyVectorGradient(head.weights, gradient.weights, first?.weights, second?.weights, scale, options);
  const updated = updateParameter(head.bias, gradient.bias * scale, first?.bias, second?.bias, options);
  head.bias = updated.parameter;
  if (first) first.bias = updated.first;
  if (second) second.bias = updated.second;
}

function applyMatrixGradient(parameters, gradients, first, second, scale, options) {
  for (let row = 0; row < parameters.length; row += 1) {
    applyVectorGradient(parameters[row], gradients[row], first?.[row], second?.[row], scale, options);
  }
}

function applyVectorGradient(parameters, gradients, first, second, scale, options) {
  for (let index = 0; index < parameters.length; index += 1) {
    const updated = updateParameter(
      parameters[index],
      Number(gradients[index] || 0) * scale,
      first?.[index],
      second?.[index],
      options,
    );
    parameters[index] = updated.parameter;
    if (first) first[index] = updated.first;
    if (second) second[index] = updated.second;
  }
}

function modelGradientNorm(gradient, scale) {
  let squared = 0;
  const add = (value) => {
    const scaled = Number(value || 0) * scale;
    squared += scaled * scaled;
  };
  for (const layer of gradient.layers) {
    for (const row of layer.selfWeights) row.forEach(add);
    for (const row of layer.neighborWeights) row.forEach(add);
    layer.biases.forEach(add);
  }
  gradient.valueHead.weights.forEach(add);
  gradient.policyHead.weights.forEach(add);
  add(gradient.valueHead.bias);
  add(gradient.policyHead.bias);
  if (gradient.sideHeads) {
    for (const side of ["axis", "allied"]) {
      gradient.sideHeads[side].valueHead.weights.forEach(add);
      gradient.sideHeads[side].policyHead.weights.forEach(add);
      add(gradient.sideHeads[side].valueHead.bias);
      add(gradient.sideHeads[side].policyHead.bias);
    }
  }
  if (gradient.sideLayers) {
    for (const side of ["axis", "allied"]) {
      for (const layer of gradient.sideLayers[side]) {
        for (const row of layer.selfWeights) row.forEach(add);
        for (const row of layer.neighborWeights) row.forEach(add);
        layer.biases.forEach(add);
      }
    }
  }
  return Math.sqrt(squared);
}

function headLogit(inputs, head) {
  return dot(inputs, head.weights) + Number(head.bias || 0);
}

function updateParameter(parameter, gradient, first, second, options) {
  const clippedGradient = clamp(Number(gradient || 0), -MAX_GRADIENT, MAX_GRADIENT);
  if (options.optimizer !== "adam") {
    return {
      parameter: clamp(Number(parameter || 0) - options.learningRate * clippedGradient, -MAX_PARAMETER, MAX_PARAMETER),
      first: Number(first || 0),
      second: Number(second || 0),
    };
  }
  const nextFirst = options.beta1 * Number(first || 0) + (1 - options.beta1) * clippedGradient;
  const nextSecond = options.beta2 * Number(second || 0) + (1 - options.beta2) * clippedGradient * clippedGradient;
  const firstHat = nextFirst / Math.max(1e-12, 1 - options.beta1 ** options.optimizerState.step);
  const secondHat = nextSecond / Math.max(1e-12, 1 - options.beta2 ** options.optimizerState.step);
  const update = options.learningRate * firstHat / (Math.sqrt(secondHat) + options.epsilon);
  return {
    parameter: clamp(Number(parameter || 0) - update, -MAX_PARAMETER, MAX_PARAMETER),
    first: nextFirst,
    second: nextSecond,
  };
}

function transposePlanes(planes) {
  const nodes = planes[0]?.length || 0;
  return Array.from({ length: nodes }, (_, nodeIndex) => planes.map((plane) => Number(plane[nodeIndex] || 0)));
}

function meanRows(rows, indexes) {
  const width = rows[0]?.length || 0;
  if (!indexes?.length) return Array.from({ length: width }, () => 0);
  const output = Array.from({ length: width }, () => 0);
  for (const index of indexes) {
    const row = rows[index];
    if (!row) continue;
    for (let feature = 0; feature < width; feature += 1) output[feature] += Number(row[feature] || 0) / indexes.length;
  }
  return output;
}

function positiveIndexes(plane) {
  return (plane || []).flatMap((value, index) => Number(value) > 0 ? [index] : []);
}

function normalizedTargets(values) {
  const clipped = values.map((value) => Math.max(0, Number(value || 0)));
  const total = clipped.reduce((sum, value) => sum + value, 0);
  if (total > 0) return clipped.map((value) => value / total);
  return clipped.length ? clipped.map(() => 1 / clipped.length) : [];
}

function softmax(values) {
  if (!values.length) return [];
  const max = Math.max(...values);
  const exponents = values.map((value) => Math.exp(clamp(Number(value || 0) - max, -40, 40)));
  const total = exponents.reduce((sum, value) => sum + value, 0);
  return exponents.map((value) => value / Math.max(1e-9, total));
}

function maxIndex(values) {
  let best = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (best < 0 || values[index] > values[best]) best = index;
  }
  return best;
}

function deterministicParameter(seed, label, scale) {
  let hash = 2166136261;
  const text = `${seed}:${label}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((((hash >>> 0) / 4294967295) * 2) - 1) * scale;
}

function deterministicEpochExamples(examples, seed, epoch) {
  return examples
    .map((example, index) => ({
      example,
      index,
      order: deterministicOrderHash(`${seed}:${epoch}:${example?.stateHash || "state"}:${example?.side || "side"}:${example?.phaseId || "phase"}:${example?.turn ?? "turn"}:${example?.outcome ?? "outcome"}`),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.example);
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

function finiteMatrix(value, rows, columns) {
  if (!Array.isArray(value) || value.length !== rows) return null;
  const matrix = value.map((row) => finiteVector(row, columns));
  return matrix.every(Boolean) ? matrix : null;
}

function finiteVector(value, length) {
  if (!Array.isArray(value) || value.length !== length) return null;
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : null;
}

function makeMatrix(rows, columns) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0));
}

function matrixSize(matrix) {
  return (matrix || []).reduce((sum, row) => sum + (row?.length || 0), 0);
}

function dot(left, right) {
  let result = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) result += Number(left[index] || 0) * Number(right[index] || 0);
  return result;
}

function sameStrings(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => String(value) === String(right[index]));
}

function finitePositive(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function finiteNonNegative(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function normalizeOptimizer(value) {
  return String(value || "sgd").toLowerCase() === "adam" ? "adam" : "sgd";
}

function normalizeTrainSides(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((side) => String(side).trim().toLowerCase()).filter((side) => (
    side === "axis" || side === "allied"
  )))];
}

function normalizeMetrics(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? cloneModel(value) : {};
}

function cloneModel(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}
