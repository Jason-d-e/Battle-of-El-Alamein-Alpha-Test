import { hexDistance, neighborsOf } from "./board.js";
import { terrainRule } from "./terrain.js";
import { isEnemyZoc } from "./zoc.js";
import { liveUnitAt, resolveUnit } from "./units.js";

/**
 * Finds legal retreat destinations and the paths used to reach them.
 *
 * Retreats must move farther from the combat origin each step, avoid enemy ZOC,
 * avoid enemy-occupied hexes, and enter only passable terrain. Passing through
 * friendly units extends the required retreat until the unit can stop in an
 * unoccupied friendly-legal hex.
 *
 * @param {{board: object, rules: object, units: object[]}} context Core rule context.
 * @param {object|string} unitOrId Retreating unit object or unit ID.
 * @param {number} requiredSteps Required retreat distance from the combat result.
 * @param {string} originHexId Hex the retreat must move away from.
 * @returns {Map<string, string[]>} Destination hex IDs to full retreat paths.
 */
export function getLegalRetreatPaths(context, unitOrId, requiredSteps, originHexId) {
  const { board, rules, units } = context;
  const unit = resolveUnit(units, unitOrId);
  if (!unit) return new Map();

  const result = new Map();
  const maxSteps = Math.min(board.hexes.length, requiredSteps + 18);
  const seen = new Set();
  const queue = [{ hexId: unit.hexId, steps: 0, requiredSteps, path: [unit.hexId] }];

  while (queue.length) {
    const current = queue.shift();
    const key = `${current.hexId}:${current.steps}:${current.requiredSteps}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const currentDistance = hexDistance(board, current.hexId, originHexId);
    if (current.steps >= maxSteps) continue;

    for (const nextId of neighborsOf(board, current.hexId)) {
      const nextHex = board.hexById.get(nextId);
      if (!terrainRule(rules, nextHex).passable) continue;

      const occupant = liveUnitAt(units, nextId);
      if (occupant && occupant.side !== unit.side) continue;
      if (isEnemyZoc(context, nextId, unit.side, unit.id)) continue;
      if (hexDistance(board, nextId, originHexId) <= currentDistance) continue;

      const nextSteps = current.steps + 1;
      const friendlyOccupied = occupant && occupant.id !== unit.id && occupant.side === unit.side;
      const nextPath = current.path.concat(nextId);
      let nextRequiredSteps = current.requiredSteps;
      if (nextSteps >= nextRequiredSteps && friendlyOccupied) nextRequiredSteps += 1;
      if (nextSteps >= nextRequiredSteps && !friendlyOccupied) {
        if (!result.has(nextId)) result.set(nextId, nextPath);
        continue;
      }

      queue.push({ hexId: nextId, steps: nextSteps, requiredSteps: nextRequiredSteps, path: nextPath });
    }
  }

  return result;
}

/**
 * Returns only the destination IDs from getLegalRetreatPaths.
 *
 * @param {{board: object, rules: object, units: object[]}} context Core rule context.
 * @param {object|string} unitOrId Retreating unit object or unit ID.
 * @param {number} requiredSteps Required retreat distance from the combat result.
 * @param {string} originHexId Hex the retreat must move away from.
 * @returns {Set<string>}
 */
export function getLegalRetreatDestinations(context, unitOrId, requiredSteps, originHexId) {
  return new Set(getLegalRetreatPaths(context, unitOrId, requiredSteps, originHexId).keys());
}
