import {
  ENV_ACTION,
  activeSide,
  applyEnvironmentAction,
  calculateOdds,
  environmentContext,
  evaluateAxisObjectiveVictory,
  generateLegalActions,
  getLegalRetreatPaths,
  unitById,
} from "../core/index.js";

export const TACTICAL_REASON = Object.freeze({
  DIRECT_WIN: "direct_win",
  AXIS_OBJECTIVE_PENDING: "axis_objective_pending",
  GUARANTEED_DEFENDER_ELIMINATION: "guaranteed_defender_elimination",
  SEALED_RETREAT_ELIMINATION: "sealed_retreat_elimination",
  OPPORTUNITY_DE: "direct_elimination_chance",
  ALLOWS_OPPONENT_IMMEDIATE_WIN: "allows_opponent_immediate_win",
});

const OPPOSITE_SIDE = Object.freeze({ axis: "allied", allied: "axis" });

export function filterImmediateMovementTacticalActions(actions = [], options = {}) {
  const side = options.side;
  const destinationHexIds = side === "axis"
    ? options.axisObjectiveHexIds
    : side === "allied"
      ? options.alliedExitHexIds
      : [];
  const destinations = new Set(destinationHexIds || []);
  if (!destinations.size) return [];

  return actions.filter((action) => (
    action?.type === ENV_ACTION.MOVE_UNIT
    && destinations.has(action.toHexId)
    && (side !== "allied" || Number(action.route?.remaining || 0) > 0)
  ));
}

export function findImmediateTacticalAction(environment, actions = null, options = {}) {
  const side = options.side || activeSide(environment);
  const candidates = actions || generateLegalActions(environment, { includeChanceActions: true });
  let best = null;
  for (const action of candidates) {
    const evaluation = evaluateImmediateTacticalAction(environment, action, { ...options, side });
    if (!evaluation || evaluation.score <= 0) continue;
    if (!best || evaluation.score > best.score) best = evaluation;
  }
  return best;
}

export function evaluateImmediateTacticalAction(environment, action, options = {}) {
  const side = options.side || activeSide(environment);
  if (!action || !side) return null;

  const applied = applyEnvironmentAction(environment, action);
  if (!applied.ok) return null;

  if (applied.state.winner?.side === side) {
    return {
      action,
      reason: TACTICAL_REASON.DIRECT_WIN,
      score: 10000,
      result: applied.state.winner,
    };
  }

  if (side === "axis" && isAxisObjectivePendingWin(applied.environment, action)) {
    return {
      action,
      reason: TACTICAL_REASON.AXIS_OBJECTIVE_PENDING,
      score: 8600 + axisObjectiveActionFit(environment, action),
      result: evaluateAxisObjectiveVictory(environmentContext(applied.environment)),
    };
  }

  if (action.type === ENV_ACTION.DECLARE_COMBAT) {
    const profile = combatEliminationProfile(environment, action);
    if (!profile) return null;
    if (profile.guaranteedDefenderElimination) {
      return {
        action,
        reason: TACTICAL_REASON.GUARANTEED_DEFENDER_ELIMINATION,
        score: 7900 + profile.targetValue * 8 - profile.attackerAdverseRolls * 120,
        profile,
      };
    }
    if (profile.sealedRetreatRolls > 0 && profile.defenderEliminationRolls >= profile.attackerAdverseRolls) {
      return {
        action,
        reason: TACTICAL_REASON.SEALED_RETREAT_ELIMINATION,
        score: 6100 + profile.sealedRetreatRolls * 280 + profile.directDefenderEliminationRolls * 160 + profile.targetValue * 7 - profile.attackerAdverseRolls * 140,
        profile,
      };
    }
    if (profile.directDefenderEliminationRolls >= 3 && profile.attackerAdverseRolls === 0) {
      return {
        action,
        reason: TACTICAL_REASON.OPPORTUNITY_DE,
        score: 1800 + profile.directDefenderEliminationRolls * 180 + profile.targetValue * 4,
        profile,
      };
    }
  }

  return null;
}

export function actionAllowsOpponentImmediateWin(environment, action, options = {}) {
  const side = options.side || activeSide(environment);
  const opponent = OPPOSITE_SIDE[side];
  if (!opponent) return false;
  const applied = applyEnvironmentAction(environment, action);
  if (!applied.ok) return false;
  if (applied.state.winner) return applied.state.winner.side === opponent;
  if (activeSide(applied.environment) !== opponent) return false;
  return Boolean(findImmediateWinningAction(applied.environment, opponent));
}

export function findImmediateWinningAction(environment, side = activeSide(environment), actions = null) {
  const candidates = actions || generateLegalActions(environment, { includeChanceActions: true });
  for (const action of candidates) {
    const applied = applyEnvironmentAction(environment, action);
    if (applied.ok && applied.state.winner?.side === side) {
      return { action, winner: applied.state.winner };
    }
  }
  return null;
}

export function combatEliminationProfile(environment, action) {
  if (action?.type !== ENV_ACTION.DECLARE_COMBAT) return null;
  const context = environmentContext(environment);
  const defender = unitById(environment.state.units, action.defenderId);
  const attackers = (action.attackerIds || []).map((id) => unitById(environment.state.units, id)).filter(Boolean);
  if (!defender || !attackers.length) return null;

  const odds = calculateOdds(context, attackers, defender);
  let directDefenderEliminationRolls = 0;
  let sealedRetreatRolls = 0;
  let attackerEliminationRolls = 0;
  let attackerRetreatRolls = 0;
  let ownNoRetreatOnArRolls = 0;

  for (let dieRoll = 1; dieRoll <= 6; dieRoll += 1) {
    const result = environment.rules.crt.rows[String(dieRoll)][odds.columnIndex];
    if (result === "DE") {
      directDefenderEliminationRolls += 1;
      continue;
    }
    if (result === "AE") {
      attackerEliminationRolls += 1;
      continue;
    }
    if (result === "AR") {
      attackerRetreatRolls += 1;
      if (attackers.some((attacker) => getLegalRetreatPaths(context, attacker, 1, attacker.hexId).size === 0)) {
        ownNoRetreatOnArRolls += 1;
      }
      continue;
    }
    const retreat = result.match(/^DR(\d+)$/);
    if (retreat && getLegalRetreatPaths(context, defender, Number(retreat[1]), defender.hexId).size === 0) {
      sealedRetreatRolls += 1;
    }
  }

  const defenderEliminationRolls = directDefenderEliminationRolls + sealedRetreatRolls;
  return {
    defenderId: defender.id,
    attackerIds: attackers.map((unit) => unit.id),
    odds,
    directDefenderEliminationRolls,
    sealedRetreatRolls,
    defenderEliminationRolls,
    guaranteedDefenderElimination: defenderEliminationRolls === 6,
    attackerEliminationRolls,
    attackerRetreatRolls,
    ownNoRetreatOnArRolls,
    attackerAdverseRolls: attackerEliminationRolls + attackerRetreatRolls + ownNoRetreatOnArRolls,
    targetValue: Number(defender.combat || 0) * 3 + Number(defender.movement || 0),
  };
}

function isAxisObjectivePendingWin(environment, action) {
  if (![ENV_ACTION.MOVE_UNIT, ENV_ACTION.ADVANCE_UNIT].includes(action.type)) return false;
  return Boolean(evaluateAxisObjectiveVictory(environmentContext(environment)));
}

function axisObjectiveActionFit(environment, action) {
  const unit = unitById(environment.state.units, action.unitId);
  if (!unit) return 0;
  return Number(unit.combat || 0) * 18 + Number(unit.movement || 0) * 8;
}
