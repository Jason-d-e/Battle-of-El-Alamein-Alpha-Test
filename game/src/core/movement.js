import { neighborsOf } from "./board.js";
import { terrainRule } from "./terrain.js";
import { liveUnits, resolveUnit } from "./units.js";

/**
 * Calculates the unit movement allowance after scenario-wide modifiers.
 *
 * The first-turn Allied reduction is a rule-level modifier, so callers should
 * use this helper instead of reading `unit.movement` directly.
 *
 * @param {object} state Current game state.
 * @param {object} unit Moving unit.
 * @param {object} rules Loaded rules JSON.
 * @returns {number}
 */
export function movementAllowance(state, unit, rules) {
  let movement = Number(unit?.movement || 0);
  if (unit?.side === "allied" && state?.turn === 1) {
    movement = Math.max(1, Math.floor(movement * Number(rules?.firstTurnAlliedMovementMultiplier || 1)));
  }
  return movement;
}

/**
 * Finds legal movement destinations for one unit.
 *
 * Enforces passable terrain, enemy occupation blocking, and El Alamein ZOC
 * restrictions. A unit may leave enemy ZOC, but no individual movement step may
 * go directly from one enemy ZOC hex into another enemy ZOC hex.
 *
 * @param {{board: object, rules: object, units: object[], state: object}} context Core rule context.
 * @param {object|string} unitOrId Moving unit object or unit ID.
 * @param {number|null} allowance Optional movement allowance override for tests and previews.
 * @returns {Map<string, {spent: number, remaining: number, path: string[]}>} Destination hex IDs to route data.
 */
export function getReachableHexes(context, unitOrId, allowance = null) {
  const { board, rules, units, state } = context;
  const unit = resolveUnit(units, unitOrId);
  if (!unit) return new Map();

  const moveAllowance = allowance ?? movementAllowance(state, unit, rules);
  const startHexId = unit.hexId;
  const result = new Map();
  const queue = [{ hexId: startHexId, spent: 0, firstStep: true, path: [startHexId] }];
  const bestSpent = new Map([[startHexId, 0]]);
  const activeUnits = liveUnits(units);
  const occupantByHex = new Map(activeUnits.map((candidate) => [candidate.hexId, candidate]));
  const enemyZocHexes = new Set();
  for (const candidate of activeUnits) {
    if (candidate.side === unit.side || candidate.disrupted) continue;
    for (const hexId of neighborsOf(board, candidate.hexId)) enemyZocHexes.add(hexId);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentInZoc = enemyZocHexes.has(current.hexId);
    if (!current.firstStep && currentInZoc) continue;

    for (const nextId of neighborsOf(board, current.hexId)) {
      const nextHex = board.hexById.get(nextId);
      const rule = terrainRule(rules, nextHex);
      if (!rule.passable) continue;

      const occupant = occupantByHex.get(nextId) || null;
      if (occupant && occupant.side !== unit.side) continue;

      const nextInZoc = enemyZocHexes.has(nextId);
      if (currentInZoc && nextInZoc) continue;

      const spent = current.spent + Number(rule.movement || 1);
      if (spent > moveAllowance) continue;
      if (bestSpent.has(nextId) && bestSpent.get(nextId) <= spent) continue;

      bestSpent.set(nextId, spent);
      const remaining = moveAllowance - spent;
      const path = current.path.concat(nextId);
      if (!occupant || occupant.id === unit.id) result.set(nextId, { spent, remaining, path });
      queue.push({ hexId: nextId, spent, firstStep: false, path });
    }
  }

  result.delete(startHexId);
  return result;
}
