/**
 * Reports whether a player-triggered phase end needs confirmation because the
 * current movement phase contains no completed moves.
 *
 * This is an app/UI guard only. It does not change core END_PHASE legality, so
 * AI search, replay, and deterministic environment transitions remain intact.
 *
 * @param {{phase?: {type?: string}|null, movedUnits?: string[]}} context Phase state.
 * @returns {boolean}
 */
export function shouldConfirmEmptyMovementPhaseEnd({ phase = null, movedUnits = [] } = {}) {
  return phase?.type === "movement"
    && (!Array.isArray(movedUnits) || movedUnits.length === 0);
}
