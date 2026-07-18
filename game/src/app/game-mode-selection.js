export const MENU_GAME_MODE = Object.freeze({
  AXIS_VS_AI: "axis-vs-ai",
  ALLIED_VS_AI: "allied-vs-ai",
  HOTSEAT: "hotseat",
  ONLINE: "online",
});

const OFFLINE_GAME_MODES = Object.freeze([
  MENU_GAME_MODE.AXIS_VS_AI,
  MENU_GAME_MODE.ALLIED_VS_AI,
  MENU_GAME_MODE.HOTSEAT,
]);

const ALL_GAME_MODES = Object.freeze([
  ...OFFLINE_GAME_MODES,
  MENU_GAME_MODE.ONLINE,
]);

export function resolveSelectedMenuGameMode({ offlineMode, onlineSelected = false } = {}) {
  if (onlineSelected) return MENU_GAME_MODE.ONLINE;
  return OFFLINE_GAME_MODES.includes(offlineMode)
    ? offlineMode
    : MENU_GAME_MODE.AXIS_VS_AI;
}

export function createMenuGameModeSelection(options = {}) {
  const selectedMode = resolveSelectedMenuGameMode(options);
  return Object.freeze(Object.fromEntries(
    ALL_GAME_MODES.map((mode) => [mode, mode === selectedMode]),
  ));
}

export function createMenuActionState({
  onlineSelected = false,
  hasContinuation = false,
  hasSave = false,
} = {}) {
  return Object.freeze({
    startDisabled: Boolean(onlineSelected),
    continueDisabled: Boolean(onlineSelected) || !hasContinuation,
    loadDisabled: Boolean(onlineSelected) || !hasSave,
  });
}
