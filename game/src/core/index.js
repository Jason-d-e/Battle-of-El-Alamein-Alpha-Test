export { createBoard, getHex, hexDistance, neighborsOf } from "./board.js";
export { terrainRule, isPassableTerrain } from "./terrain.js";
export { liveUnitAt, liveUnits, resolveUnit, unitById } from "./units.js";
export { isEnemyZoc } from "./zoc.js";
export { getReachableHexes, movementAllowance } from "./movement.js";
export { getLegalRetreatDestinations, getLegalRetreatPaths } from "./retreat.js";
export { calculateOdds, canAttack, defenseBreakdown, planCombatResult } from "./combat.js";
export { shouldCheckAxisObjectiveVictoryAtPhaseEnd } from "./phases.js";
export { evaluateAlliedBreakthroughVictory, evaluateAxisObjectiveVictory, getObjectiveStatus, isAlliedBreakthroughMove } from "./victory.js";
export {
  ENV_ACTION,
  ENV_EVENT,
  activeSide,
  applyEnvironmentAction,
  cloneGameState,
  compactAction,
  createEnvironment,
  currentPhase,
  environmentContext,
  environmentMetrics,
  evaluateEnvironmentVictory,
  generateLegalActions,
  makeInitialEnvironmentState,
  restorePreviousState,
  stateHash,
  stateHashForState,
} from "./environment.js";
