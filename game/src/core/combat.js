import { neighborsOf } from "./board.js";
import { unitById } from "./units.js";

/**
 * Checks whether one attacker can be assigned to attack one defender.
 *
 * This covers adjacency, side ownership, disruption, active side, and previous
 * use in the current combat declaration batch. Odds calculation is separate.
 *
 * @param {{board: object, activeSide?: string, usedAttackers?: string[], usedDefenders?: string[]}} context Core rule context.
 * @param {object|null} attacker Candidate attacking unit.
 * @param {object|null} defender Candidate defending unit.
 * @param {object} options Optional active side and already-used unit overrides.
 * @returns {boolean}
 */
export function canAttack(context, attacker, defender, options = {}) {
  const activeSide = options.activeSide ?? context.activeSide ?? null;
  const usedAttackers = options.usedAttackers ?? context.usedAttackers ?? [];
  const usedDefenders = options.usedDefenders ?? context.usedDefenders ?? [];

  if (!attacker || !defender) return false;
  if (activeSide && attacker.side !== activeSide) return false;
  if (attacker.side === defender.side) return false;
  if (attacker.disrupted || defender.disrupted) return false;
  if (usedAttackers.includes(attacker.id) || usedDefenders.includes(defender.id)) return false;
  return neighborsOf(context.board, attacker.hexId).includes(defender.hexId);
}

/**
 * Calculates effective defense strength and the modifiers that produced it.
 *
 * British position defense applies only to the configured side. When the rules
 * say it does not stack with highland, this function keeps the stronger single
 * multiplier instead of multiplying both.
 *
 * @param {{board: object, rules: object}} context Core rule context.
 * @param {object} unit Defending unit.
 * @returns {{base: number, multiplier: number, total: number, effects: object[]}}
 */
export function defenseBreakdown(context, unit) {
  const hex = context.board.hexById.get(unit.hexId);
  const terrain = context.rules.terrain[hex?.terrain] || context.rules.terrain.desert;
  const terrainMultiplier = Number(terrain.defenseMultiplier || 1);
  const effects = [];
  let multiplier = terrainMultiplier;
  if (terrainMultiplier > 1) effects.push({ type: "terrain", key: hex?.terrain, multiplier: terrainMultiplier });

  const positionRule = context.rules.britishPosition;
  if (hex?.britishPosition && unit.side === positionRule.appliesOnlyToSide) {
    const positionMultiplier = Number(positionRule.defenseMultiplier || 1);
    if (positionRule.stacksWithHighland) {
      multiplier *= positionMultiplier;
      effects.push({ type: "britishPosition", multiplier: positionMultiplier });
    } else if (positionMultiplier > multiplier) {
      multiplier = positionMultiplier;
      effects.length = 0;
      effects.push({ type: "britishPosition", multiplier: positionMultiplier });
    } else if (positionMultiplier > 1 && terrainMultiplier <= 1) {
      multiplier = Math.max(multiplier, positionMultiplier);
      effects.push({ type: "britishPosition", multiplier: positionMultiplier });
    }
  }

  return {
    base: unit.combat,
    multiplier,
    total: unit.combat * multiplier,
    effects,
  };
}

/**
 * Maps attack and effective defense strength to a CRT odds column.
 *
 * The returned `columnIndex` is what the CRT row lookup should use after an
 * injected die roll. This function does not roll dice and does not apply CRT results.
 *
 * @param {{rules: object}} context Core rule context.
 * @param {object[]} attackers Attacking units committed to one battle.
 * @param {object} defender Defending unit.
 * @returns {{attack: number, defense: number, defenseInfo: object, ratio: number, columnIndex: number, column: string}}
 */
export function calculateOdds(context, attackers, defender) {
  const attack = attackers.reduce((sum, unit) => sum + unit.combat, 0);
  const defenseInfo = defenseBreakdown(context, defender);
  const defense = defenseInfo.total;
  const ratio = attack / Math.max(1, defense);
  const thresholds = [0.5, 1, 2, 3, 4, 5, 6];
  let columnIndex = 0;

  for (let index = 0; index < thresholds.length; index += 1) {
    if (ratio >= thresholds[index]) columnIndex = index;
  }

  return {
    attack,
    defense,
    defenseInfo,
    ratio,
    columnIndex,
    column: context.rules.crt.columns[columnIndex],
  };
}

function liveUnitIds(units, unitIds) {
  return unitIds.filter((id) => {
    const unit = unitById(units, id);
    return unit && !unit.eliminated;
  });
}

function emptyCombatResultPlan(result) {
  return {
    result,
    eliminatedUnitIds: [],
    retreatTask: null,
    resolveBattle: false,
    archiveBattle: false,
    startAdvance: false,
  };
}

/**
 * Converts a CRT result code into an event-ready combat result plan.
 *
 * The plan is intentionally side-effect free: it does not eliminate units,
 * create UI tasks, write logs, roll dice, or mutate the battle. App code should
 * execute this plan and emit user-facing text or replay events.
 *
 * @param {{units: object[]}} context Core rule context.
 * @param {object} battle Declared battle record.
 * @param {string} result CRT result code, such as "AE", "DE", "AR", or "DR2".
 * @returns {{result: string, eliminatedUnitIds: string[], retreatTask: object|null, resolveBattle: boolean, archiveBattle: boolean, startAdvance: boolean}}
 */
export function planCombatResult(context, battle, result) {
  const plan = emptyCombatResultPlan(result);
  if (!battle) return plan;

  if (result === "AE") {
    return {
      ...plan,
      eliminatedUnitIds: battle.attackerIds.slice(),
      resolveBattle: true,
      archiveBattle: true,
    };
  }

  if (result === "DE") {
    return {
      ...plan,
      eliminatedUnitIds: [battle.defenderId],
      resolveBattle: true,
      archiveBattle: true,
      startAdvance: true,
    };
  }

  if (result === "AR") {
    return {
      ...plan,
      retreatTask: {
        unitIds: liveUnitIds(context.units, battle.attackerIds),
        steps: 1,
        result,
        origins: battle.attackerOrigins || {},
        disruptAfterRetreat: false,
        advanceAfter: false,
      },
    };
  }

  const defenderRetreat = result.match(/^DR(\d+)$/);
  if (defenderRetreat) {
    return {
      ...plan,
      retreatTask: {
        unitIds: liveUnitIds(context.units, [battle.defenderId]),
        steps: Number(defenderRetreat[1]),
        result,
        origins: { [battle.defenderId]: battle.defenderHexId },
        disruptAfterRetreat: true,
        advanceAfter: true,
      },
    };
  }

  return plan;
}
