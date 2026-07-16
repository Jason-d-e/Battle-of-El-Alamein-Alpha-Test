import {
  activeSide,
  currentPhase,
  environmentContext,
  environmentMetrics,
  evaluateAlliedBreakthroughVictory,
  liveUnits,
  neighborsOf,
} from "../core/index.js";

const OPPOSITE_SIDE = Object.freeze({ axis: "allied", allied: "axis" });
const LOCAL_FORCE_RADIUS = 3;
const DISTANCE_FIELDS_BY_BOARD = new WeakMap();
const EMPTY_DISTANCE_FIELD = new Map();

export const DEFAULT_SITUATION_WEIGHTS = Object.freeze({
  materialBalance: 0.35,
  unitBalance: 0.1,
  axisObjectiveHeld: 0.55,
  axisObjectiveProgress: 0.28,
  axisObjectivePressure: 0.18,
  axisObjectiveLocalAdvantage: 0.18,
  alliedExitPressure: 0.32,
  alliedExitLocalAdvantage: 0.22,
  alliedBreakthroughReady: 0.52,
  axisDeadlineRisk: 0.35,
  friendlyCohesion: 0.08,
  enemyCohesion: -0.08,
  friendlyThreats: 0.12,
  enemyThreats: -0.12,
});

export function analyzeSituation(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const enemy = OPPOSITE_SIDE[side] || null;
  const metrics = environmentMetrics(environment);
  const context = environmentContext(environment);
  const live = liveUnits(environment.state.units);
  const friendly = live.filter((unit) => unit.side === side);
  const enemies = enemy ? live.filter((unit) => unit.side === enemy) : [];
  const axisUnits = live.filter((unit) => unit.side === "axis");
  const alliedUnits = live.filter((unit) => unit.side === "allied");
  const objectiveHexes = axisObjectiveHexes(environment);
  const exitHexes = environment.scenario?.objectives?.alliedWestExitEdge || [];
  const axisObjectiveDistance = nearestUnitDistance(environment, axisUnits, objectiveHexes);
  const alliedExitDistance = nearestUnitDistance(environment, alliedUnits, exitHexes);
  const axisObjectiveLocalAdvantage = localForceAdvantage(environment, axisUnits, alliedUnits, objectiveHexes);
  const alliedExitLocalAdvantage = localForceAdvantage(environment, alliedUnits, axisUnits, exitHexes);
  const objectiveStatus = metrics.objectiveStatus || {};
  const alliedBreakthroughReady = Number(Boolean(
    evaluateAlliedBreakthroughVictory(context, environment.state.movedUnits || []),
  ));
  const axisObjectiveHeld = Number(Boolean(
    objectiveStatus.ridgeOccupied
    || objectiveStatus.roadOccupied
    || objectiveStatus.ridgeControl
    || objectiveStatus.roadCut
  ));
  const totalTurns = Math.max(1, Number(environment.rules?.turns?.length || 1));
  const turnProgress = totalTurns > 1
    ? clamp((Number(environment.state.turn || 1) - 1) / (totalTurns - 1), 0, 1)
    : 1;
  const axisDeadlineRisk = turnProgress * (1 - axisObjectiveHeld);
  const material = metrics.combatStrength || { axis: 0, allied: 0 };
  const friendlyStrength = Number(material[side] || 0);
  const enemyStrength = enemy ? Number(material[enemy] || 0) : 0;
  const friendlyThreats = adjacentThreatCount(environment, friendly, enemies);
  const enemyThreats = adjacentThreatCount(environment, enemies, friendly);
  const friendlyCohesion = cohesionScore(environment, friendly);
  const enemyCohesion = cohesionScore(environment, enemies);

  return {
    side,
    enemy,
    turn: Number(environment.state.turn || 1),
    phaseId: currentPhase(environment)?.id || null,
    phaseType: currentPhase(environment)?.type || null,
    activeSide: activeSide(environment),
    winner: environment.state.winner ? { ...environment.state.winner } : null,
    objectiveStatus,
    objectiveHexes,
    exitHexes,
    features: {
      materialBalance: friendlyStrength - enemyStrength,
      unitBalance: friendly.length - enemies.length,
      axisObjectiveHeld,
      axisObjectiveDistance: finiteOrCap(axisObjectiveDistance, 24),
      axisObjectiveProgress: objectiveProgress(axisObjectiveDistance),
      axisObjectivePressure: objectivePressure(axisObjectiveDistance),
      axisObjectiveLocalAdvantage,
      alliedExitDistance: finiteOrCap(alliedExitDistance, 24),
      alliedExitPressure: objectivePressure(alliedExitDistance),
      alliedExitLocalAdvantage,
      alliedBreakthroughReady,
      turnProgress,
      axisDeadlineRisk,
      friendlyCohesion,
      enemyCohesion,
      friendlyThreats,
      enemyThreats,
    },
    metrics,
    context,
  };
}

export function evaluateSituation(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const winner = environment.state?.winner;
  if (winner?.side === side) return 1;
  if (winner && winner.side !== side) return -1;

  const analysis = options.analysis || analyzeSituation(environment, { side });
  const weights = {
    ...DEFAULT_SITUATION_WEIGHTS,
    ...(options.weights || {}),
  };
  const features = normalizedSituationFeatures(analysis);
  return Math.tanh(scoreNormalizedSituation(features, side, weights));
}

export function normalizedSituationFeatures(analysis) {
  const features = analysis?.features || {};
  const metrics = analysis?.metrics || {};
  const side = analysis?.side;
  const enemy = analysis?.enemy;
  const friendlyUnits = Math.max(0, finiteNumber(metrics.unitCount?.[side], 0));
  const enemyUnits = Math.max(0, finiteNumber(metrics.unitCount?.[enemy], 0));
  const friendlyStrength = Math.max(0, finiteNumber(metrics.combatStrength?.[side], 0));
  const enemyStrength = Math.max(0, finiteNumber(metrics.combatStrength?.[enemy], 0));
  return {
    materialBalance: safeRatio(features.materialBalance, friendlyStrength + enemyStrength),
    unitBalance: safeRatio(features.unitBalance, friendlyUnits + enemyUnits),
    axisObjectiveHeld: clamp(finiteNumber(features.axisObjectiveHeld, 0), 0, 1),
    axisObjectiveProgress: clamp(safeRatio(features.axisObjectiveProgress, 18), 0, 1),
    axisObjectivePressure: clamp(safeRatio(features.axisObjectivePressure, 8), 0, 1),
    axisObjectiveLocalAdvantage: Math.tanh(finiteNumber(features.axisObjectiveLocalAdvantage, 0) / 10),
    alliedExitPressure: clamp(safeRatio(features.alliedExitPressure, 8), 0, 1),
    alliedExitLocalAdvantage: Math.tanh(finiteNumber(features.alliedExitLocalAdvantage, 0) / 10),
    alliedBreakthroughReady: clamp(finiteNumber(features.alliedBreakthroughReady, 0), 0, 1),
    turnProgress: clamp(finiteNumber(features.turnProgress, 0), 0, 1),
    axisDeadlineRisk: clamp(finiteNumber(features.axisDeadlineRisk, 0), 0, 1),
    friendlyCohesion: normalizedCohesion(features.friendlyCohesion, friendlyUnits),
    enemyCohesion: normalizedCohesion(features.enemyCohesion, enemyUnits),
    friendlyThreats: clamp(safeRatio(features.friendlyThreats, friendlyUnits), 0, 1),
    enemyThreats: clamp(safeRatio(features.enemyThreats, enemyUnits), 0, 1),
  };
}

export function summarizeSituationAwareness(analysis = null, options = {}) {
  if (!analysis || typeof analysis !== "object") return null;
  const features = analysis.features || {};
  const signalLimit = Math.max(1, Number(options.signalLimit || 6));
  const score = situationAwarenessScore(analysis, {
    rootValue: options.rootValue,
  });
  return {
    schema: "zizi-el-alamein-situation-awareness-v1",
    side: analysis.side || null,
    activeSide: analysis.activeSide || null,
    turn: finiteOrNull(analysis.turn),
    phaseId: analysis.phaseId || null,
    phaseType: analysis.phaseType || null,
    posture: situationPosture(score, analysis.winner, analysis.side),
    score,
    objective: {
      axis: {
        held: Boolean(features.axisObjectiveHeld),
        distance: finiteOrNull(features.axisObjectiveDistance),
        pressure: finiteNumber(features.axisObjectivePressure, 0),
        localAdvantage: finiteNumber(features.axisObjectiveLocalAdvantage, 0),
        level: pressureLevel(features.axisObjectivePressure),
      },
      alliedExit: {
        distance: finiteOrNull(features.alliedExitDistance),
        pressure: finiteNumber(features.alliedExitPressure, 0),
        localAdvantage: finiteNumber(features.alliedExitLocalAdvantage, 0),
        breakthroughReady: Boolean(features.alliedBreakthroughReady),
        level: pressureLevel(features.alliedExitPressure),
      },
    },
    force: {
      materialBalance: finiteNumber(features.materialBalance, 0),
      unitBalance: finiteNumber(features.unitBalance, 0),
    },
    threat: {
      friendly: finiteNumber(features.friendlyThreats, 0),
      enemy: finiteNumber(features.enemyThreats, 0),
      balance: round(finiteNumber(features.friendlyThreats, 0) - finiteNumber(features.enemyThreats, 0)),
      level: threatLevel(features.enemyThreats, features.friendlyThreats),
    },
    cohesion: {
      friendly: finiteNumber(features.friendlyCohesion, 0),
      enemy: finiteNumber(features.enemyCohesion, 0),
      balance: round(finiteNumber(features.friendlyCohesion, 0) - finiteNumber(features.enemyCohesion, 0)),
    },
    signals: situationAwarenessSignals(features, analysis.side)
      .slice(0, signalLimit),
  };
}

export function axisObjectiveHexes(environment) {
  const objectives = environment.scenario?.objectives || {};
  return [
    ...(objectives.alamHalfaRidge || []),
    ...(objectives.coastalRoadEast || []),
  ];
}

export function nearestDistanceToAny(environment, fromHexId, targets) {
  if (!fromHexId || !targets?.length) return Infinity;
  return distanceFieldForTargets(environment.board, targets).get(fromHexId) ?? Infinity;
}

function nearestUnitDistance(environment, units, targets) {
  if (!units.length || !targets?.length) return Infinity;
  return Math.min(...units.map((unit) => nearestDistanceToAny(environment, unit.hexId, targets)));
}

function objectiveProgress(distance) {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, 18 - distance);
}

function objectivePressure(distance) {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, 8 - distance);
}

function cohesionScore(environment, units) {
  let score = 0;
  for (let outer = 0; outer < units.length; outer += 1) {
    for (let inner = outer + 1; inner < units.length; inner += 1) {
      const distance = distanceBetween(environment.board, units[outer].hexId, units[inner].hexId);
      if (distance === 2) score += 2;
      else if (distance === 3) score += 1;
      else if (distance === 1) score -= 0.5;
    }
  }
  return score;
}

function adjacentThreatCount(environment, attackers, defenders) {
  let count = 0;
  for (const attacker of attackers) {
    for (const defender of defenders) {
      if (distanceBetween(environment.board, attacker.hexId, defender.hexId) === 1) {
        count += Number(attacker.combat || 0);
      }
    }
  }
  return count;
}

function distanceBetween(board, fromHexId, toHexId) {
  if (!fromHexId || !toHexId) return Infinity;
  return distanceFieldForTargets(board, [toHexId]).get(fromHexId) ?? Infinity;
}

function distanceFieldForTargets(board, targets) {
  if (!board || typeof board !== "object") return EMPTY_DISTANCE_FIELD;
  const targetIds = [...new Set((targets || []).filter((hexId) => board.hexById?.has(hexId)))].sort();
  if (!targetIds.length) return EMPTY_DISTANCE_FIELD;

  let boardFields = DISTANCE_FIELDS_BY_BOARD.get(board);
  if (!boardFields) {
    boardFields = new Map();
    DISTANCE_FIELDS_BY_BOARD.set(board, boardFields);
  }
  const key = targetIds.join("\u0000");
  const cached = boardFields.get(key);
  if (cached) return cached;

  const distances = new Map(targetIds.map((hexId) => [hexId, 0]));
  const queue = targetIds.slice();
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const nextDistance = distances.get(current) + 1;
    for (const neighbor of neighborsOf(board, current)) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  boardFields.set(key, distances);
  return distances;
}

function localForceAdvantage(environment, friendly, enemies, targets) {
  if (!targets?.length) return 0;
  return localForceMass(environment, friendly, targets) - localForceMass(environment, enemies, targets);
}

function localForceMass(environment, units, targets) {
  let mass = 0;
  for (const unit of units || []) {
    const distance = nearestDistanceToAny(environment, unit.hexId, targets);
    if (distance <= LOCAL_FORCE_RADIUS) {
      const proximity = (LOCAL_FORCE_RADIUS + 1 - distance) / (LOCAL_FORCE_RADIUS + 1);
      mass += Number(unit.combat ?? unit.attack ?? 0) * proximity;
    }
  }
  return round(mass, 4);
}

function situationAwarenessScore(analysis, options = {}) {
  if (Number.isFinite(options.rootValue)) return round(clamp(options.rootValue, -1, 1));
  if (analysis.winner?.side && analysis.side) {
    return analysis.winner.side === analysis.side ? 1 : -1;
  }
  return round(Math.tanh(scoreNormalizedSituation(
    normalizedSituationFeatures(analysis),
    analysis.side,
    DEFAULT_SITUATION_WEIGHTS,
  )));
}

function situationPosture(score, winner, side) {
  if (winner?.side && side) return winner.side === side ? "won" : "lost";
  if (score >= 0.35) return "advantage";
  if (score <= -0.35) return "danger";
  if (score >= 0.12) return "initiative";
  if (score <= -0.12) return "under_pressure";
  return "contested";
}

function situationAwarenessSignals(features, side) {
  const signals = [
    awarenessSignal("materialBalance", features.materialBalance, 1),
    awarenessSignal("unitBalance", features.unitBalance, 1),
    awarenessSignal("friendlyThreats", features.friendlyThreats, 1),
    awarenessSignal("enemyThreats", features.enemyThreats, -1),
    awarenessSignal("friendlyCohesion", features.friendlyCohesion, 1),
    awarenessSignal("enemyCohesion", features.enemyCohesion, -1),
    awarenessSignal("axisObjectiveHeld", features.axisObjectiveHeld, side === "axis" ? 1 : -1),
    awarenessSignal("axisObjectivePressure", features.axisObjectivePressure, side === "axis" ? 1 : -1),
    awarenessSignal("axisObjectiveLocalAdvantage", features.axisObjectiveLocalAdvantage, side === "axis" ? 1 : -1),
    awarenessSignal("alliedExitPressure", features.alliedExitPressure, side === "allied" ? 1 : -1),
    awarenessSignal("alliedExitLocalAdvantage", features.alliedExitLocalAdvantage, side === "allied" ? 1 : -1),
    awarenessSignal("alliedBreakthroughReady", features.alliedBreakthroughReady, side === "allied" ? 1 : -1),
    awarenessSignal("axisDeadlineRisk", features.axisDeadlineRisk, side === "allied" ? 1 : -1),
  ].filter(Boolean);
  return signals.sort((left, right) => (
    right.magnitude - left.magnitude
    || Math.abs(right.value) - Math.abs(left.value)
    || left.key.localeCompare(right.key)
  ));
}

function awarenessSignal(key, value, polarity) {
  if (!Number.isFinite(value) || value === 0) return null;
  const signed = value * polarity;
  return {
    key,
    value: round(value),
    polarity: signed >= 0 ? "positive" : "negative",
    magnitude: round(Math.abs(signed)),
  };
}

function pressureLevel(value) {
  const pressure = finiteNumber(value, 0);
  if (pressure >= 6) return "high";
  if (pressure >= 3) return "medium";
  if (pressure > 0) return "low";
  return "none";
}

function threatLevel(enemyThreats, friendlyThreats) {
  const balance = finiteNumber(enemyThreats, 0) - finiteNumber(friendlyThreats, 0);
  if (balance >= 6) return "high";
  if (balance >= 3) return "medium";
  if (balance > 0) return "low";
  return "contained";
}

function finiteOrCap(value, cap) {
  return Number.isFinite(value) ? Math.min(cap, value) : cap;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedCohesion(value, unitCount) {
  const maximum = unitCount > 1 ? unitCount * (unitCount - 1) : 1;
  return clamp(safeRatio(value, maximum), -1, 1);
}

function scoreNormalizedSituation(features, side, weights) {
  let score = 0;
  score += features.materialBalance * weights.materialBalance;
  score += features.unitBalance * weights.unitBalance;
  score += features.friendlyCohesion * weights.friendlyCohesion;
  score += features.enemyCohesion * weights.enemyCohesion;
  score += features.friendlyThreats * weights.friendlyThreats;
  score += features.enemyThreats * weights.enemyThreats;
  const axisPolarity = side === "axis" ? 1 : -1;
  score += axisPolarity * features.axisObjectiveHeld * weights.axisObjectiveHeld;
  score += axisPolarity * features.axisObjectiveProgress * weights.axisObjectiveProgress;
  score += axisPolarity * features.axisObjectivePressure * weights.axisObjectivePressure;
  score += axisPolarity * features.axisObjectiveLocalAdvantage * weights.axisObjectiveLocalAdvantage;
  score -= axisPolarity * features.alliedExitPressure * weights.alliedExitPressure;
  score -= axisPolarity * features.alliedExitLocalAdvantage * weights.alliedExitLocalAdvantage;
  score -= axisPolarity * features.alliedBreakthroughReady * weights.alliedBreakthroughReady;
  score -= axisPolarity * features.axisDeadlineRisk * weights.axisDeadlineRisk;
  return score;
}

function safeRatio(value, denominator) {
  const divisor = Number(denominator);
  if (!(divisor > 0)) return 0;
  return finiteNumber(value, 0) / divisor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
