export const CANONICAL_TRAJECTORY_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

export function isCanonicalTrajectoryId(value) {
  return typeof value === "string" && CANONICAL_TRAJECTORY_ID_PATTERN.test(value);
}

export function assertCanonicalTrajectoryId(value, label = "trajectoryId") {
  if (!isCanonicalTrajectoryId(value)) {
    fail(
      "INVALID_TRAJECTORY_ID",
      `${label} must match ${CANONICAL_TRAJECTORY_ID_PATTERN}`,
    );
  }
  return value;
}

export function normalizeTrajectoryIds(trajectoryIds, options = {}) {
  const { required = false, label = "trajectoryIds" } = options;

  if (trajectoryIds == null) {
    if (required) {
      fail("MISSING_TRAJECTORY_IDS", `${label} is required`);
    }
    return [];
  }
  if (!Array.isArray(trajectoryIds)) {
    fail("INVALID_TRAJECTORY_IDS", `${label} must be an array`);
  }
  if (required && trajectoryIds.length === 0) {
    fail("MISSING_TRAJECTORY_IDS", `${label} must contain at least one trajectory ID`);
  }

  const uniqueIds = new Set();
  for (let index = 0; index < trajectoryIds.length; index += 1) {
    uniqueIds.add(assertCanonicalTrajectoryId(trajectoryIds[index], `${label}[${index}]`));
  }
  return [...uniqueIds].sort(compareStrings);
}

export function unionTrajectoryIds(...trajectoryIdArrays) {
  const union = new Set();
  for (let index = 0; index < trajectoryIdArrays.length; index += 1) {
    const normalized = normalizeTrajectoryIds(trajectoryIdArrays[index], {
      label: `trajectoryIdArrays[${index}]`,
    });
    for (const trajectoryId of normalized) union.add(trajectoryId);
  }
  return [...union].sort(compareStrings);
}

function defaultGetTrajectoryIds(sample) {
  return sample?.trajectoryIds;
}

export function buildTrajectoryLineageComponents(samples, options = {}) {
  if (!Array.isArray(samples)) {
    fail("INVALID_TRAJECTORY_SAMPLES", "samples must be an array");
  }

  const {
    getTrajectoryIds = defaultGetTrajectoryIds,
  } = options;
  if (typeof getTrajectoryIds !== "function") {
    fail("INVALID_TRAJECTORY_ID_READER", "getTrajectoryIds must be a function");
  }

  const trajectoryIdsByIndex = samples.map((sample, index) => normalizeTrajectoryIds(
    getTrajectoryIds(sample, index),
    { required: true, label: `samples[${index}].trajectoryIds` },
  ));
  const parents = samples.map((_, index) => index);

  function find(index) {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  }

  function unite(left, right) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  }

  const ownerByTrajectoryId = new Map();
  for (let sampleIndex = 0; sampleIndex < trajectoryIdsByIndex.length; sampleIndex += 1) {
    for (const trajectoryId of trajectoryIdsByIndex[sampleIndex]) {
      const owner = ownerByTrajectoryId.get(trajectoryId);
      if (owner === undefined) {
        ownerByTrajectoryId.set(trajectoryId, sampleIndex);
      } else {
        unite(sampleIndex, owner);
      }
    }
  }

  const indexesByRoot = new Map();
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const root = find(sampleIndex);
    const indexes = indexesByRoot.get(root) ?? [];
    indexes.push(sampleIndex);
    indexesByRoot.set(root, indexes);
  }

  const components = [];
  for (const sampleIndexes of indexesByRoot.values()) {
    const trajectoryIds = unionTrajectoryIds(
      ...sampleIndexes.map((sampleIndex) => trajectoryIdsByIndex[sampleIndex]),
    );
    const frozenIndexes = Object.freeze([...sampleIndexes]);
    const component = Object.freeze({
      key: trajectoryIds.join("|"),
      trajectoryIds: Object.freeze(trajectoryIds),
      sampleIndexes: frozenIndexes,
      samples: Object.freeze(frozenIndexes.map((index) => samples[index])),
      sampleCount: frozenIndexes.length,
    });
    components.push(component);
  }

  components.sort((left, right) => compareStrings(left.key, right.key));
  return Object.freeze(components);
}
