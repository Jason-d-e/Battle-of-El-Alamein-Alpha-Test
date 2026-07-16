/**
 * Filters out eliminated units without changing the original unit array.
 *
 * @param {object[]} units Current scenario units.
 * @returns {object[]} Non-eliminated units.
 */
export function liveUnits(units) {
  return (units || []).filter((unit) => !unit.eliminated);
}

/**
 * Finds the first non-eliminated unit occupying a hex.
 *
 * @param {object[]} units Current scenario units.
 * @param {string} hexId Scenario hex ID.
 * @returns {object|null}
 */
export function liveUnitAt(units, hexId) {
  return liveUnits(units).find((unit) => unit.hexId === hexId) || null;
}

/**
 * Finds a unit by ID, including eliminated units.
 *
 * @param {object[]} units Current scenario units.
 * @param {string} unitId Scenario unit ID.
 * @returns {object|null}
 */
export function unitById(units, unitId) {
  return (units || []).find((unit) => unit.id === unitId) || null;
}

/**
 * Accepts either a unit object or a unit ID for public core APIs.
 *
 * @param {object[]} units Current scenario units.
 * @param {object|string|null} unitOrId Unit object or unit ID.
 * @returns {object|null}
 */
export function resolveUnit(units, unitOrId) {
  return typeof unitOrId === "string" ? unitById(units, unitOrId) : unitOrId;
}
