import {
  ENV_ACTION,
  activeSide,
  applyEnvironmentAction,
  compactAction,
  createEnvironment,
  currentPhase,
  generateLegalActions,
  stateHash,
} from "../core/environment.js";
import {
  ENVIRONMENT_CONTRACT_VERSION,
  NODE_KIND,
  canonicalSerialize,
} from "../../../shared/wargame-alpha/environment-contract.js";
import { alphaModelEnvironmentFingerprint } from "./ai-alpha-model.js";

export const EL_ALAMEIN_ALPHA_ENVIRONMENT_ADAPTER_FINGERPRINT =
  "el-alamein-alpha-environment-adapter/semantic-v2";

const PLAYERS = Object.freeze(["axis", "allied"]);
const QUIET_APPLY_OPTIONS = Object.freeze({
  mutate: false,
  enrichEvents: false,
  previousState: false,
  cloneResultState: false,
});

function boardGameplayFingerprint(board) {
  const hexes = (board?.hexes || [])
    .map((hex) => ({
      id: hex?.id ?? null,
      col: Number.isFinite(hex?.col) ? Number(hex.col) : null,
      row: Number.isFinite(hex?.row) ? Number(hex.row) : null,
      terrain: hex?.terrain ?? null,
      road: Boolean(hex?.road),
      britishPosition: Boolean(hex?.britishPosition),
      objective: Array.isArray(hex?.objective) ? hex.objective.map(String).sort() : [],
    }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const serialized = canonicalSerialize(hexes, "El Alamein board hexes");
  let hash = 2166136261;
  for (const character of serialized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createElAlameinAlphaEnvironmentAdapter({ scenario, rules, board = null, instrumentation = null }) {
  const boundEnvironment = createEnvironment({ scenario, rules, board });
  const gameplayEnvironment = alphaModelEnvironmentFingerprint({ scenario, rules });
  if (!gameplayEnvironment?.fingerprint) {
    throw new TypeError("El Alamein scenario and rules must produce a gameplay fingerprint");
  }
  const boardFingerprint = boardGameplayFingerprint(boundEnvironment.board);

  function environmentForState(state) {
    return createEnvironment({
      scenario: boundEnvironment.scenario,
      rules: boundEnvironment.rules,
      board: boundEnvironment.board,
      state,
    });
  }

  function coreActions(state) {
    const generate = () => generateLegalActions(environmentForState(state), { includeChanceActions: true });
    return typeof instrumentation?.measure === "function"
      ? instrumentation.measure("legalActionGeneration", generate)
      : generate();
  }

  function chanceActions(state) {
    const actions = coreActions(state);
    if (actions.length !== 6 || actions.some((action) => (
      action.type !== ENV_ACTION.RESOLVE_COMBAT
      || !Number.isInteger(action.dieRoll)
    ))) return [];

    const rolls = actions.map((action) => action.dieRoll).sort((left, right) => left - right);
    if (!rolls.every((roll, index) => roll === index + 1)) return [];
    const battleId = actions[0].battleId;
    return actions.every((action) => action.battleId === battleId)
      ? actions.slice().sort((left, right) => left.dieRoll - right.dieRoll)
      : [];
  }

  function nodeKind(state) {
    if (state.winner) return NODE_KIND.TERMINAL;
    return chanceActions(state).length === 6 ? NODE_KIND.CHANCE : NODE_KIND.DECISION;
  }

  function applyCoreAction(state, action) {
    const result = applyEnvironmentAction(
      environmentForState(state),
      action,
      QUIET_APPLY_OPTIONS,
    );
    if (!result.ok) {
      throw new Error(`El Alamein environment rejected an adapter action: ${result.reason}`);
    }
    return result.state;
  }

  return Object.freeze({
    contractVersion: ENVIRONMENT_CONTRACT_VERSION,
    adapterId: "el-alamein",
    adapterFingerprint: EL_ALAMEIN_ALPHA_ENVIRONMENT_ADAPTER_FINGERPRINT,
    gameplayFingerprint: `${gameplayEnvironment.fingerprint}|board:${boardFingerprint}`,
    players: PLAYERS,

    nodeKind,

    currentPlayer(state) {
      if (nodeKind(state) !== NODE_KIND.DECISION) return null;
      return state.retreatTask?.controllerSide || activeSide(environmentForState(state));
    },

    legalActions(state) {
      if (nodeKind(state) !== NODE_KIND.DECISION) return [];
      return coreActions(state).map((action) => ({
        key: compactAction(action),
        action: compactAction(action),
      }));
    },

    applyAction(state, action) {
      return applyCoreAction(state, action);
    },

    chanceOutcomes(state) {
      return chanceActions(state).map((action) => ({
        key: { dieRoll: action.dieRoll },
        probability: 1 / 6,
        outcome: compactAction(action),
      }));
    },

    applyChance(state, outcome) {
      return applyCoreAction(state, outcome);
    },

    terminalResult(state) {
      if (!state.winner) return null;
      const winnerId = state.winner.side;
      if (!PLAYERS.includes(winnerId)) {
        throw new Error(`Unsupported El Alamein terminal winner: ${String(winnerId)}`);
      }
      return {
        winnerId,
        payoffs: PLAYERS.map((playerId) => ({
          playerId,
          value: playerId === winnerId ? 1 : -1,
        })),
      };
    },

    stateHash(state) {
      return stateHash(environmentForState(state));
    },

    metadata(state) {
      const environment = environmentForState(state);
      return {
        turn: state.turn,
        phase: currentPhase(environment)?.id || null,
        activeSide: activeSide(environment),
        pendingTask: state.retreatTask
          ? "retreat"
          : state.advanceTask
            ? "advance"
            : null,
        boardFingerprint,
      };
    },
  });
}
