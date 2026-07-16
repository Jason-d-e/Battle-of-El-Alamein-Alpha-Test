import {
  ENV_ACTION,
  activeSide,
  applyEnvironmentAction,
  generateLegalActions,
  getReachableHexes,
  hexDistance,
  isAlliedBreakthroughMove,
  liveUnits,
  movementAllowance,
  neighborsOf,
  unitById,
} from "../core/index.js";
import { combatEliminationProfile } from "./ai-tactics.js";

const DEFAULT_BEAM_WIDTH = 20;
const DEFAULT_CANDIDATE_LIMIT = 36;
const DEFAULT_MAX_ACTIONS = 12;
const DEFAULT_NODE_LIMIT = 180;
const DEFAULT_TIME_BUDGET_MS = 60;
const DEFAULT_MIN_NODES = 8;
const DEFAULT_MIN_ACTIVE_BEAMS = 4;
const DEFAULT_PROJECTION_WEIGHT = 0.12;
const DEFAULT_PROJECTION_CANDIDATE_LIMIT = 18;
const AXIS_CRITICAL_SCREEN_PENALTY = 2800;
const AXIS_SCREEN_EXPOSURE_PENALTY = 1400;

export const DEFAULT_PHASE_SEARCH_WEIGHTS = Object.freeze({
  axisProgress: 220,
  axisMobileFactor: 0.25,
  axisCombatFactor: 0.18,
  axisObjective: 2600,
  axisObjectiveSupport: 30,
  axisObjectiveCounterThreat: -60,
  axisObjectiveUnsupportedPenalty: -360,
  axisAdjacent: 420,
  axisNear: 160,
  axisReserve: 8,
  axisStateObjectiveHeld: 2400,
  axisStateObjectiveDistance: -42,
  axisStateExitDenial: 260,
  axisStateExitRedundancy: 320,
  axisStateBreakthroughThreat: -1800,
  axisStateFutureBreakthroughThreat: -900,
  axisStateExitThreatCoverage: 420,
  axisExitDenialGain: 520,
  axisExitRedundancyGain: 780,
  axisExitThreatCoverageGain: 1350,
  axisThreatRouteInterdictionGain: 1100,
  axisActualBreakthroughThreatReduction: 9000,
  axisCrisisMobilityCost: -800,
  axisExitScreen: 240,
  alliedForwardBand: 540,
  alliedForwardBandPenalty: -52,
  alliedObjectiveHugPenalty: -320,
  alliedContact: 260,
  alliedContactPenalty: -38,
  alliedLine: 95,
  alliedDrift: -42,
  alliedCombat: 18,
  alliedStateAxisDistance: 34,
  alliedStateWallLink: 38,
});

export function beamSearchMovementPhase(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const beamWidth = Number(options.beamWidth || DEFAULT_BEAM_WIDTH);
  const candidateLimit = Number(options.candidateLimit || DEFAULT_CANDIDATE_LIMIT);
  const maxActions = Number(options.maxActions || DEFAULT_MAX_ACTIONS);
  const nodeLimit = Number(options.nodeLimit || DEFAULT_NODE_LIMIT);
  const timeBudgetMs = Number(options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const minNodes = Number(options.minNodes ?? DEFAULT_MIN_NODES);
  const minActiveBeams = Math.max(1, Number(options.minActiveBeams ?? DEFAULT_MIN_ACTIVE_BEAMS));
  const scoreAction = options.scoreAction || defaultMovementActionScore;
  const scoreState = options.scoreState || defaultMovementStateScore;
  const weights = mergePhaseSearchWeights(options.weights);
  const projectPhaseEnd = options.projectPhaseEnd !== false;
  const projectionWeight = Number(options.projectionWeight ?? DEFAULT_PROJECTION_WEIGHT);
  const projectionCandidateLimit = Number(options.projectionCandidateLimit || DEFAULT_PROJECTION_CANDIDATE_LIMIT);
  const projectionBeamLimit = Number(options.projectionBeamLimit || beamWidth);
  const distanceCache = options.distanceCache || new Map();
  const startedAt = Date.now();
  let searchedNodes = 0;

  const overBudget = () => (
    searchedNodes >= nodeLimit
    || (searchedNodes >= minNodes && timeBudgetMs > 0 && Date.now() - startedAt >= timeBudgetMs)
  );

  let beams = [{
    environment,
    actions: [],
    score: scoreState(environment, { side, distanceCache, weights }),
    ended: false,
  }];

  for (let depth = 0; depth < maxActions; depth += 1) {
    const nextBeams = [];
    for (const beam of beams) {
      if (beam.ended || overBudget()) {
        nextBeams.push(beam);
        continue;
      }
      const moveCandidates = rankedMovementCandidates(
        beam.environment,
        side,
        candidateLimit,
        distanceCache,
        weights,
      );

      if (!moveCandidates.length) {
        nextBeams.push({ ...beam, ended: true });
        continue;
      }

      for (const candidate of moveCandidates) {
        const action = candidate.action;
        if (overBudget()) break;
        const applied = applyEnvironmentAction(beam.environment, action, {
          enrichEvents: false,
          previousState: false,
          cloneResultState: false,
        });
        searchedNodes += 1;
        if (!applied.ok) continue;
        const actionScore = scoreAction(beam.environment, action, applied, {
          side,
          depth,
          distanceCache,
          weights,
          candidateScoreBonus: candidate.tacticalBonus || 0,
        });
        const stateScore = scoreState(applied.environment, { side, depth: depth + 1, distanceCache, weights });
        nextBeams.push({
          environment: applied.environment,
          actions: beam.actions.concat(applied.action),
          score: beam.score + actionScore + stateScore * 0.08,
          ended: Boolean(applied.state.winner),
          searchedNodes,
        });
      }

      nextBeams.push({
        ...beam,
        score: beam.score + scoreState(beam.environment, { side, depth, stopped: true, distanceCache, weights }) * 0.04,
        ended: true,
      });
    }

    beams = selectPhaseBeams(nextBeams, beamWidth, minActiveBeams);

    if (beams.every((beam) => beam.ended)) break;
  }

  if (projectPhaseEnd) {
    beams = beams.slice(0, projectionBeamLimit).map((beam) => {
      const projection = phaseEndProjectionScore(beam.environment, {
        side,
        distanceCache,
        weights,
        candidateLimit: projectionCandidateLimit,
      });
      return {
        ...beam,
        projection,
        forcedLoss: forcedLossProjection(projection),
        projectedScore: beam.score + projection.score * projectionWeight,
      };
    }).sort((a, b) => (
      Number(a.forcedLoss) - Number(b.forcedLoss)
      || (b.projectedScore ?? b.score) - (a.projectedScore ?? a.score)
      || a.actions.length - b.actions.length
    ));
  }

  let best = beams[0] || null;
  if (best && side === "axis" && options.completeAxisDefense !== false) {
    const completed = completeAxisDefensePlan(best, {
      candidateLimit,
      maxActions,
      distanceCache,
      weights,
      scoreAction,
      scoreState,
    });
    if (completed.actions.length > best.actions.length) {
      const projection = projectPhaseEnd
        ? phaseEndProjectionScore(completed.environment, {
          side,
          distanceCache,
          weights,
          candidateLimit: projectionCandidateLimit,
        })
        : null;
      best = {
        ...completed,
        ...(projection ? {
          projection,
          forcedLoss: forcedLossProjection(projection),
          projectedScore: completed.score + projection.score * projectionWeight,
        } : {}),
      };
    }
  }
  return best;
}

function completeAxisDefensePlan(beam, options) {
  let current = beam;
  let risk = axisDefenseRisk(current.environment, options.distanceCache);
  let stalledActions = 0;
  let completionNodes = 0;
  while (
    risk.metric > 0
    && current.actions.length < options.maxActions
    && stalledActions < 8
  ) {
    const candidates = rankedMovementCandidates(
      current.environment,
      "axis",
      options.candidateLimit,
      options.distanceCache,
      options.weights,
    ).slice(0, 8);
    let best = null;
    for (const candidate of candidates) {
      const applied = applyEnvironmentAction(current.environment, candidate.action, quietApplyOptions());
      completionNodes += 1;
      if (!applied.ok) continue;
      const nextRisk = axisDefenseRisk(applied.environment, options.distanceCache);
      const actionScore = options.scoreAction(current.environment, candidate.action, applied, {
        side: "axis",
        depth: current.actions.length,
        distanceCache: options.distanceCache,
        weights: options.weights,
        candidateScoreBonus: candidate.tacticalBonus || 0,
      });
      if (
        !best
        || nextRisk.metric < best.risk.metric
        || (nextRisk.metric === best.risk.metric && actionScore > best.actionScore)
      ) {
        best = { applied, risk: nextRisk, actionScore };
      }
    }
    if (!best) break;
    const improved = best.risk.metric < risk.metric;
    const stateScore = options.scoreState(best.applied.environment, {
      side: "axis",
      depth: current.actions.length + 1,
      distanceCache: options.distanceCache,
      weights: options.weights,
    });
    current = {
      ...current,
      environment: best.applied.environment,
      actions: current.actions.concat(best.applied.action),
      score: current.score + best.actionScore + stateScore * 0.08,
      ended: Boolean(best.applied.state.winner),
      completionNodes,
      searchedNodes: Number(current.searchedNodes || 0) + 1,
    };
    risk = best.risk;
    stalledActions = improved ? 0 : stalledActions + 1;
  }
  return current;
}

function axisDefenseRisk(environment, cache) {
  const threats = alliedBreakthroughThreatCount(environment, cache);
  const futureThreats = threats > 0 ? 0 : alliedFutureBreakthroughThreatCount(environment, cache);
  const fragility = threats > 0 || futureThreats > 0
    ? { criticalUnits: 0, exposure: 0 }
    : axisBreakthroughScreenFragility(environment, cache);
  return {
    threats,
    futureThreats,
    fragility,
    metric: threats * 100000 + futureThreats * 1000 + screenFragilityMetric(fragility),
  };
}

function rankedMovementCandidates(environment, side, candidateLimit, distanceCache, weights) {
  const candidates = generateLegalActions(environment, { includeChanceActions: false })
    .filter((action) => action.type === ENV_ACTION.MOVE_UNIT)
    .map((action) => ({
      action,
      score: quickMoveActionScore(environment, action, side, distanceCache, weights),
    }));
  const immediateThreats = side === "axis"
    ? alliedBreakthroughThreatCount(environment, distanceCache)
    : 0;
  const futureThreats = side === "axis" && immediateThreats === 0
    ? alliedFutureBreakthroughThreatCount(environment, distanceCache)
    : 0;
  const screenFragility = side === "axis" && immediateThreats === 0 && futureThreats === 0
    ? axisBreakthroughScreenFragility(environment, distanceCache)
    : null;
  if (immediateThreats > 0) {
    prioritizeExactBreakthroughResponses(environment, candidates, candidateLimit, distanceCache);
  } else if (futureThreats > 0) {
    prioritizeExactBreakthroughResponses(
      environment,
      candidates,
      candidateLimit,
      distanceCache,
      alliedFutureBreakthroughThreatCount,
      4500,
    );
  } else if (screenFragility?.criticalUnits > 0) {
    prioritizeExactScreenReinforcements(environment, candidates, screenFragility, distanceCache);
  }
  const effectiveLimit = immediateThreats > 0 || futureThreats > 0 || screenFragility?.criticalUnits > 0
    ? Math.min(candidateLimit, 8)
    : candidateLimit;
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, effectiveLimit);
}

function prioritizeExactScreenReinforcements(environment, candidates, currentFragility, distanceCache) {
  const exits = alliedExitHexes(environment);
  const criticalUnits = (currentFragility.units || [])
    .map((unitId) => unitById(environment.state.units, unitId))
    .filter(Boolean);
  const bestByCriticalScreen = new Map();
  const bestByUnit = new Map();
  const bestByDestination = new Map();
  for (const candidate of candidates) {
    if (nearestDistance(environment, candidate.action.toHexId, exits, distanceCache) > 3) continue;
    for (const criticalUnit of criticalUnits) {
      if (candidate.action.unitId === criticalUnit.id) continue;
      if (distanceBetween(environment, candidate.action.toHexId, criticalUnit.hexId, distanceCache) > 1) continue;
      const currentCritical = bestByCriticalScreen.get(criticalUnit.id);
      if (!currentCritical || candidate.score > currentCritical.score) {
        bestByCriticalScreen.set(criticalUnit.id, candidate);
      }
    }
    const byUnit = bestByUnit.get(candidate.action.unitId);
    if (!byUnit || candidate.score > byUnit.score) bestByUnit.set(candidate.action.unitId, candidate);
    const byDestination = bestByDestination.get(candidate.action.toHexId);
    if (!byDestination || candidate.score > byDestination.score) bestByDestination.set(candidate.action.toHexId, candidate);
  }
  const selected = new Set([...bestByCriticalScreen.values(), ...bestByUnit.values()]);
  for (const candidate of [...bestByDestination.values()].sort((a, b) => b.score - a.score)) {
    if (selected.size >= 24) break;
    selected.add(candidate);
  }
  const beforeMetric = screenFragilityMetric(currentFragility);
  for (const candidate of [...selected].slice(0, 8)) {
    const projected = environmentAfterHypotheticalAxisMove(environment, candidate.action);
    if (alliedBreakthroughThreatCount(projected, distanceCache) > 0) continue;
    const afterMetric = screenFragilityMetric(trackedScreenFragility(
      projected,
      currentFragility.units,
      distanceCache,
    ));
    const reduction = Math.max(0, beforeMetric - afterMetric);
    if (reduction > 0) {
      candidate.score += reduction * 100000;
      candidate.tacticalBonus = reduction * 2400;
    }
  }
}

function trackedScreenFragility(environment, unitIds, cache) {
  const units = [];
  let exposure = 0;
  for (const unitId of unitIds || []) {
    const risk = axisBreakthroughScreenRisk(environment, [unitId], cache);
    if (risk.increase <= 0) continue;
    units.push(unitId);
    exposure += risk.increase;
  }
  return {
    before: alliedBreakthroughThreatCount(environment, cache),
    criticalUnits: units.length,
    exposure,
    units,
  };
}

function screenFragilityMetric(fragility) {
  return Number(fragility?.criticalUnits || 0) * 10 + Number(fragility?.exposure || 0);
}

function prioritizeExactBreakthroughResponses(
  environment,
  candidates,
  candidateLimit,
  distanceCache,
  threatCounter = alliedBreakthroughThreatCount,
  tacticalBonusPerThreat = 0,
) {
  const exits = alliedExitHexes(environment);
  const bestByDestination = new Map();
  const candidatesByUnit = new Map();
  for (const candidate of candidates) {
    if (nearestDistance(environment, candidate.action.toHexId, exits, distanceCache) > 2) continue;
    const current = bestByDestination.get(candidate.action.toHexId);
    if (!current || candidate.score > current.score) bestByDestination.set(candidate.action.toHexId, candidate);
    if (!candidatesByUnit.has(candidate.action.unitId)) candidatesByUnit.set(candidate.action.unitId, []);
    candidatesByUnit.get(candidate.action.unitId).push(candidate);
  }
  const currentThreats = threatCounter(environment, distanceCache);
  const exactLimit = Math.min(48, Math.max(16, candidateLimit * 2));
  const unitQueues = [...candidatesByUnit.values()]
    .map((queue) => queue.sort((a, b) => b.score - a.score));
  const selected = new Set();
  for (let round = 0; round < 4 && selected.size < exactLimit; round += 1) {
    for (const queue of unitQueues) {
      if (selected.size >= exactLimit) break;
      if (queue[round]) selected.add(queue[round]);
    }
  }
  for (const candidate of [...bestByDestination.values()].sort((a, b) => b.score - a.score)) {
    if (selected.size >= exactLimit) break;
    selected.add(candidate);
  }
  const exactCandidates = [...selected].slice(0, exactLimit);
  for (const candidate of exactCandidates) {
    const projected = environmentAfterHypotheticalAxisMove(environment, candidate.action);
    const remainingThreats = threatCounter(projected, distanceCache);
    const reduction = Math.max(0, currentThreats - remainingThreats);
    if (reduction > 0) {
      const unit = unitById(environment.state.units, candidate.action.unitId);
      candidate.score += reduction * 100000 - Number(unit?.movement || 0) * 3000;
      if (tacticalBonusPerThreat > 0) {
        candidate.tacticalBonus = reduction * tacticalBonusPerThreat;
      }
    }
  }
}

function environmentAfterHypotheticalAxisMove(environment, action) {
  return {
    ...environment,
    state: {
      ...environment.state,
      units: environment.state.units.map((unit) => (
        unit.id === action.unitId ? { ...unit, hexId: action.toHexId } : unit
      )),
    },
  };
}

function selectPhaseBeams(candidates, beamWidth, minActiveBeams) {
  const ranked = candidates
    .slice()
    .sort((a, b) => b.score - a.score || a.actions.length - b.actions.length);
  const active = ranked.filter((beam) => !beam.ended).slice(0, Math.min(beamWidth, minActiveBeams));
  if (!active.length) return ranked.slice(0, beamWidth);
  const selected = new Set(active);
  return active
    .concat(ranked.filter((beam) => !selected.has(beam)).slice(0, beamWidth - active.length))
    .sort((a, b) => b.score - a.score || a.actions.length - b.actions.length);
}

function forcedLossProjection(projection) {
  return /phase_end_loss|opponent_immediate_win/.test(String(projection?.reason || ""));
}

export function phaseEndProjectionScore(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const endPhase = generateLegalActions(environment, { includeChanceActions: false })
    .find((action) => action.type === ENV_ACTION.END_PHASE);
  if (!side || !endPhase) {
    return { score: 0, reason: "no_phase_end" };
  }

  const ended = applyEnvironmentAction(environment, endPhase, quietApplyOptions());
  if (!ended.ok) return { score: 0, reason: "phase_end_illegal" };
  if (ended.state.winner?.side === side) return { score: 9000, reason: "phase_end_win" };
  if (ended.state.winner && ended.state.winner.side !== side) return { score: -9000, reason: "phase_end_loss" };

  let score = defaultMovementStateScore(ended.environment, options) * 0.08;
  let reason = "state";
  const nextSide = activeSide(ended.environment);
  if (nextSide === side) {
    const combat = combatProjectionScore(ended.environment, side, options);
    score += combat.score;
    reason = combat.reason;
    const opponentAfterPass = opponentImmediateAfterPassingOwnPhaseScore(ended.environment, side, options);
    score += opponentAfterPass.score;
    if (opponentAfterPass.score < 0) reason = `${reason}+${opponentAfterPass.reason}`;
    if (side === "axis" && opponentAfterPass.environment && opponentAfterPass.score > -7000) {
      const fragility = axisBreakthroughScreenFragility(opponentAfterPass.environment, options.distanceCache);
      if (fragility.criticalUnits > 0) {
        score -= fragility.criticalUnits * AXIS_CRITICAL_SCREEN_PENALTY
          + fragility.exposure * AXIS_SCREEN_EXPOSURE_PENALTY;
        reason = `${reason}+fragile_breakthrough_screen`;
      }
    }
  } else if (nextSide && nextSide !== side) {
    const opponent = opponentImmediateWinScore(ended.environment, side, options);
    score += opponent.score;
    if (opponent.score < 0) reason = opponent.reason;
  }
  return { score, reason };
}

export function defaultMovementActionScore(environment, action, applied, options = {}) {
  const side = options.side || activeSide(environment);
  const unitBefore = unitById(environment.state.units, action.unitId);
  const unitAfter = unitById(applied.state.units, action.unitId);
  if (!unitBefore || !unitAfter) return 0;
  if (applied.state.winner?.side === side) return 10000;
  const features = movementActionFeatureVector(environment, action, {
    side,
    unitBefore,
    unitAfter,
    distanceCache: options.distanceCache,
  });
  if (side === "axis") {
    const beforeThreats = alliedBreakthroughThreatCount(environment, options.distanceCache);
    const afterThreats = alliedBreakthroughThreatCount(applied.environment, options.distanceCache);
    const threatReduction = beforeThreats - afterThreats;
    features.axisActualBreakthroughThreatReduction = threatReduction;
    features.axisCrisisMobilityCost = Math.max(0, threatReduction) * Number(unitBefore.movement || 0);
  }
  return scoreFeatureVector(features, options.weights) + Number(options.candidateScoreBonus || 0);
}

function combatProjectionScore(environment, side, options = {}) {
  const actions = generateLegalActions(environment, { includeChanceActions: false })
    .filter((action) => action.type === ENV_ACTION.DECLARE_COMBAT)
    .slice(0, Number(options.candidateLimit || DEFAULT_PROJECTION_CANDIDATE_LIMIT));
  let best = null;
  for (const action of actions) {
    const profile = combatEliminationProfile(environment, action);
    if (!profile) continue;
    const sealed = Number(profile.sealedRetreatRolls || 0);
    const direct = Number(profile.directDefenderEliminationRolls || 0);
    const adverse = Number(profile.attackerAdverseRolls || 0);
    const target = Number(profile.targetValue || 0);
    let score = direct * 130 + sealed * 210 + target * 8 - adverse * (side === "axis" ? 105 : 75);
    if (profile.guaranteedDefenderElimination) score += 1850 + target * 10;
    else if (sealed > 0 && profile.defenderEliminationRolls >= adverse) score += 760 + sealed * 110;
    if (!best || score > best.score) {
      best = {
        score,
        action,
        profile,
        reason: profile.guaranteedDefenderElimination ? "projected_guaranteed_elimination" : sealed > 0 ? "projected_sealed_retreat" : "projected_combat",
      };
    }
  }
  return best || { score: 0, reason: "no_projected_combat" };
}

function opponentImmediateAfterPassingOwnPhaseScore(environment, side, options = {}) {
  const passed = passPhaseWithoutActions(environment);
  if (!passed.ok) return { score: 0, reason: "own_phase_pass_illegal" };
  if (passed.state.winner?.side === side) return { score: 2000, reason: "own_phase_pass_win" };
  if (passed.state.winner && passed.state.winner.side !== side) return { score: -7000, reason: "opponent_immediate_win_after_pass" };
  return {
    ...opponentImmediateWinScore(passed.environment, side, options),
    environment: passed.environment,
  };
}

function passPhaseWithoutActions(environment) {
  let current = environment;
  let actions = generateLegalActions(current, { includeChanceActions: false });
  const finishDeclarations = actions.find((action) => action.type === ENV_ACTION.FINISH_DECLARATIONS);
  if (finishDeclarations) {
    const finished = applyEnvironmentAction(current, finishDeclarations, quietApplyOptions());
    if (!finished.ok) return finished;
    current = finished.environment;
    if (finished.state.winner) return finished;
    actions = generateLegalActions(current, { includeChanceActions: false });
  }
  const endPhase = actions.find((action) => action.type === ENV_ACTION.END_PHASE);
  if (!endPhase) return { ok: false, reason: "phase_has_required_actions", state: current.state, environment: current };
  return applyEnvironmentAction(current, endPhase, quietApplyOptions());
}

function opponentImmediateWinScore(environment, side, options = {}) {
  const opponent = side === "axis" ? "allied" : "axis";
  if (activeSide(environment) !== opponent) return { score: 0, reason: "opponent_not_active" };
  const allActions = generateLegalActions(environment, { includeChanceActions: false });
  const immediateWins = allActions.filter((action) => isImmediateBreakthroughAction(environment, action, opponent));
  const immediateWinKeys = new Set(immediateWins.map(projectionActionKey));
  const actions = immediateWins
    .concat(allActions.filter((action) => !immediateWinKeys.has(projectionActionKey(action))))
    .slice(0, Number(options.candidateLimit || DEFAULT_PROJECTION_CANDIDATE_LIMIT));
  for (const action of actions) {
    const applied = applyEnvironmentAction(environment, action, quietApplyOptions());
    if (applied.ok && applied.state.winner?.side === opponent) {
      return {
        score: -8200,
        reason: "opponent_immediate_win",
        action,
      };
    }
  }
  return { score: 0, reason: "opponent_no_immediate_win" };
}

function isImmediateBreakthroughAction(environment, action, side) {
  if (side !== "allied" || action?.type !== ENV_ACTION.MOVE_UNIT) return false;
  const unit = unitById(environment.state.units, action.unitId);
  return isAlliedBreakthroughMove(environment, unit, action.toHexId, action.route?.remaining);
}

function projectionActionKey(action) {
  if (!action) return "";
  return [
    action.type || "",
    action.unitId || "",
    action.fromHexId || "",
    action.toHexId || "",
    action.defenderId || "",
    (action.attackerIds || []).join(","),
  ].join(":");
}

function quietApplyOptions() {
  return {
    enrichEvents: false,
    previousState: false,
    cloneResultState: false,
  };
}

export function defaultMovementStateScore(environment, options = {}) {
  const side = options.side || activeSide(environment);
  if (environment.state.winner?.side === side) return 10000;
  if (environment.state.winner && environment.state.winner.side !== side) return -10000;

  return scoreFeatureVector(movementStateFeatureVector(environment, {
    side,
    distanceCache: options.distanceCache,
  }), options.weights);
}

export function mergePhaseSearchWeights(overrides = null) {
  return Object.freeze({
    ...DEFAULT_PHASE_SEARCH_WEIGHTS,
    ...(overrides || {}),
  });
}

export function scoreFeatureVector(features, weights = null) {
  const merged = mergePhaseSearchWeights(weights);
  return Object.entries(features || {}).reduce((sum, [key, value]) => (
    sum + Number(value || 0) * Number(merged[key] || 0)
  ), 0);
}

export function movementStateFeatureVector(environment, options = {}) {
  const side = options.side || activeSide(environment);
  if (side === "axis") {
    const objectives = axisObjectives(environment);
    const axisUnits = liveUnits(environment.state.units).filter((unit) => unit.side === "axis");
    const minDistance = Math.min(Infinity, ...axisUnits.map((unit) => nearestDistance(environment, unit.hexId, objectives, options.distanceCache)));
    const occupied = axisUnits.some((unit) => objectives.includes(unit.hexId));
    const breakthroughThreats = alliedBreakthroughThreatCount(environment, options.distanceCache);
    const futureBreakthroughThreats = alliedFutureBreakthroughThreatCount(environment, options.distanceCache);
    return {
      axisStateObjectiveHeld: occupied ? 1 : 0,
      axisStateObjectiveDistance: Math.min(18, minDistance),
      axisStateExitDenial: axisExitDenialCount(environment),
      axisStateExitRedundancy: axisExitDenialRedundancy(environment),
      axisStateBreakthroughThreat: breakthroughThreats,
      axisStateFutureBreakthroughThreat: futureBreakthroughThreats,
      axisStateExitThreatCoverage: axisExitThreatCoverage(environment, null, null, options.distanceCache),
    };
  }

  const objectives = axisObjectives(environment);
  const axisUnits = liveUnits(environment.state.units).filter((unit) => unit.side === "axis");
  const minAxisDistance = Math.min(Infinity, ...axisUnits.map((unit) => nearestDistance(environment, unit.hexId, objectives, options.distanceCache)));
  const wallLinks = linkedWallScore(environment, "allied", options.distanceCache);
  return {
    alliedStateAxisDistance: Math.min(18, minAxisDistance),
    alliedStateWallLink: wallLinks,
  };
}

export function movementActionFeatureVector(environment, action, options = {}) {
  const side = options.side || activeSide(environment);
  const unitBefore = options.unitBefore || unitById(environment.state.units, action.unitId);
  const unitAfter = options.unitAfter || { ...unitBefore, hexId: action.toHexId };
  if (!unitBefore || !unitAfter) return {};
  if (side === "axis") return axisMoveActionFeatures(environment, action, unitBefore, unitAfter, options.distanceCache);
  return alliedMoveActionFeatures(environment, action, unitBefore, unitAfter, options.distanceCache);
}

export function alliedImmediateBreakthroughThreatCount(environment, cache = null) {
  return alliedBreakthroughThreatCount(environment, cache);
}

export function alliedImmediateBreakthroughUnitIds(environment, cache = null) {
  return alliedExitThreatAnalysis(environment, cache).threateningUnitIds.slice();
}

export function alliedFutureBreakthroughThreatCount(environment, cache = null) {
  if (Number(environment?.state?.turn || 1) >= 2) return 0;
  const cached = cache?.get(environment);
  if (Number.isFinite(cached?.alliedFutureBreakthroughThreatCount)) {
    return cached.alliedFutureBreakthroughThreatCount;
  }
  const projected = {
    ...environment,
    state: {
      ...environment.state,
      turn: 2,
    },
  };
  const threats = alliedBreakthroughThreatCount(projected, cache);
  if (cache) {
    cache.set(environment, {
      ...(cache.get(environment) || {}),
      alliedFutureBreakthroughThreatCount: threats,
    });
  }
  return threats;
}

export function axisBreakthroughScreenRisk(environment, unitIds, cache = null) {
  const ids = new Set(unitIds || []);
  const before = alliedBreakthroughThreatCount(environment, cache);
  if (!ids.size) return { before, after: before, increase: 0 };
  const projected = {
    ...environment,
    state: {
      ...environment.state,
      units: environment.state.units.map((unit) => (
        ids.has(unit.id) && unit.side === "axis"
          ? { ...unit, disrupted: true, eliminated: true }
          : unit
      )),
    },
  };
  const after = alliedBreakthroughThreatCount(projected, cache);
  return { before, after, increase: Math.max(0, after - before) };
}

export function axisBreakthroughScreenFragility(environment, cache = null) {
  const cached = cache?.get(environment);
  if (cached?.axisBreakthroughScreenFragility) return cached.axisBreakthroughScreenFragility;
  const before = alliedBreakthroughThreatCount(environment, cache);
  if (before > 0) {
    const result = { before, criticalUnits: 0, exposure: 0, units: [] };
    if (cache) cache.set(environment, { ...(cache.get(environment) || {}), axisBreakthroughScreenFragility: result });
    return result;
  }
  const exits = alliedExitHexes(environment);
  const units = [];
  let exposure = 0;
  for (const unit of liveUnits(environment.state.units)) {
    if (unit.side !== "axis" || unit.disrupted) continue;
    if (nearestDistance(environment, unit.hexId, exits, cache) > 2) continue;
    const risk = axisBreakthroughScreenRisk(environment, [unit.id], cache);
    if (risk.increase <= 0) continue;
    units.push(unit.id);
    exposure += risk.increase;
  }
  const result = {
    before,
    criticalUnits: units.length,
    exposure,
    units,
  };
  if (cache) cache.set(environment, { ...(cache.get(environment) || {}), axisBreakthroughScreenFragility: result });
  return result;
}

function axisMoveActionFeatures(environment, action, unitBefore, unitAfter, distanceCache) {
  const objectives = axisObjectives(environment);
  const currentDistance = nearestDistance(environment, unitBefore.hexId, objectives, distanceCache);
  const nextDistance = nearestDistance(environment, unitAfter.hexId, objectives, distanceCache);
  const progress = currentDistance - nextDistance;
  const mobileFit = Number(unitBefore.movement || 0) >= 8 ? 1 + DEFAULT_PHASE_SEARCH_WEIGHTS.axisMobileFactor : 0.82;
  const combatFit = Number(unitBefore.combat || 0) >= 4 ? 1 + DEFAULT_PHASE_SEARCH_WEIGHTS.axisCombatFactor : 0.86;
  const objectiveSecurity = objectives.includes(unitAfter.hexId)
    ? axisObjectiveSecurityFeatures(environment, unitBefore, unitAfter.hexId)
    : {};
  const exitDenialBefore = axisExitDenialCount(environment);
  const exitDenialAfter = axisExitDenialCount(environment, unitBefore.id, unitAfter.hexId);
  const exitRedundancyBefore = axisExitDenialRedundancy(environment);
  const exitRedundancyAfter = axisExitDenialRedundancy(environment, unitBefore.id, unitAfter.hexId);
  const threatCoverageBefore = axisExitThreatCoverage(environment, null, null, distanceCache);
  const threatCoverageAfter = axisExitThreatCoverage(environment, unitBefore.id, unitAfter.hexId, distanceCache);
  const routeInterdictionBefore = axisThreatRouteInterdiction(environment, null, null, distanceCache);
  const routeInterdictionAfter = axisThreatRouteInterdiction(environment, unitBefore.id, unitAfter.hexId, distanceCache);
  const unitInterdictionBefore = axisThreatUnitInterdiction(environment, null, null, distanceCache);
  const unitInterdictionAfter = axisThreatUnitInterdiction(environment, unitBefore.id, unitAfter.hexId, distanceCache);
  const exitScreenDistance = nearestDistance(environment, unitAfter.hexId, alliedExitHexes(environment), distanceCache);
  const breakthroughThreats = alliedBreakthroughThreatCount(environment, distanceCache);
  return {
    axisProgress: progress * mobileFit * combatFit,
    axisObjective: objectives.includes(unitAfter.hexId) ? 1 : 0,
    ...objectiveSecurity,
    axisAdjacent: nextDistance === 1 ? 1 : 0,
    axisNear: nextDistance === 2 ? 1 : 0,
    axisReserve: Number(action.route?.remaining || 0),
    axisExitDenialGain: exitDenialAfter - exitDenialBefore,
    axisExitRedundancyGain: exitRedundancyAfter - exitRedundancyBefore,
    axisExitThreatCoverageGain: threatCoverageAfter - threatCoverageBefore,
    axisThreatRouteInterdictionGain: routeInterdictionAfter - routeInterdictionBefore,
    axisThreatUnitInterdictionGain: unitInterdictionAfter - unitInterdictionBefore,
    axisExitScreen: breakthroughThreats > 0 && exitScreenDistance <= 2 ? 1 : 0,
  };
}

function axisObjectiveSecurityFeatures(environment, movingUnit, objectiveHexId) {
  let supportStrength = 0;
  let supportCount = 0;
  let counterThreat = 0;
  for (const unit of liveUnits(environment.state.units)) {
    if (unit.id === movingUnit.id || unit.eliminated || unit.disrupted) continue;
    const range = distanceBetween(environment, unit.hexId, objectiveHexId);
    if (range > 2) continue;
    if (unit.side === movingUnit.side) {
      supportStrength += Number(unit.combat || 0);
      supportCount += 1;
    } else {
      counterThreat += Number(unit.combat || 0);
    }
  }
  const holdStrength = Number(movingUnit.combat || 0) + supportStrength;
  return {
    axisObjectiveSupport: supportStrength,
    axisObjectiveCounterThreat: Math.max(0, counterThreat - holdStrength),
    axisObjectiveUnsupportedPenalty: supportCount <= 0 && counterThreat > holdStrength ? 1 : 0,
  };
}

function alliedMoveActionFeatures(environment, action, unitBefore, unitAfter, distanceCache) {
  const objectives = axisObjectives(environment);
  const currentObjectiveDistance = nearestDistance(environment, unitBefore.hexId, objectives, distanceCache);
  const nextObjectiveDistance = nearestDistance(environment, unitAfter.hexId, objectives, distanceCache);
  const axisPressure = nearestAxisPressure(environment, unitAfter.hexId, distanceCache);
  return {
    alliedForwardBand: nextObjectiveDistance >= 4 && nextObjectiveDistance <= 8 ? 1 : 0,
    alliedForwardBandPenalty: nextObjectiveDistance >= 4 && nextObjectiveDistance <= 8 ? Math.abs(6 - nextObjectiveDistance) : 0,
    alliedObjectiveHugPenalty: nextObjectiveDistance <= 2 ? 1 : 0,
    alliedContact: axisPressure >= 2 && axisPressure <= 5 ? 1 : 0,
    alliedContactPenalty: axisPressure >= 2 && axisPressure <= 5 ? Math.abs(3 - axisPressure) : 0,
    alliedLine: linkedWallScoreForHex(environment, "allied", unitAfter.hexId, unitBefore.id, distanceCache),
    alliedDrift: Math.max(-2, currentObjectiveDistance - nextObjectiveDistance),
    alliedCombat: Number(unitBefore.combat || 0),
  };
}

function quickMoveActionScore(environment, action, side, distanceCache, weights) {
  const unit = unitById(environment.state.units, action.unitId);
  if (!unit) return 0;
  if (side === "axis") {
    const objectives = axisObjectives(environment);
    const exitDenialGain = axisExitDenialCount(environment, unit.id, action.toHexId) - axisExitDenialCount(environment);
    const exitRedundancyGain = axisExitDenialRedundancy(environment, unit.id, action.toHexId)
      - axisExitDenialRedundancy(environment);
    const threatCoverageGain = axisExitThreatCoverage(environment, unit.id, action.toHexId, distanceCache)
      - axisExitThreatCoverage(environment, null, null, distanceCache);
    const routeInterdictionGain = axisThreatRouteInterdiction(environment, unit.id, action.toHexId, distanceCache)
      - axisThreatRouteInterdiction(environment, null, null, distanceCache);
    const unitInterdictionGain = axisThreatUnitInterdiction(environment, unit.id, action.toHexId, distanceCache)
      - axisThreatUnitInterdiction(environment, null, null, distanceCache);
    const threatScreen = alliedBreakthroughThreatCount(environment, distanceCache) > 0
      && nearestDistance(environment, action.toHexId, alliedExitHexes(environment), distanceCache) <= 2;
    return (nearestDistance(environment, unit.hexId, objectives, distanceCache) - nearestDistance(environment, action.toHexId, objectives, distanceCache)) * 100
      + (objectives.includes(action.toHexId) ? 10000 : 0)
      + exitDenialGain * 650
      + exitRedundancyGain * 1100
      + threatCoverageGain * 1500
      + routeInterdictionGain * 1800
      + unitInterdictionGain * 5200
      + (threatScreen ? 5200 : 0)
      + Number(unit.movement || 0) * 2
      + Number(unit.combat || 0);
  }
  return linkedWallScoreForHex(environment, side, action.toHexId, unit.id, distanceCache) * 80
    + Math.max(0, 8 - nearestDistance(environment, action.toHexId, axisObjectives(environment), distanceCache)) * 20
    + Number(unit.combat || 0) * 5;
}

function axisObjectives(environment) {
  return [
    ...(environment.scenario?.objectives?.alamHalfaRidge || []),
    ...(environment.scenario?.objectives?.coastalRoadEast || []),
  ];
}

function alliedExitHexes(environment) {
  return environment.scenario?.objectives?.alliedWestExitEdge || [];
}

function axisExitDenialCount(environment, movedUnitId = null, movedHexId = null) {
  const coverage = axisExitDenialCoverage(environment, movedUnitId, movedHexId);
  return [...coverage.values()].filter((count) => count > 0).length;
}

function axisExitDenialRedundancy(environment, movedUnitId = null, movedHexId = null) {
  const coverage = axisExitDenialCoverage(environment, movedUnitId, movedHexId);
  return [...coverage.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function axisExitDenialCoverage(environment, movedUnitId = null, movedHexId = null) {
  const exits = new Set(alliedExitHexes(environment));
  const coverage = new Map([...exits].map((hexId) => [hexId, 0]));
  for (const unit of liveUnits(environment.state.units)) {
    if (unit.side !== "axis" || unit.disrupted) continue;
    const hexId = unit.id === movedUnitId && movedHexId ? movedHexId : unit.hexId;
    for (const deniedHexId of [hexId, ...neighborsOf(environment.board, hexId)]) {
      if (!exits.has(deniedHexId)) continue;
      coverage.set(deniedHexId, (coverage.get(deniedHexId) || 0) + 1);
    }
  }
  return coverage;
}

function axisExitThreatCoverage(environment, movedUnitId = null, movedHexId = null, cache = null) {
  const denied = axisDeniedHexes(environment, movedUnitId, movedHexId);
  const loads = alliedExitThreatLoads(environment, cache);
  let coverage = 0;
  for (const [hexId, load] of loads) {
    if (denied.has(hexId)) coverage += load;
  }
  return coverage;
}

function axisThreatRouteInterdiction(environment, movedUnitId = null, movedHexId = null, cache = null) {
  const denied = axisDeniedHexes(environment, movedUnitId, movedHexId);
  return alliedExitThreatAnalysis(environment, cache).routePaths.filter((path) => (
    path.some((hexId) => denied.has(hexId))
  )).length;
}

function axisThreatUnitInterdiction(environment, movedUnitId = null, movedHexId = null, cache = null) {
  const denied = axisDeniedHexes(environment, movedUnitId, movedHexId);
  return alliedExitThreatAnalysis(environment, cache).unitRoutePaths.filter((routes) => (
    routes.length > 0 && routes.every((path) => path.some((hexId) => denied.has(hexId)))
  )).length;
}

function axisDeniedHexes(environment, movedUnitId = null, movedHexId = null) {
  const denied = new Set();
  for (const unit of liveUnits(environment.state.units)) {
    if (unit.side !== "axis" || unit.disrupted) continue;
    const hexId = unit.id === movedUnitId && movedHexId ? movedHexId : unit.hexId;
    denied.add(hexId);
    for (const neighborId of neighborsOf(environment.board, hexId)) denied.add(neighborId);
  }
  return denied;
}

function alliedExitThreatLoads(environment, cache = null) {
  return alliedExitThreatAnalysis(environment, cache).loads;
}

function alliedExitThreatAnalysis(environment, cache = null) {
  const cacheKey = environment;
  const cached = cache?.get(cacheKey);
  if (cached?.alliedExitThreatAnalysis) return cached.alliedExitThreatAnalysis;
  const exitHexes = alliedExitHexes(environment);
  const exits = new Set(exitHexes);
  const loads = new Map();
  const routePaths = [];
  const unitRoutePaths = [];
  const threateningUnitIds = [];
  let threateningUnits = 0;
  let routes = 0;
  const context = {
    board: environment.board,
    scenario: environment.scenario,
    rules: environment.rules,
    units: environment.state.units,
    state: environment.state,
  };
  for (const unit of liveUnits(environment.state.units)) {
    if (unit.side !== "allied" || unit.disrupted) continue;
    const allowance = movementAllowance(environment.state, unit, environment.rules);
    let unitThreatensExit = false;
    const currentUnitRoutes = [];
    const alreadyOnExit = exits.has(unit.hexId)
      && !(environment.state.movedUnits || []).includes(unit.id)
      && allowance > 0;
    if (alreadyOnExit) {
      routePaths.push([]);
      currentUnitRoutes.push([]);
      routes += 1;
      unitThreatensExit = true;
    }
    if (!alreadyOnExit && (allowance <= 0 || nearestDistance(environment, unit.hexId, exitHexes, cache) >= allowance)) {
      continue;
    }
    const reachable = alreadyOnExit ? new Map() : getReachableHexes(context, unit, allowance);
    for (const [hexId, route] of reachable) {
      if (!exits.has(hexId) || Number(route?.remaining || 0) <= 0) continue;
      loads.set(hexId, (loads.get(hexId) || 0) + 1);
      const routePath = Array.isArray(route?.path) ? route.path.slice(1) : [hexId];
      routePaths.push(routePath);
      currentUnitRoutes.push(routePath);
      routes += 1;
      unitThreatensExit = true;
    }
    if (unitThreatensExit) {
      threateningUnits += 1;
      threateningUnitIds.push(unit.id);
      unitRoutePaths.push(currentUnitRoutes);
    }
  }
  const analysis = { loads, routePaths, unitRoutePaths, threateningUnitIds, threateningUnits, routes };
  if (cache) cache.set(cacheKey, { ...(cached || {}), alliedExitThreatAnalysis: analysis });
  return analysis;
}

function alliedBreakthroughThreatCount(environment, distanceCache = null) {
  return alliedExitThreatAnalysis(environment, distanceCache).threateningUnits;
}

function nearestDistance(environment, fromHexId, targets, distanceCache = null) {
  if (!targets?.length) return Infinity;
  return Math.min(...targets.map((hexId) => distanceBetween(environment, fromHexId, hexId, distanceCache)));
}

function distanceBetween(environment, fromHexId, toHexId, distanceCache = null) {
  if (!distanceCache) return hexDistance(environment.board, fromHexId, toHexId);
  const key = `from:${toHexId}`;
  if (!distanceCache.has(key)) {
    distanceCache.set(key, distanceMapFrom(environment, toHexId));
  }
  return distanceCache.get(key).get(fromHexId) ?? Infinity;
}

function distanceMapFrom(environment, originHexId) {
  const distances = new Map([[originHexId, 0]]);
  const queue = [originHexId];
  while (queue.length) {
    const current = queue.shift();
    const nextDistance = distances.get(current) + 1;
    for (const next of neighborsOf(environment.board, current)) {
      if (distances.has(next)) continue;
      distances.set(next, nextDistance);
      queue.push(next);
    }
  }
  return distances;
}

function nearestAxisPressure(environment, hexId, distanceCache = null) {
  const axisUnits = liveUnits(environment.state.units).filter((unit) => unit.side === "axis" && !unit.disrupted);
  return Math.min(Infinity, ...axisUnits.map((unit) => distanceBetween(environment, unit.hexId, hexId, distanceCache)));
}

function linkedWallScore(environment, side, distanceCache = null) {
  return liveUnits(environment.state.units)
    .filter((unit) => unit.side === side && !unit.disrupted)
    .reduce((sum, unit) => sum + linkedWallScoreForHex(environment, side, unit.hexId, unit.id, distanceCache), 0);
}

function linkedWallScoreForHex(environment, side, hexId, ignoreUnitId = null, distanceCache = null) {
  return liveUnits(environment.state.units)
    .filter((unit) => unit.id !== ignoreUnitId && unit.side === side && !unit.disrupted)
    .reduce((sum, unit) => {
      const distance = distanceBetween(environment, unit.hexId, hexId, distanceCache);
      if (distance === 2) return sum + 2;
      if (distance === 3) return sum + 1;
      if (distance === 1) return sum - 1;
      return sum;
    }, 0);
}
