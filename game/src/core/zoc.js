import { neighborsOf } from "./board.js";
import { liveUnits } from "./units.js";

/**
 * Reports whether a hex is in an enemy zone of control.
 *
 * Disrupted units do not project ZOC. `ignoreUnitId` lets movement and retreat
 * checks evaluate the moving unit's own hex without treating itself as an occupant.
 *
 * @param {{board: object, units: object[]}} context Core rule context.
 * @param {string} hexId Hex being tested.
 * @param {string} friendlySide Side checking for enemy ZOC.
 * @param {string|null} ignoreUnitId Unit ID to ignore while checking.
 * @returns {boolean}
 */
export function isEnemyZoc(context, hexId, friendlySide, ignoreUnitId = null) {
  const { board, units } = context;

  return liveUnits(units).some((unit) => {
    if (unit.id === ignoreUnitId) return false;
    if (unit.side === friendlySide) return false;
    if (unit.disrupted) return false;
    return neighborsOf(board, unit.hexId).includes(hexId);
  });
}
