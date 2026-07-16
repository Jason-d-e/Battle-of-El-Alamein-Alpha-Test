/**
 * Returns true only when the phase being ended is the final phase of a full turn.
 *
 * Victory checks that belong to "end of turn" rules should use this gate instead
 * of being attached to movement, retreat, or advance side effects.
 *
 * @param {{phaseIndex: number, phases: object[]}} state Phase state.
 * @returns {boolean}
 */
export function shouldCheckAxisObjectiveVictoryAtPhaseEnd(state) {
  const phases = Array.isArray(state?.phases) ? state.phases : [];
  if (!phases.length) return false;
  return Number(state?.phaseIndex) === phases.length - 1;
}
