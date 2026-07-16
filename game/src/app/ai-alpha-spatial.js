import {
  createBoard,
  liveUnits,
  neighborsOf,
} from "../core/index.js";

export const ALPHA_SPATIAL_CONTRACT_SCHEMA = "zizi-el-alamein-alpha-spatial-contract-v1";
export const ALPHA_SPATIAL_STATE_SCHEMA = "zizi-el-alamein-alpha-spatial-state-v1";
export const ALPHA_SPATIAL_ACTION_SCHEMA = "zizi-el-alamein-alpha-spatial-action-v1";
export const ALPHA_SPATIAL_SPARSE_ACTION_SCHEMA = "zizi-el-alamein-alpha-spatial-sparse-action-v1";
export const ALPHA_SPATIAL_DATASET_SCHEMA = "zizi-el-alamein-alpha-spatial-dataset-v2";
export const ALPHA_SPATIAL_EXAMPLE_SCHEMA = "zizi-el-alamein-alpha-spatial-example-v2";

export const ALPHA_SPATIAL_STATE_CHANNELS = Object.freeze([
  "terrainDesert",
  "terrainHighland",
  "terrainSettlement",
  "terrainOther",
  "road",
  "britishPosition",
  "axisObjective",
  "alliedExit",
  "friendlyCombat",
  "enemyCombat",
  "friendlyMovement",
  "enemyMovement",
  "friendlyUnit",
  "enemyUnit",
  "friendlyDisrupted",
  "enemyDisrupted",
  "friendlySpent",
  "enemySpent",
  "friendlyZoc",
  "enemyZoc",
]);

export const ALPHA_SPATIAL_ACTION_CHANNELS = Object.freeze([
  "source",
  "target",
  "selectedUnit",
  "attacker",
  "defender",
]);

export const ALPHA_SPATIAL_GLOBAL_KEYS = Object.freeze([
  "axisPerspective",
  "alliedPerspective",
  "turnProgress",
  "movementPhase",
  "combatPhase",
  "retreatPending",
  "advancePending",
]);

export const ALPHA_SPATIAL_ACTION_GLOBAL_KEYS = Object.freeze([
  "move",
  "declareCombat",
  "finishDeclarations",
  "resolveCombat",
  "retreat",
  "advance",
  "skipAdvance",
  "endPhase",
  "routeSpent",
  "routeRemaining",
  "attackerCount",
]);

const CONTRACTS_BY_SCENARIO = new WeakMap();
const CONTRACTS_BY_BOARD = new WeakMap();
const POLICY_ONLY_OUTCOME_SOURCES = new Set([
  "guard_zero",
  "policy_only_guard",
  "policy_only_merged",
  "policy_only_unlabeled",
  "policy_only_unresolved",
  "unresolved",
]);

export function alphaSpatialFeatureContract(scenario, board = null) {
  if (!scenario || typeof scenario !== "object") throw new TypeError("Alpha spatial encoding requires scenario data");
  const cached = board ? CONTRACTS_BY_BOARD.get(board) : CONTRACTS_BY_SCENARIO.get(scenario);
  if (cached) return cached;
  const resolvedBoard = board || createBoard(scenario);
  const hexes = orderedBoardHexes(resolvedBoard);
  const indexById = new Map(hexes.map((hex, index) => [hex.id, index]));
  const axisObjectives = new Set([
    ...(scenario?.objectives?.alamHalfaRidge || []),
    ...(scenario?.objectives?.coastalRoadEast || []),
  ]);
  const alliedExit = new Set(scenario?.objectives?.alliedWestExitEdge || []);
  const topology = hexes.map((hex) => ({
    id: hex.id,
    col: Number(hex.col),
    row: Number(hex.row),
    terrain: String(hex.terrain || "unknown"),
    road: Boolean(hex.road),
    britishPosition: Boolean(hex.britishPosition),
    axisObjective: axisObjectives.has(hex.id),
    alliedExit: alliedExit.has(hex.id),
    neighbors: neighborsOf(resolvedBoard, hex.id)
      .map((hexId) => indexById.get(hexId))
      .filter(Number.isInteger)
      .sort((left, right) => left - right),
  }));
  const shape = {
    hexes: topology.length,
    stateChannels: ALPHA_SPATIAL_STATE_CHANNELS.length,
    actionChannels: ALPHA_SPATIAL_ACTION_CHANNELS.length,
    globalFeatures: ALPHA_SPATIAL_GLOBAL_KEYS.length,
    actionGlobalFeatures: ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.length,
  };
  const fingerprint = alphaSpatialContractFingerprint({
    schema: ALPHA_SPATIAL_CONTRACT_SCHEMA,
    stateChannels: ALPHA_SPATIAL_STATE_CHANNELS,
    actionChannels: ALPHA_SPATIAL_ACTION_CHANNELS,
    globalKeys: ALPHA_SPATIAL_GLOBAL_KEYS,
    actionGlobalKeys: ALPHA_SPATIAL_ACTION_GLOBAL_KEYS,
    topology,
  });
  const contract = {
    schema: ALPHA_SPATIAL_CONTRACT_SCHEMA,
    fingerprint,
    shape,
    stateChannels: ALPHA_SPATIAL_STATE_CHANNELS.slice(),
    actionChannels: ALPHA_SPATIAL_ACTION_CHANNELS.slice(),
    globalKeys: ALPHA_SPATIAL_GLOBAL_KEYS.slice(),
    actionGlobalKeys: ALPHA_SPATIAL_ACTION_GLOBAL_KEYS.slice(),
    topology,
  };
  if (!board) CONTRACTS_BY_SCENARIO.set(scenario, contract);
  CONTRACTS_BY_BOARD.set(resolvedBoard, contract);
  return contract;
}

export function alphaSpatialContractFingerprint(contract) {
  return `fnv1a32:${stableHash(stableValue({
    schema: contract?.schema,
    stateChannels: contract?.stateChannels,
    actionChannels: contract?.actionChannels,
    globalKeys: contract?.globalKeys,
    actionGlobalKeys: contract?.actionGlobalKeys,
    topology: contract?.topology,
  }))}`;
}

export function encodeAlphaSpatialState({ scenario, rules = null, board = null, state, side } = {}) {
  if (!state || typeof state !== "object") throw new TypeError("Alpha spatial state encoding requires game state");
  const perspective = normalizeSide(side);
  const resolvedBoard = board || createBoard(scenario);
  const contract = alphaSpatialFeatureContract(scenario, resolvedBoard);
  const indexById = new Map(contract.topology.map((hex, index) => [hex.id, index]));
  const planes = makePlanes(contract.stateChannels.length, contract.shape.hexes);
  const planeByName = namedPlanes(contract.stateChannels, planes);
  const axisObjectives = new Set([
    ...(scenario?.objectives?.alamHalfaRidge || []),
    ...(scenario?.objectives?.coastalRoadEast || []),
  ]);
  const alliedExit = new Set(scenario?.objectives?.alliedWestExitEdge || []);

  for (const [index, topologyHex] of contract.topology.entries()) {
    const hex = resolvedBoard.hexById.get(topologyHex.id);
    const terrainKey = terrainChannel(hex?.terrain);
    planeByName[terrainKey][index] = 1;
    planeByName.road[index] = hex?.road ? 1 : 0;
    planeByName.britishPosition[index] = hex?.britishPosition ? 1 : 0;
    planeByName.axisObjective[index] = axisObjectives.has(hex?.id) ? 1 : 0;
    planeByName.alliedExit[index] = alliedExit.has(hex?.id) ? 1 : 0;
  }

  const spent = new Set([
    ...(state.movedUnits || []),
    ...(state.usedAttackers || []),
    ...(state.usedDefenders || []),
  ]);
  for (const unit of liveUnits(state.units || [])) {
    const index = indexById.get(unit.hexId);
    if (!Number.isInteger(index)) continue;
    const relation = unit.side === perspective ? "friendly" : "enemy";
    planeByName[`${relation}Combat`][index] += clamp(Number(unit.combat || 0) / 12, 0, 1);
    planeByName[`${relation}Movement`][index] += clamp(Number(unit.movement || 0) / 12, 0, 1);
    planeByName[`${relation}Unit`][index] += 1;
    if (unit.disrupted) planeByName[`${relation}Disrupted`][index] = 1;
    if (spent.has(unit.id)) planeByName[`${relation}Spent`][index] = 1;
    for (const neighborId of neighborsOf(resolvedBoard, unit.hexId)) {
      const neighborIndex = indexById.get(neighborId);
      if (Number.isInteger(neighborIndex)) planeByName[`${relation}Zoc`][neighborIndex] = 1;
    }
  }

  const phase = rules?.phases?.[Number(state.phaseIndex || 0)] || null;
  const phaseType = phase?.type || "";
  const maxTurn = Math.max(1, Number(rules?.turns?.length || rules?.maxTurns || 4));
  const global = [
    perspective === "axis" ? 1 : 0,
    perspective === "allied" ? 1 : 0,
    clamp((Number(state.turn || 1) - 1) / Math.max(1, maxTurn - 1), 0, 1),
    phaseType === "movement" ? 1 : 0,
    phaseType === "combat" ? 1 : 0,
    state.retreatTask ? 1 : 0,
    state.advanceTask ? 1 : 0,
  ];
  return {
    schema: ALPHA_SPATIAL_STATE_SCHEMA,
    contractFingerprint: contract.fingerprint,
    side: perspective,
    turn: Number(state.turn || 1),
    phaseId: phase?.id || null,
    planes: planes.map(roundPlane),
    global: global.map((value) => round(value, 6)),
  };
}

export function encodeAlphaSpatialAction(action, { scenario, board = null, state } = {}) {
  const sparse = encodeAlphaSpatialActionSparse(action, { scenario, board, state });
  const contract = alphaSpatialFeatureContract(scenario, board || createBoard(scenario));
  const planes = makePlanes(contract.actionChannels.length, contract.shape.hexes);
  const planeByName = namedPlanes(contract.actionChannels, planes);
  for (const channel of contract.actionChannels) {
    for (const index of sparse.indexes[channel]) planeByName[channel][index] = 1;
  }
  return {
    schema: ALPHA_SPATIAL_ACTION_SCHEMA,
    contractFingerprint: contract.fingerprint,
    actionType: sparse.actionType,
    planes,
    global: sparse.global,
  };
}

export function encodeAlphaSpatialActionSparse(action, { scenario, board = null, state } = {}) {
  return encodeAlphaSpatialActionSparseWithContext(
    action,
    alphaSpatialActionEncodingContext({ scenario, board, state }),
  );
}

export function encodeAlphaSpatialActionsSparse(actions = [], { scenario, board = null, state } = {}) {
  if (!Array.isArray(actions)) throw new TypeError("Alpha spatial action batch must be an array");
  const context = alphaSpatialActionEncodingContext({ scenario, board, state });
  return actions.map((action) => encodeAlphaSpatialActionSparseWithContext(action, context));
}

function alphaSpatialActionEncodingContext({ scenario, board = null, state } = {}) {
  if (!state || typeof state !== "object") throw new TypeError("Alpha spatial action encoding requires game state");
  const resolvedBoard = board || createBoard(scenario);
  const contract = alphaSpatialFeatureContract(scenario, resolvedBoard);
  const indexById = new Map(contract.topology.map((hex, index) => [hex.id, index]));
  const unitById = new Map();
  for (const unit of state.units || []) {
    if (!unitById.has(unit.id)) unitById.set(unit.id, unit);
  }
  return { contract, indexById, state, unitById };
}

function encodeAlphaSpatialActionSparseWithContext(action, context) {
  const { contract, indexById, state, unitById } = context;
  const selectedUnit = action?.unitId ? unitById.get(action.unitId) || null : null;
  const defender = action?.defenderId ? unitById.get(action.defenderId) || null : null;
  const attackers = (action?.attackerIds || [])
    .map((unitId) => unitById.get(unitId) || null)
    .filter(Boolean);
  const sourceHexIds = new Set([
    action?.fromHexId,
    selectedUnit?.hexId,
    ...attackers.map((unit) => unit.hexId),
  ].filter(Boolean));
  const targetHexIds = new Set([
    action?.toHexId,
    action?.targetHexId,
    defender?.hexId,
  ].filter(Boolean));
  const indexes = {
    source: hexIndexes(sourceHexIds, indexById),
    target: hexIndexes(targetHexIds, indexById),
    selectedUnit: hexIndexes([selectedUnit?.hexId], indexById),
    attacker: hexIndexes(attackers.map((unit) => unit.hexId), indexById),
    defender: hexIndexes([defender?.hexId], indexById),
  };
  const type = action?.type || "";
  const global = [
    type === "MOVE_UNIT" ? 1 : 0,
    type === "DECLARE_COMBAT" ? 1 : 0,
    type === "FINISH_DECLARATIONS" ? 1 : 0,
    type === "RESOLVE_COMBAT" ? 1 : 0,
    type === "RETREAT_UNIT" ? 1 : 0,
    type === "ADVANCE_UNIT" ? 1 : 0,
    type === "SKIP_ADVANCE" ? 1 : 0,
    type === "END_PHASE" ? 1 : 0,
    clamp(Number(action?.route?.spent || 0) / 12, 0, 1),
    clamp(Number(action?.route?.remaining || 0) / 12, 0, 1),
    clamp(Number(action?.attackerIds?.length || 0) / 6, 0, 1),
  ];
  return {
    schema: ALPHA_SPATIAL_SPARSE_ACTION_SCHEMA,
    contractFingerprint: contract.fingerprint,
    actionType: type || null,
    indexes,
    global: global.map((value) => round(value, 6)),
  };
}

export function buildAlphaSpatialDataset(samples = [], options = {}) {
  const scenario = options.scenario;
  const rules = options.rules || null;
  const board = options.board || createBoard(scenario);
  const contract = alphaSpatialFeatureContract(scenario, board);
  const examples = [];
  const skipped = [];
  for (const [index, sample] of (samples || []).entries()) {
    const state = sample?.initialState || sample?.stateSnapshot || sample?.stateBefore || null;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      skipped.push({ index, stateHash: sample?.stateHash || null, reason: "missing_state_snapshot" });
      continue;
    }
    const stateEncoding = encodeAlphaSpatialState({
      scenario,
      rules,
      board,
      state,
      side: sample.side,
    });
    const valueTarget = spatialValueTarget(sample);
    examples.push({
      schema: ALPHA_SPATIAL_EXAMPLE_SCHEMA,
      stateHash: sample.stateHash || null,
      side: sample.side || null,
      turn: sample.turn ?? state.turn ?? null,
      phaseId: sample.phaseId || stateEncoding.phaseId,
      outcome: valueTarget.outcome,
      outcomeSource: valueTarget.outcomeSource,
      outcomeWeight: valueTarget.outcomeWeight,
      policyWeight: finiteOrDefault(sample.policyWeight, 1),
      trainingWeight: finiteOrDefault(sample.trainingWeight, 1),
      valueTrainingWeight: valueTarget.usable
        ? finiteOrDefault(sample.valueTrainingWeight, sample.trainingWeight ?? 1)
        : 0,
      policyTrainingWeight: finiteOrDefault(sample.policyTrainingWeight, sample.trainingWeight ?? 1),
      state: stateEncoding,
      policy: (sample.policy || []).map((entry) => ({
        action: entry.action,
        target: clamp(Number(entry.visitShare || 0), 0, 1),
        encoding: encodeAlphaSpatialAction(entry.action, { scenario, board, state }),
      })),
    });
  }
  return {
    schema: ALPHA_SPATIAL_DATASET_SCHEMA,
    generatedAt: options.generatedAt || new Date().toISOString(),
    source: options.source || null,
    contract,
    sampleCount: examples.length,
    policyRows: examples.reduce((sum, example) => sum + example.policy.length, 0),
    skippedCount: skipped.length,
    sides: countBy(examples, (example) => example.side),
    phases: countBy(examples, (example) => example.phaseId),
    examples,
    skipped,
  };
}

function spatialValueTarget(sample) {
  const source = typeof sample?.outcomeSource === "string" ? sample.outcomeSource : null;
  const rawOutcome = sample?.outcome;
  const hasOutcome = sample?.outcome !== null && sample?.outcome !== undefined && sample?.outcome !== "";
  const outcome = hasOutcome ? Number(rawOutcome) : Number.NaN;
  const rawWeight = Number(sample?.outcomeWeight ?? 1);
  const outcomeWeight = Number.isFinite(rawWeight) ? clamp(rawWeight, 0, 1) : 1;
  if (!source || POLICY_ONLY_OUTCOME_SOURCES.has(source)) {
    return {
      usable: false,
      outcome: null,
      outcomeSource: source || "policy_only_unlabeled",
      outcomeWeight: 0,
    };
  }
  if (
    source === "terminal_result"
    && (typeof rawOutcome !== "number" || !Number.isFinite(rawOutcome) || (rawOutcome !== -1 && rawOutcome !== 1))
  ) {
    return { usable: false, outcome: null, outcomeSource: source, outcomeWeight: 0 };
  }
  if (!Number.isFinite(outcome) || !(outcomeWeight > 0)) {
    return { usable: false, outcome: null, outcomeSource: source, outcomeWeight: 0 };
  }
  return { usable: true, outcome: clamp(outcome, -1, 1), outcomeSource: source, outcomeWeight };
}

export function validateAlphaSpatialEncoding(encoding, contract) {
  const expected = contract?.fingerprint;
  const channels = encoding?.schema === ALPHA_SPATIAL_STATE_SCHEMA
    ? contract?.stateChannels
    : encoding?.schema === ALPHA_SPATIAL_ACTION_SCHEMA
      ? contract?.actionChannels
      : null;
  const globalKeys = encoding?.schema === ALPHA_SPATIAL_STATE_SCHEMA
    ? contract?.globalKeys
    : encoding?.schema === ALPHA_SPATIAL_ACTION_SCHEMA
      ? contract?.actionGlobalKeys
      : null;
  if (!expected || encoding?.contractFingerprint !== expected) return { ok: false, reason: "spatial_contract_mismatch" };
  if (!Array.isArray(channels) || !Array.isArray(globalKeys)) return { ok: false, reason: "invalid_spatial_contract" };
  if (!Array.isArray(encoding.planes) || encoding.planes.length !== channels.length) {
    return { ok: false, reason: "spatial_channel_count_mismatch" };
  }
  const hexes = Number(contract?.shape?.hexes || 0);
  if (!encoding.planes.every((plane) => Array.isArray(plane) && plane.length === hexes && plane.every(Number.isFinite))) {
    return { ok: false, reason: "spatial_plane_shape_mismatch" };
  }
  if (!Array.isArray(encoding.global) || encoding.global.length !== globalKeys.length || !encoding.global.every(Number.isFinite)) {
    return { ok: false, reason: "spatial_global_shape_mismatch" };
  }
  return { ok: true, reason: null };
}

export function validateAlphaSpatialDataset(dataset, expectedContract = null) {
  if (!dataset || dataset.schema !== ALPHA_SPATIAL_DATASET_SCHEMA) {
    return { ok: false, reason: "invalid_spatial_dataset_schema" };
  }
  const contract = dataset.contract;
  if (!contract || contract.schema !== ALPHA_SPATIAL_CONTRACT_SCHEMA) {
    return { ok: false, reason: "invalid_spatial_contract" };
  }
  if (contract.fingerprint !== alphaSpatialContractFingerprint(contract)) {
    return { ok: false, reason: "spatial_contract_integrity_mismatch" };
  }
  if (expectedContract?.fingerprint && contract.fingerprint !== expectedContract.fingerprint) {
    return { ok: false, reason: "spatial_contract_mismatch" };
  }
  if (!Array.isArray(dataset.examples) || dataset.sampleCount !== dataset.examples.length) {
    return { ok: false, reason: "spatial_sample_count_mismatch" };
  }
  let policyRows = 0;
  for (const [sampleIndex, example] of dataset.examples.entries()) {
    if (example?.schema !== ALPHA_SPATIAL_EXAMPLE_SCHEMA) {
      return { ok: false, reason: "invalid_spatial_example_schema", sampleIndex, policyIndex: null };
    }
    const valueValidation = validateSpatialValueExample(example);
    if (!valueValidation.ok) return { ...valueValidation, sampleIndex, policyIndex: null };
    const stateValidation = validateAlphaSpatialEncoding(example?.state, contract);
    if (!stateValidation.ok) return { ...stateValidation, sampleIndex, policyIndex: null };
    if (!Array.isArray(example.policy)) {
      return { ok: false, reason: "invalid_spatial_policy", sampleIndex, policyIndex: null };
    }
    for (const [policyIndex, row] of example.policy.entries()) {
      policyRows += 1;
      const actionValidation = validateAlphaSpatialEncoding(row?.encoding, contract);
      if (!actionValidation.ok) return { ...actionValidation, sampleIndex, policyIndex };
      if (!Number.isFinite(Number(row?.target)) || Number(row.target) < 0 || Number(row.target) > 1) {
        return { ok: false, reason: "invalid_spatial_policy_target", sampleIndex, policyIndex };
      }
    }
  }
  if (policyRows !== Number(dataset.policyRows || 0)) {
    return { ok: false, reason: "spatial_policy_row_count_mismatch" };
  }
  return {
    ok: true,
    reason: null,
    sampleCount: dataset.examples.length,
    policyRows,
    contractFingerprint: contract.fingerprint,
  };
}

function validateSpatialValueExample(example) {
  const source = typeof example?.outcomeSource === "string" && example.outcomeSource
    ? example.outcomeSource
    : null;
  if (!source) return { ok: false, reason: "missing_spatial_outcome_source" };
  const outcomeWeight = Number(example.outcomeWeight);
  const valueTrainingWeight = Number(example.valueTrainingWeight);
  if (POLICY_ONLY_OUTCOME_SOURCES.has(source)) {
    if (example.outcome !== null || outcomeWeight !== 0 || valueTrainingWeight !== 0) {
      return { ok: false, reason: "invalid_spatial_policy_only_value" };
    }
    return { ok: true, reason: null };
  }
  if (example.outcome === null && outcomeWeight === 0 && valueTrainingWeight === 0) {
    return { ok: true, reason: null };
  }
  if (
    typeof example.outcome !== "number"
    || !Number.isFinite(example.outcome)
    || !Number.isFinite(outcomeWeight)
    || !Number.isFinite(valueTrainingWeight)
    || outcomeWeight < 0
    || valueTrainingWeight < 0
  ) {
    return { ok: false, reason: "invalid_spatial_value_target" };
  }
  if (source === "terminal_result" && example.outcome !== -1 && example.outcome !== 1) {
    return { ok: false, reason: "invalid_spatial_terminal_outcome" };
  }
  return { ok: true, reason: null };
}

function orderedBoardHexes(board) {
  return (board?.hexes || [])
    .slice()
    .sort((left, right) => (
      Number(left.row) - Number(right.row)
      || Number(left.col) - Number(right.col)
      || String(left.id).localeCompare(String(right.id))
    ));
}

function normalizeSide(side) {
  const next = String(side || "").toLowerCase();
  if (next !== "axis" && next !== "allied") throw new TypeError("Alpha spatial encoding side must be axis or allied");
  return next;
}

function terrainChannel(terrain) {
  if (terrain === "desert") return "terrainDesert";
  if (terrain === "highland") return "terrainHighland";
  if (terrain === "settlement") return "terrainSettlement";
  return "terrainOther";
}

function makePlanes(channelCount, hexCount) {
  return Array.from({ length: channelCount }, () => Array.from({ length: hexCount }, () => 0));
}

function namedPlanes(channelNames, planes) {
  return Object.fromEntries(channelNames.map((name, index) => [name, planes[index]]));
}

function hexIndexes(hexIds, indexById) {
  const indexes = new Set();
  for (const hexId of hexIds || []) {
    const index = indexById.get(hexId);
    if (Number.isInteger(index)) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

function roundPlane(plane) {
  return plane.map((value) => round(value, 6));
}

function countBy(items, select) {
  const counts = {};
  for (const item of items || []) {
    const key = select(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function finiteOrDefault(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(Number(value || 0) * scale) / scale;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}
