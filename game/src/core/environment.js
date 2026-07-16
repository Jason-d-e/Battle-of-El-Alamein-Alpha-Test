import { createBoard, neighborsOf } from "./board.js";
import { calculateOdds, canAttack, planCombatResult } from "./combat.js";
import { getReachableHexes } from "./movement.js";
import { getLegalRetreatPaths } from "./retreat.js";
import { liveUnitAt, liveUnits, unitById } from "./units.js";
import { evaluateAlliedBreakthroughVictory, evaluateAxisObjectiveVictory, getObjectiveStatus, isAlliedBreakthroughMove } from "./victory.js";
import { shouldCheckAxisObjectiveVictoryAtPhaseEnd } from "./phases.js";

export const ENV_ACTION = Object.freeze({
  MOVE_UNIT: "MOVE_UNIT",
  DECLARE_COMBAT: "DECLARE_COMBAT",
  FINISH_DECLARATIONS: "FINISH_DECLARATIONS",
  RESOLVE_COMBAT: "RESOLVE_COMBAT",
  RETREAT_UNIT: "RETREAT_UNIT",
  ADVANCE_UNIT: "ADVANCE_UNIT",
  SKIP_ADVANCE: "SKIP_ADVANCE",
  END_PHASE: "END_PHASE",
});

export const ENV_EVENT = Object.freeze({
  PHASE_ENDED: "PHASE_ENDED",
  PHASE_STARTED: "PHASE_STARTED",
  UNIT_MOVED: "UNIT_MOVED",
  COMBAT_DECLARED: "COMBAT_DECLARED",
  COMBAT_RESOLVED: "COMBAT_RESOLVED",
  UNIT_RETREATED: "UNIT_RETREATED",
  UNIT_ADVANCED: "UNIT_ADVANCED",
  UNIT_ELIMINATED: "UNIT_ELIMINATED",
  GAME_ENDED: "GAME_ENDED",
});

const HASH_OFFSET = 2166136261;
const HASH_PRIME = 16777619;

export function cloneGameState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function makeInitialEnvironmentState(scenario) {
  const units = cloneGameState(scenario?.units || []);
  return {
    version: 2,
    turn: 1,
    phaseIndex: 0,
    selectedUnitId: null,
    selectedDefenderId: null,
    selectedAttackers: [],
    combatMode: "declare",
    declaredCombats: [],
    combatCompleteNotified: false,
    movedUnits: [],
    usedAttackers: [],
    usedDefenders: [],
    lastMove: null,
    retreatTask: null,
    advanceTask: null,
    lastCombatResult: null,
    battleReports: [],
    eliminatedUnitIds: [],
    losses: makeLossStats(),
    initialStrength: totalStrengthBySide(units),
    log: [],
    winner: null,
    units,
  };
}

export function createEnvironment({ scenario, rules, board = null, state = null }) {
  return {
    scenario,
    rules,
    board: board || createBoard(scenario),
    state: cloneGameState(state || makeInitialEnvironmentState(scenario)),
  };
}

export function environmentContext(environment, state = environment.state) {
  return {
    board: environment.board,
    scenario: environment.scenario,
    rules: environment.rules,
    units: state.units,
    state,
    activeSide: activeSide(environment, state),
    usedAttackers: state.usedAttackers || [],
    usedDefenders: state.usedDefenders || [],
  };
}

export function currentPhase(environment, state = environment.state) {
  return environment.rules.phases[state.phaseIndex] || null;
}

export function activeSide(environment, state = environment.state) {
  return currentPhase(environment, state)?.side || null;
}

export function generateLegalActions(environment, options = {}) {
  const state = environment.state;
  if (!state || state.winner) return [];

  const retreatActions = generateRetreatActions(environment);
  if (retreatActions.length) return retreatActions;

  const advanceActions = generateAdvanceActions(environment);
  if (advanceActions.length) return advanceActions;

  const phase = currentPhase(environment);
  if (!phase) return [];
  if (phase.type === "movement") return generateMovementActions(environment, options);
  if (phase.type === "combat") return generateCombatActions(environment, options);
  return canEndPhase(environment) ? [{ type: ENV_ACTION.END_PHASE }] : [];
}

export function applyEnvironmentAction(environment, action, options = {}) {
  const enrichEvents = options.enrichEvents !== false;
  const keepPreviousState = options.previousState !== false;
  const previousState = keepPreviousState ? cloneGameState(environment.state) : null;
  const nextEnvironment = {
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
    state: options.mutate ? environment.state : cloneGameState(environment.state),
  };
  const stateBefore = enrichEvents ? cloneGameState(nextEnvironment.state) : null;
  const legalActionsBefore = enrichEvents
    ? generateLegalActions(nextEnvironment, { includeChanceActions: true }).map(compactAction)
    : [];
  const metricsBefore = enrichEvents ? environmentMetrics(nextEnvironment) : null;
  const events = [];
  const fail = (reason) => ({
    ok: false,
    reason,
    action: compactAction(action),
    previousState,
    state: cloneGameState(nextEnvironment.state),
    events: [],
  });

  if (!nextEnvironment.state || nextEnvironment.state.winner) return fail("game_already_ended");

  let result = null;
  switch (action?.type) {
    case ENV_ACTION.MOVE_UNIT:
      result = applyMoveAction(nextEnvironment, action);
      break;
    case ENV_ACTION.DECLARE_COMBAT:
      result = applyDeclareCombatAction(nextEnvironment, action);
      break;
    case ENV_ACTION.FINISH_DECLARATIONS:
      result = applyFinishDeclarationsAction(nextEnvironment, action);
      break;
    case ENV_ACTION.RESOLVE_COMBAT:
      result = applyResolveCombatAction(nextEnvironment, action);
      break;
    case ENV_ACTION.RETREAT_UNIT:
      result = applyRetreatAction(nextEnvironment, action);
      break;
    case ENV_ACTION.ADVANCE_UNIT:
    case ENV_ACTION.SKIP_ADVANCE:
      result = applyAdvanceAction(nextEnvironment, action);
      break;
    case ENV_ACTION.END_PHASE:
      result = applyEndPhaseAction(nextEnvironment, action);
      break;
    default:
      return fail("unknown_action");
  }

  if (!result?.ok) return fail(result?.reason || "illegal_action");

  events.push(...(result.events || []));
  const legalActionsAfter = enrichEvents
    ? generateLegalActions(nextEnvironment, { includeChanceActions: true }).map(compactAction)
    : [];
  const metricsAfter = enrichEvents ? environmentMetrics(nextEnvironment) : null;
  const stateHashBefore = enrichEvents ? stateHashForState(nextEnvironment, stateBefore) : null;
  const stateHashAfter = enrichEvents ? stateHash(nextEnvironment) : null;
  const enrichedEvents = enrichEvents
    ? events.map((event) => ({
      ...event,
      action: compactAction(action),
      stateHashBefore,
      stateHashAfter,
      legalActionsBefore,
      legalActionsAfter,
      metricsBefore,
      metricsAfter,
    }))
    : events;

  if (enrichEvents && nextEnvironment.state.winner && !enrichedEvents.some((event) => event.type === ENV_EVENT.GAME_ENDED)) {
    enrichedEvents.push({
      type: ENV_EVENT.GAME_ENDED,
      winner: cloneGameState(nextEnvironment.state.winner),
      action: compactAction(action),
      stateHashBefore,
      stateHashAfter,
      legalActionsBefore,
      legalActionsAfter,
      metricsBefore,
      metricsAfter,
    });
  }

  if (options.mutate) environment.state = nextEnvironment.state;
  return {
    ok: true,
    action: compactAction(action),
    previousState,
    state: options.cloneResultState === false ? nextEnvironment.state : cloneGameState(nextEnvironment.state),
    environment: nextEnvironment,
    events: enrichedEvents,
  };
}

export function restorePreviousState(applyResult) {
  return cloneGameState(applyResult?.previousState || applyResult);
}

export function evaluateEnvironmentVictory(environment) {
  const state = environment.state;
  if (state?.winner) return cloneGameState(state.winner);

  const phase = currentPhase(environment);
  if (phase?.type === "movement" && phase.side === "allied") {
    const breakthrough = evaluateAlliedBreakthroughVictory(environmentContext(environment), state.movedUnits || []);
    if (breakthrough) return { side: "allied", reason: "breakthrough", type: breakthrough.type, turn: state.turn };
  }

  if (shouldCheckAxisObjectiveVictoryAtPhaseEnd({ phaseIndex: state.phaseIndex, phases: environment.rules.phases })) {
    const objective = evaluateAxisObjectiveVictory(environmentContext(environment));
    if (objective) return { side: "axis", reason: objective.reason, type: objective.type, turn: state.turn };
    if (state.turn >= environment.rules.turns.length) return { side: "allied", reason: "axis-failed", type: "axis-failed", turn: state.turn };
  }

  return null;
}

export function stateHash(environment) {
  return stateHashForState(environment, environment.state);
}

export function stateHashForState(environment, state) {
  const payload = stableStringify({
    turn: state.turn,
    phaseIndex: state.phaseIndex,
    combatMode: state.combatMode,
    movedUnits: (state.movedUnits || []).slice().sort(),
    usedAttackers: (state.usedAttackers || []).slice().sort(),
    usedDefenders: (state.usedDefenders || []).slice().sort(),
    retreatTask: compactRetreatTask(state.retreatTask),
    advanceTask: compactAdvanceTask(state.advanceTask),
    declaredCombats: (state.declaredCombats || []).map(compactBattleForHash),
    winner: state.winner ? {
      side: state.winner.side,
      reason: state.winner.reason,
      type: state.winner.type || null,
      turn: state.winner.turn || state.turn,
    } : null,
    units: (state.units || [])
      .map((unit) => ({
        id: unit.id,
        side: unit.side,
        hexId: unit.hexId,
        disrupted: Boolean(unit.disrupted),
        eliminated: Boolean(unit.eliminated),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  });
  return fnv1a(payload);
}

export function environmentMetrics(environment) {
  const state = environment.state;
  const units = state.units || [];
  const live = liveUnits(units);
  const losses = cloneGameState(state.losses || makeLossStats());
  const objectiveStatus = getObjectiveStatus(environmentContext(environment));
  return {
    turn: state.turn,
    phaseId: currentPhase(environment)?.id || null,
    activeSide: activeSide(environment),
    unitCount: {
      axis: live.filter((unit) => unit.side === "axis").length,
      allied: live.filter((unit) => unit.side === "allied").length,
    },
    combatStrength: totalStrengthBySide(units),
    eliminatedUnitIds: (state.eliminatedUnitIds || []).slice(),
    losses,
    objectiveStatus,
    winner: state.winner ? cloneGameState(state.winner) : null,
  };
}

export function compactAction(action) {
  if (!action) return null;
  const compact = { type: action.type };
  for (const key of [
    "unitId",
    "fromHexId",
    "toHexId",
    "defenderId",
    "battleId",
    "dieRoll",
    "result",
    "targetHexId",
  ]) {
    if (action[key] !== undefined) compact[key] = action[key];
  }
  if (action.attackerIds) compact.attackerIds = action.attackerIds.slice();
  if (action.route) compact.route = compactRoute(action.route);
  return compact;
}

function generateMovementActions(environment) {
  const state = environment.state;
  const side = activeSide(environment);
  const actions = [];
  for (const unit of liveUnits(state.units)) {
    if (unit.side !== side || unit.disrupted || (state.movedUnits || []).includes(unit.id)) continue;
    const reachable = getReachableHexes(environmentContext(environment), unit);
    for (const [toHexId, route] of reachable.entries()) {
      actions.push({
        type: ENV_ACTION.MOVE_UNIT,
        unitId: unit.id,
        fromHexId: unit.hexId,
        toHexId,
        route: cloneGameState(route),
      });
    }
  }
  if (canEndPhase(environment)) actions.push({ type: ENV_ACTION.END_PHASE });
  return actions;
}

function generateCombatActions(environment, options = {}) {
  const state = environment.state;
  if (state.combatMode === "resolve") {
    const battle = currentBattle(state);
    if (!battle || state.retreatTask || state.advanceTask) {
      return canEndPhase(environment) ? [{ type: ENV_ACTION.END_PHASE }] : [];
    }
    const defender = unitById(state.units, battle.defenderId);
    const attackers = (battle.attackerIds || []).map((id) => unitById(state.units, id)).filter((unit) => unit && !unit.eliminated);
    if (!defender || defender.eliminated || !attackers.length) {
      return [{ type: ENV_ACTION.RESOLVE_COMBAT, battleId: battle.id, result: "Skipped" }];
    }
    if (!options.includeChanceActions) return [{ type: ENV_ACTION.RESOLVE_COMBAT, battleId: battle.id }];
    const odds = calculateOdds(environmentContext(environment), attackers, defender);
    return [1, 2, 3, 4, 5, 6].map((dieRoll) => ({
      type: ENV_ACTION.RESOLVE_COMBAT,
      battleId: battle.id,
      dieRoll,
      result: environment.rules.crt.rows[String(dieRoll)][odds.columnIndex],
    }));
  }

  const actions = [];
  const side = activeSide(environment);
  const context = environmentContext(environment);
  const defenders = liveUnits(state.units)
    .filter((unit) => unit.side !== side && !unit.disrupted && !(state.usedDefenders || []).includes(unit.id));
  for (const defender of defenders) {
    const attackers = neighborsOf(environment.board, defender.hexId)
      .map((hexId) => liveUnitAt(state.units, hexId))
      .filter((attacker) => canAttack(context, attacker, defender));
    for (const group of attackerGroups(attackers)) {
      actions.push({
        type: ENV_ACTION.DECLARE_COMBAT,
        defenderId: defender.id,
        attackerIds: group.map((unit) => unit.id),
      });
    }
  }
  actions.push({ type: ENV_ACTION.FINISH_DECLARATIONS });
  return actions;
}

function generateRetreatActions(environment) {
  const task = environment.state.retreatTask;
  if (!task) return [];
  const unit = unitById(environment.state.units, task.unitIds?.[task.index || 0]);
  if (!unit || unit.eliminated) return [];
  const originHexId = task.origins?.[unit.id] || unit.hexId;
  const paths = getLegalRetreatPaths(environmentContext(environment), unit, task.steps, originHexId);
  return Array.from(paths.entries()).map(([toHexId, path]) => ({
    type: ENV_ACTION.RETREAT_UNIT,
    unitId: unit.id,
    toHexId,
    route: { path, remaining: 0 },
    battleId: task.battleId || null,
  }));
}

function generateAdvanceActions(environment) {
  const task = environment.state.advanceTask;
  if (!task) return [];
  const targetOccupied = liveUnitAt(environment.state.units, task.targetHexId);
  const actions = [{ type: ENV_ACTION.SKIP_ADVANCE, battleId: task.battleId, targetHexId: task.targetHexId }];
  if (targetOccupied) return actions;
  for (const unitId of task.attackerIds || []) {
    const unit = unitById(environment.state.units, unitId);
    if (!unit || unit.eliminated || !neighborsOf(environment.board, unit.hexId).includes(task.targetHexId)) continue;
    actions.push({
      type: ENV_ACTION.ADVANCE_UNIT,
      unitId,
      battleId: task.battleId,
      targetHexId: task.targetHexId,
    });
  }
  return actions;
}

function applyMoveAction(environment, action) {
  const state = environment.state;
  const unit = unitById(state.units, action.unitId);
  if (!unit || unit.eliminated) return { ok: false, reason: "unit_not_found" };
  if (unit.side !== activeSide(environment)) return { ok: false, reason: "wrong_side" };
  if (unit.disrupted) return { ok: false, reason: "unit_disrupted" };
  if ((state.movedUnits || []).includes(unit.id)) return { ok: false, reason: "already_moved" };

  const reachable = getReachableHexes(environmentContext(environment), unit);
  const route = reachable.get(action.toHexId);
  if (!route) return { ok: false, reason: "illegal_destination" };

  const occupant = liveUnitAt(state.units, action.toHexId);
  if (occupant && occupant.id !== unit.id) return { ok: false, reason: "destination_occupied" };

  const fromHexId = unit.hexId;
  unit.hexId = action.toHexId;
  state.movedUnits ||= [];
  state.movedUnits.push(unit.id);
  state.lastMove = {
    unitId: unit.id,
    fromHexId,
    toHexId: action.toHexId,
    path: route.path.slice(),
    movedUnitsBefore: (state.movedUnits || []).filter((id) => id !== unit.id),
    turn: state.turn,
    phaseIndex: state.phaseIndex,
  };

  if (isAlliedBreakthroughMove(environmentContext(environment), unit, action.toHexId, route.remaining)) {
    state.winner = { side: "allied", reason: "breakthrough", type: "allied-breakthrough", turn: state.turn };
  }

  return {
    ok: true,
    events: [{
      type: ENV_EVENT.UNIT_MOVED,
      unitId: unit.id,
      side: unit.side,
      fromHexId,
      toHexId: action.toHexId,
      route: compactRoute(route),
      remainingMovement: route.remaining,
    }],
  };
}

function applyDeclareCombatAction(environment, action) {
  const state = environment.state;
  if (currentPhase(environment)?.type !== "combat" || state.combatMode !== "declare") return { ok: false, reason: "not_declaration_phase" };
  const defender = unitById(state.units, action.defenderId);
  const attackers = (action.attackerIds || []).map((id) => unitById(state.units, id)).filter(Boolean);
  if (!defender || defender.eliminated || !attackers.length) return { ok: false, reason: "invalid_combat_units" };
  const context = environmentContext(environment);
  if (attackers.some((attacker) => !canAttack(context, attacker, defender))) return { ok: false, reason: "illegal_attacker" };

  const odds = calculateOdds(context, attackers, defender);
  const battle = {
    id: action.battleId || `b${state.turn}-${state.phaseIndex}-${state.declaredCombats.length}`,
    turn: state.turn,
    phaseId: currentPhase(environment).id,
    side: activeSide(environment),
    defenderId: defender.id,
    defenderHexId: defender.hexId,
    attackerIds: attackers.map((unit) => unit.id),
    attackerOrigins: Object.fromEntries(attackers.map((unit) => [unit.id, unit.hexId])),
    attackerHexIds: attackers.map((unit) => unit.hexId),
    oddsShort: `${odds.attack}:${odds.defense} / ${odds.column}`,
    resolved: false,
    result: null,
    events: [],
  };
  state.declaredCombats ||= [];
  state.usedDefenders ||= [];
  state.usedAttackers ||= [];
  state.declaredCombats.push(battle);
  state.usedDefenders.push(defender.id);
  state.usedAttackers.push(...attackers.map((unit) => unit.id));
  state.combatCompleteNotified = false;
  return {
    ok: true,
    events: [{
      type: ENV_EVENT.COMBAT_DECLARED,
      battleId: battle.id,
      side: battle.side,
      defenderId: defender.id,
      defenderHexId: defender.hexId,
      attackerIds: battle.attackerIds.slice(),
      attackerHexIds: battle.attackerHexIds.slice(),
      odds: cloneGameState(odds),
    }],
  };
}

function applyFinishDeclarationsAction(environment) {
  const state = environment.state;
  if (currentPhase(environment)?.type !== "combat" || state.combatMode !== "declare") return { ok: false, reason: "not_declaration_phase" };
  state.combatMode = "resolve";
  state.combatCompleteNotified = !(state.declaredCombats || []).length;
  return { ok: true, events: [] };
}

function applyResolveCombatAction(environment, action) {
  const state = environment.state;
  if (currentPhase(environment)?.type !== "combat" || state.combatMode !== "resolve") return { ok: false, reason: "not_resolution_phase" };
  if (state.retreatTask || state.advanceTask) return { ok: false, reason: "pending_combat_task" };
  const battle = currentBattle(state, action.battleId);
  if (!battle) return { ok: false, reason: "battle_not_found" };
  const defender = unitById(state.units, battle.defenderId);
  const attackers = battle.attackerIds.map((id) => unitById(state.units, id)).filter((unit) => unit && !unit.eliminated);
  if (!defender || defender.eliminated || !attackers.length || action.result === "Skipped") {
    battle.resolved = true;
    battle.result = "Skipped";
    state.lastCombatResult = { battleId: battle.id, result: "Skipped", events: [] };
    return {
      ok: true,
      events: [{ type: ENV_EVENT.COMBAT_RESOLVED, battleId: battle.id, result: "Skipped", skipped: true }],
    };
  }

  const odds = calculateOdds(environmentContext(environment), attackers, defender);
  const dieRoll = Number(action.dieRoll || 0);
  if (!Number.isInteger(dieRoll) || dieRoll < 1 || dieRoll > 6) return { ok: false, reason: "missing_die_roll" };
  const result = environment.rules.crt.rows[String(dieRoll)][odds.columnIndex];
  const plan = planCombatResult(environmentContext(environment), battle, result);
  battle.result = `${dieRoll}/${odds.column}/${result}`;
  battle.resultCode = result;
  battle.roll = dieRoll;
  battle.crtColumn = odds.column;
  battle.oddsShort = `${odds.attack}:${odds.defense} / ${odds.column}`;
  battle.events = [];
  state.lastCombatResult = {
    battleId: battle.id,
    result,
    roll: dieRoll,
    column: odds.column,
    odds: battle.oddsShort,
    events: battle.events,
  };

  const events = [{
    type: ENV_EVENT.COMBAT_RESOLVED,
    battleId: battle.id,
    defenderId: battle.defenderId,
    attackerIds: battle.attackerIds.slice(),
    dieRoll,
    result,
    odds: cloneGameState(odds),
  }];
  for (const unitId of plan.eliminatedUnitIds) {
    const eliminated = eliminateUnit(state, unitId);
    if (eliminated) events.push({ type: ENV_EVENT.UNIT_ELIMINATED, battleId: battle.id, unitId, side: eliminated.side });
  }
  if (plan.resolveBattle) battle.resolved = true;
  if (plan.retreatTask) {
    state.retreatTask = {
      battleId: battle.id,
      index: 0,
      remainingSteps: plan.retreatTask.steps,
      controllerSide: battle.side,
      ...cloneGameState(plan.retreatTask),
    };
    settleRetreatTaskWithoutChoices(environment, events);
  }
  if (plan.startAdvance) startAdvanceTask(environment, battle);
  if (plan.archiveBattle) archiveBattleReport(state, battle);
  return { ok: true, events };
}

function applyRetreatAction(environment, action) {
  const state = environment.state;
  const task = state.retreatTask;
  if (!task) return { ok: false, reason: "no_retreat_task" };
  const unit = unitById(state.units, task.unitIds?.[task.index || 0]);
  if (!unit || unit.id !== action.unitId || unit.eliminated) return { ok: false, reason: "wrong_retreat_unit" };
  const originHexId = task.origins?.[unit.id] || unit.hexId;
  const paths = getLegalRetreatPaths(environmentContext(environment), unit, task.steps, originHexId);
  const path = paths.get(action.toHexId);
  if (!path) return { ok: false, reason: "illegal_retreat_destination" };
  const fromHexId = unit.hexId;
  unit.hexId = action.toHexId;
  unit.disrupted = Boolean(task.disruptAfterRetreat);
  task.index += 1;
  task.remainingSteps = task.steps;
  const events = [{
    type: ENV_EVENT.UNIT_RETREATED,
    battleId: task.battleId || null,
    unitId: unit.id,
    side: unit.side,
    fromHexId,
    toHexId: action.toHexId,
    route: compactRoute({ path, remaining: 0 }),
    disrupted: unit.disrupted,
  }];
  settleRetreatTaskWithoutChoices(environment, events);
  return { ok: true, events };
}

function applyAdvanceAction(environment, action) {
  const state = environment.state;
  const task = state.advanceTask;
  if (!task) return { ok: false, reason: "no_advance_task" };
  if (action.type === ENV_ACTION.SKIP_ADVANCE) {
    state.advanceTask = null;
    return { ok: true, events: [] };
  }
  if (!task.attackerIds.includes(action.unitId)) return { ok: false, reason: "unit_not_eligible_to_advance" };
  const unit = unitById(state.units, action.unitId);
  if (!unit || unit.eliminated || !neighborsOf(environment.board, unit.hexId).includes(task.targetHexId)) return { ok: false, reason: "illegal_advance_unit" };
  if (liveUnitAt(state.units, task.targetHexId)) return { ok: false, reason: "advance_target_occupied" };
  const fromHexId = unit.hexId;
  unit.hexId = task.targetHexId;
  state.advanceTask = null;
  return {
    ok: true,
    events: [{
      type: ENV_EVENT.UNIT_ADVANCED,
      battleId: task.battleId,
      unitId: unit.id,
      side: unit.side,
      fromHexId,
      toHexId: task.targetHexId,
    }],
  };
}

function applyEndPhaseAction(environment) {
  const state = environment.state;
  if (!canEndPhase(environment)) return { ok: false, reason: "phase_has_pending_work" };
  const endedPhase = currentPhase(environment);
  const phaseVictory = endedPhase?.type === "movement" && endedPhase.side === "allied"
    ? evaluateEnvironmentVictory(environment)
    : null;
  if (endedPhase?.type === "combat") recoverSide(state, endedPhase.side);
  clearPhaseState(state);
  const events = [{ type: ENV_EVENT.PHASE_ENDED, phaseId: endedPhase?.id || null, turn: state.turn }];
  const fullTurnEnd = shouldCheckAxisObjectiveVictoryAtPhaseEnd({ phaseIndex: state.phaseIndex, phases: environment.rules.phases });
  if (phaseVictory) {
    state.winner = phaseVictory;
    events.push({ type: ENV_EVENT.GAME_ENDED, winner: cloneGameState(state.winner) });
    return { ok: true, events };
  }
  if (fullTurnEnd) {
    const axisVictory = evaluateAxisObjectiveVictory(environmentContext(environment));
    if (axisVictory) {
      state.winner = { side: "axis", reason: axisVictory.reason, type: axisVictory.type, turn: state.turn };
      events.push({ type: ENV_EVENT.GAME_ENDED, winner: cloneGameState(state.winner) });
      return { ok: true, events };
    }
    if (state.turn >= environment.rules.turns.length) {
      state.winner = { side: "allied", reason: "axis-failed", type: "axis-failed", turn: state.turn };
      events.push({ type: ENV_EVENT.GAME_ENDED, winner: cloneGameState(state.winner) });
      return { ok: true, events };
    }
    state.turn += 1;
    state.phaseIndex = 0;
  } else {
    state.phaseIndex += 1;
  }
  events.push({ type: ENV_EVENT.PHASE_STARTED, phaseId: currentPhase(environment)?.id || null, turn: state.turn });
  return { ok: true, events };
}

function canEndPhase(environment) {
  const state = environment.state;
  if (state.winner || state.retreatTask || state.advanceTask) return false;
  const phase = currentPhase(environment);
  if (phase?.type === "combat" && state.combatMode === "resolve" && currentBattle(state)) return false;
  if (phase?.type === "combat" && state.combatMode === "declare" && (state.declaredCombats || []).length) return false;
  return true;
}

function settleRetreatTaskWithoutChoices(environment, events) {
  const state = environment.state;
  const task = state.retreatTask;
  if (!task) return;
  while (task.index < (task.unitIds || []).length) {
    const unit = unitById(state.units, task.unitIds[task.index]);
    if (!unit || unit.eliminated) {
      task.index += 1;
      task.remainingSteps = task.steps;
      continue;
    }
    const originHexId = task.origins?.[unit.id] || unit.hexId;
    const paths = getLegalRetreatPaths(environmentContext(environment), unit, task.steps, originHexId);
    if (paths.size) return;
    const eliminated = eliminateUnit(state, unit.id);
    if (eliminated) events.push({ type: ENV_EVENT.UNIT_ELIMINATED, battleId: task.battleId || null, unitId: unit.id, side: eliminated.side, reason: "no_retreat" });
    task.index += 1;
    task.remainingSteps = task.steps;
  }
  finishRetreatTask(environment);
}

function finishRetreatTask(environment) {
  const state = environment.state;
  const task = state.retreatTask;
  if (!task) return;
  const battle = (state.declaredCombats || []).find((item) => item.id === task.battleId) || task.battle;
  if (battle) {
    battle.resolved = true;
    archiveBattleReport(state, battle);
  }
  state.retreatTask = null;
  if (task.advanceAfter && battle) startAdvanceTask(environment, battle);
}

function startAdvanceTask(environment, battle) {
  const state = environment.state;
  const targetHexId = battle.defenderHexId;
  if (liveUnitAt(state.units, targetHexId)) return;
  const eligible = (battle.attackerIds || []).filter((id) => {
    const unit = unitById(state.units, id);
    return unit && !unit.eliminated && neighborsOf(environment.board, unit.hexId).includes(targetHexId);
  });
  if (eligible.length) state.advanceTask = { battleId: battle.id, targetHexId, attackerIds: eligible };
}

function currentBattle(state, battleId = null) {
  if (battleId) return (state.declaredCombats || []).find((battle) => battle.id === battleId) || null;
  return (state.declaredCombats || []).find((battle) => !battle.resolved) || null;
}

function clearPhaseState(state) {
  state.selectedUnitId = null;
  state.selectedDefenderId = null;
  state.selectedAttackers = [];
  state.declaredCombats = [];
  state.combatCompleteNotified = false;
  state.usedAttackers = [];
  state.usedDefenders = [];
  state.movedUnits = [];
  state.lastMove = null;
  state.lastCombatResult = null;
  state.combatMode = "declare";
}

function recoverSide(state, side) {
  for (const unit of state.units || []) {
    if (!unit.eliminated && unit.side === side) unit.disrupted = false;
  }
}

function eliminateUnit(state, unitId) {
  const unit = unitById(state.units, unitId);
  if (!unit || unit.eliminated) return null;
  unit.eliminated = true;
  unit.disrupted = false;
  state.eliminatedUnitIds ||= [];
  if (!state.eliminatedUnitIds.includes(unit.id)) state.eliminatedUnitIds.push(unit.id);
  state.losses ||= makeLossStats();
  state.losses[unit.side].units += 1;
  state.losses[unit.side].combat += Number(unit.combat || 0);
  return unit;
}

function archiveBattleReport(state, battle) {
  state.battleReports ||= [];
  if (state.battleReports.some((item) => item.id === battle.id)) return;
  state.battleReports.push({
    id: battle.id,
    turn: battle.turn,
    phaseId: battle.phaseId,
    side: battle.side,
    defenderId: battle.defenderId,
    defenderHexId: battle.defenderHexId,
    attackerIds: (battle.attackerIds || []).slice(),
    attackerHexIds: (battle.attackerHexIds || []).slice(),
    odds: battle.oddsShort || null,
    roll: battle.roll || null,
    column: battle.crtColumn || null,
    result: battle.resultCode || battle.result,
    events: cloneGameState(battle.events || []),
  });
}

function attackerGroups(attackers) {
  const ordered = attackers.slice(0, 6).sort((a, b) => Number(b.combat || 0) - Number(a.combat || 0) || String(a.id).localeCompare(String(b.id)));
  const groups = [];
  for (let mask = 1; mask < (1 << ordered.length); mask += 1) {
    groups.push(ordered.filter((_, index) => mask & (1 << index)));
  }
  return groups;
}

function compactRoute(route) {
  return route ? {
    spent: route.spent ?? null,
    remaining: route.remaining ?? 0,
    path: (route.path || []).slice(),
  } : null;
}

function compactRetreatTask(task) {
  if (!task) return null;
  return {
    battleId: task.battleId || null,
    unitIds: (task.unitIds || []).slice(),
    index: task.index || 0,
    steps: task.steps,
    result: task.result,
    origins: cloneGameState(task.origins || {}),
    disruptAfterRetreat: Boolean(task.disruptAfterRetreat),
    advanceAfter: Boolean(task.advanceAfter),
  };
}

function compactAdvanceTask(task) {
  if (!task) return null;
  return {
    battleId: task.battleId || null,
    targetHexId: task.targetHexId,
    attackerIds: (task.attackerIds || []).slice(),
  };
}

function compactBattleForHash(battle) {
  return {
    id: battle.id,
    defenderId: battle.defenderId,
    attackerIds: (battle.attackerIds || []).slice(),
    resolved: Boolean(battle.resolved),
    result: battle.resultCode || battle.result || null,
    roll: battle.roll || null,
  };
}

function makeLossStats() {
  return {
    axis: { units: 0, combat: 0 },
    allied: { units: 0, combat: 0 },
  };
}

function totalStrengthBySide(units) {
  return (units || []).reduce((totals, unit) => {
    if (!unit.eliminated) totals[unit.side] += Number(unit.combat || 0);
    return totals;
  }, { axis: 0, allied: 0 });
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function fnv1a(text) {
  let hash = HASH_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, HASH_PRIME);
  }
  return (hash >>> 0).toString(36);
}
