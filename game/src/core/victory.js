import { neighborsOf } from "./board.js";
import { movementAllowance } from "./movement.js";
import { liveUnitAt, liveUnits } from "./units.js";

const EL_ALAMEIN_HEX_ID = "c12r03";

function objectivesFrom(context) {
  return context?.scenario?.objectives || context?.objectives || {};
}

function objectiveHexes(context, key) {
  return objectivesFrom(context)[key] || [];
}

function isSideZoc(context, hexId, side, ignoreUnitId = null) {
  const { board, units } = context;

  return liveUnits(units).some((unit) => {
    if (unit.id === ignoreUnitId) return false;
    if (unit.side !== side) return false;
    if (unit.disrupted) return false;
    return neighborsOf(board, unit.hexId).includes(hexId);
  });
}

/**
 * Summarizes objective control for victory checks and AAR presentation.
 *
 * Ridge full control follows the existing UI rule: at least one ridge hex must
 * be occupied by Axis, and every ridge hex must be Axis-occupied or in Axis ZOC.
 *
 * @param {{board: object, scenario?: object, objectives?: object, units: object[]}} context Core rule context.
 * @returns {object} Objective counts, occupied hex IDs, and control booleans.
 */
export function getObjectiveStatus(context) {
  const axisUnits = liveUnits(context.units).filter((unit) => unit.side === "axis");
  const ridgeHexes = objectiveHexes(context, "alamHalfaRidge");
  const roadHexes = objectiveHexes(context, "coastalRoadEast");
  const ridge = new Set(ridgeHexes);
  const road = new Set(roadHexes);
  const ridgeOccupiedHexes = axisUnits.filter((unit) => ridge.has(unit.hexId)).map((unit) => unit.hexId);
  const ridgeStates = ridgeHexes.map((hexId) => {
    const occupant = liveUnitAt(context.units, hexId);
    return {
      hexId,
      occupantSide: occupant?.side || null,
      axisZoc: isSideZoc(context, hexId, "axis"),
    };
  });
  const ridgeControl = ridgeStates.some((item) => item.occupantSide === "axis");
  const ridgeFullControl = ridgeControl && ridgeStates.every((item) => {
    if (item.occupantSide === "axis") return true;
    if (item.occupantSide === "allied") return false;
    return item.axisZoc;
  });
  const roadOccupiedHexes = axisUnits.filter((unit) => road.has(unit.hexId)).map((unit) => unit.hexId);
  const elAlameinOccupied = roadOccupiedHexes.includes(EL_ALAMEIN_HEX_ID);
  const roadCut = roadOccupiedHexes.some((hexId) => hexId !== EL_ALAMEIN_HEX_ID);

  return {
    ridgeOccupiedHexes,
    ridgeOccupied: ridgeOccupiedHexes.length,
    ridgeTotal: ridge.size,
    ridgeStates,
    ridgeControl,
    ridgeFullControl,
    roadOccupiedHexes,
    roadOccupied: roadOccupiedHexes.length,
    elAlameinOccupied,
    roadCut,
  };
}

/**
 * Evaluates Axis automatic objective victory at the end of a full turn.
 *
 * The first live Axis unit found on Alam Halfa Ridge wins before coastal road
 * objectives, matching the original `game.js` priority.
 *
 * @param {{scenario?: object, objectives?: object, units: object[]}} context Core rule context.
 * @returns {{side: "axis", reason: "ridge"|"road", unitId: string, hexId: string, type: null}|null}
 */
export function evaluateAxisObjectiveVictory(context) {
  const axisUnits = liveUnits(context.units).filter((unit) => unit.side === "axis");
  const ridge = new Set(objectiveHexes(context, "alamHalfaRidge"));
  const road = new Set(objectiveHexes(context, "coastalRoadEast"));
  const ridgeUnit = axisUnits.find((unit) => ridge.has(unit.hexId));
  if (ridgeUnit) {
    return { side: "axis", reason: "ridge", unitId: ridgeUnit.id, hexId: ridgeUnit.hexId, type: null };
  }
  const roadUnit = axisUnits.find((unit) => road.has(unit.hexId));
  if (roadUnit) {
    return { side: "axis", reason: "road", unitId: roadUnit.id, hexId: roadUnit.hexId, type: null };
  }
  return null;
}

/**
 * Evaluates Allied west-edge breakthrough for units that are already on an
 * exit hex during their movement phase. A unit that has not moved yet still
 * has movement available to leave the map from that edge hex.
 *
 * @param {{rules: object, scenario?: object, objectives?: object, units: object[], state: object}} context Core rule context.
 * @param {string[]} movedUnitIds Unit IDs that already spent movement this phase.
 * @returns {{side: "allied", reason: "breakthrough", unitId: string, hexId: string, type: "allied-breakthrough"}|null}
 */
export function evaluateAlliedBreakthroughVictory(context, movedUnitIds = []) {
  const moved = new Set(movedUnitIds || []);
  const exit = new Set(objectiveHexes(context, "alliedWestExitEdge"));
  const unit = liveUnits(context.units).find((candidate) => (
    candidate.side === "allied"
    && !candidate.disrupted
    && !moved.has(candidate.id)
    && exit.has(candidate.hexId)
    && movementAllowance(context.state, candidate, context.rules) > 0
  ));
  if (!unit) return null;
  return { side: "allied", reason: "breakthrough", unitId: unit.id, hexId: unit.hexId, type: "allied-breakthrough" };
}

/**
 * Checks the Allied west-edge breakthrough victory condition after movement.
 * If the unit reaches an exit-edge hex with movement remaining, it has enough
 * movement left to leave the map from that edge hex.
 *
 * @param {{board: object, scenario?: object, objectives?: object, units: object[]}} context Core rule context.
 * @param {object} unit Moving unit.
 * @param {string} destinationHexId Move destination.
 * @param {number} remainingMovement Movement points left after entering the destination.
 * @returns {boolean}
 */
export function isAlliedBreakthroughMove(context, unit, destinationHexId, remainingMovement) {
  if (unit?.side !== "allied") return false;
  if (Number(remainingMovement || 0) <= 0) return false;
  if (!objectiveHexes(context, "alliedWestExitEdge").includes(destinationHexId)) return false;
  return true;
}
