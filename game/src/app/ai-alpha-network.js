export const ALPHA_DENSE_NETWORK_SCHEMA = "zizi-el-alamein-alpha-dense-network-v1";

const DEFAULT_HIDDEN_SIZE = 8;
const MAX_PARAMETER = 8;

export function createAlphaDenseNetwork({
  featureKeys = [],
  hiddenSize = DEFAULT_HIDDEN_SIZE,
  seed = "el-alamein-alpha-network-v1",
  baseNetwork = null,
  weightScale = null,
} = {}) {
  const keys = uniqueStrings(featureKeys);
  const normalizedBase = normalizeAlphaDenseNetwork(baseNetwork, keys);
  if (normalizedBase) return normalizedBase;

  const units = Math.max(1, Math.floor(Number(hiddenSize || DEFAULT_HIDDEN_SIZE)));
  const configuredScale = Number(weightScale);
  const scale = Number.isFinite(configuredScale) && configuredScale > 0
    ? configuredScale
    : Math.sqrt(6 / Math.max(1, keys.length + units));
  return {
    schema: ALPHA_DENSE_NETWORK_SCHEMA,
    activation: "tanh",
    featureKeys: keys,
    hiddenSize: units,
    inputWeights: Array.from({ length: units }, (_, hiddenIndex) => (
      keys.map((_, featureIndex) => deterministicParameter(seed, `input:${hiddenIndex}:${featureIndex}`, scale))
    )),
    hiddenBiases: Array.from({ length: units }, (_, hiddenIndex) => (
      deterministicParameter(seed, `hidden-bias:${hiddenIndex}`, scale * 0.25)
    )),
    outputWeights: Array.from({ length: units }, (_, hiddenIndex) => (
      deterministicParameter(seed, `output:${hiddenIndex}`, scale)
    )),
    outputBias: 0,
  };
}

export function normalizeAlphaDenseNetwork(value, expectedFeatureKeys = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_DENSE_NETWORK_SCHEMA || value.activation !== "tanh") return null;
  const featureKeys = uniqueStrings(value.featureKeys);
  if (!featureKeys.length) return null;
  if (Array.isArray(expectedFeatureKeys) && expectedFeatureKeys.length) {
    const expected = uniqueStrings(expectedFeatureKeys);
    if (expected.length !== featureKeys.length || expected.some((key, index) => key !== featureKeys[index])) return null;
  }
  const hiddenSize = Math.max(0, Math.floor(Number(value.hiddenSize || 0)));
  if (!hiddenSize) return null;
  const inputWeights = finiteMatrix(value.inputWeights, hiddenSize, featureKeys.length);
  const hiddenBiases = finiteVector(value.hiddenBiases, hiddenSize);
  const outputWeights = finiteVector(value.outputWeights, hiddenSize);
  const outputBias = Number(value.outputBias);
  if (!inputWeights || !hiddenBiases || !outputWeights || !Number.isFinite(outputBias)) return null;
  return {
    schema: ALPHA_DENSE_NETWORK_SCHEMA,
    activation: "tanh",
    featureKeys,
    hiddenSize,
    inputWeights,
    hiddenBiases,
    outputWeights,
    outputBias,
  };
}

export function alphaDenseNetworkForward(features, network) {
  if (!alphaDenseNetworkRuntimeShape(network)) return null;
  const inputs = network.featureKeys.map((key) => finiteNumber(features?.[key], 0));
  const hidden = network.inputWeights.map((weights, hiddenIndex) => {
    let activation = finiteNumber(network.hiddenBiases[hiddenIndex], 0);
    for (let featureIndex = 0; featureIndex < inputs.length; featureIndex += 1) {
      activation += finiteNumber(weights[featureIndex], 0) * inputs[featureIndex];
    }
    return Math.tanh(activation);
  });
  let output = finiteNumber(network.outputBias, 0);
  for (let hiddenIndex = 0; hiddenIndex < hidden.length; hiddenIndex += 1) {
    output += finiteNumber(network.outputWeights[hiddenIndex], 0) * hidden[hiddenIndex];
  }
  return { output, inputs, hidden };
}

function alphaDenseNetworkRuntimeShape(value) {
  if (!value || value.schema !== ALPHA_DENSE_NETWORK_SCHEMA || value.activation !== "tanh") return false;
  if (!Array.isArray(value.featureKeys) || !value.featureKeys.length) return false;
  if (!Number.isInteger(value.hiddenSize) || value.hiddenSize < 1) return false;
  return Array.isArray(value.inputWeights)
    && value.inputWeights.length === value.hiddenSize
    && value.inputWeights.every((row) => Array.isArray(row) && row.length === value.featureKeys.length)
    && Array.isArray(value.hiddenBiases)
    && value.hiddenBiases.length === value.hiddenSize
    && Array.isArray(value.outputWeights)
    && value.outputWeights.length === value.hiddenSize;
}

export function applyAlphaDenseNetworkGradient(network, forward, outputGradient, learningRate) {
  const gradient = Number(outputGradient);
  const rate = Number(learningRate);
  if (!network || !forward || !Number.isFinite(gradient) || !Number.isFinite(rate) || rate === 0) return network;
  const previousOutputWeights = network.outputWeights.slice();
  network.outputBias = clampParameter(network.outputBias - rate * gradient);
  for (let hiddenIndex = 0; hiddenIndex < network.hiddenSize; hiddenIndex += 1) {
    const hiddenValue = Number(forward.hidden[hiddenIndex] || 0);
    network.outputWeights[hiddenIndex] = clampParameter(
      network.outputWeights[hiddenIndex] - rate * gradient * hiddenValue,
    );
    const hiddenGradient = gradient * previousOutputWeights[hiddenIndex] * (1 - hiddenValue * hiddenValue);
    network.hiddenBiases[hiddenIndex] = clampParameter(
      network.hiddenBiases[hiddenIndex] - rate * hiddenGradient,
    );
    for (let featureIndex = 0; featureIndex < network.featureKeys.length; featureIndex += 1) {
      network.inputWeights[hiddenIndex][featureIndex] = clampParameter(
        network.inputWeights[hiddenIndex][featureIndex]
          - rate * hiddenGradient * Number(forward.inputs[featureIndex] || 0),
      );
    }
  }
  return network;
}

export function alphaDenseNetworkParameterCount(network) {
  const normalized = normalizeAlphaDenseNetwork(network);
  if (!normalized) return 0;
  return normalized.hiddenSize * normalized.featureKeys.length
    + normalized.hiddenSize
    + normalized.hiddenSize
    + 1;
}

function deterministicParameter(seed, label, scale) {
  let hash = 2166136261;
  const text = `${seed}:${label}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (hash >>> 0) / 4294967295;
  return (unit * 2 - 1) * scale;
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

function uniqueStrings(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function finiteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampParameter(value) {
  return Math.min(MAX_PARAMETER, Math.max(-MAX_PARAMETER, Number(value || 0)));
}
