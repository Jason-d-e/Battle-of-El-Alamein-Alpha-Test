export const ENVIRONMENT_CONTRACT_VERSION = "wargame-alpha-environment/v1";
export const CHANCE_PROBABILITY_TOLERANCE = 1e-12;

export const NODE_KIND = Object.freeze({
  DECISION: "decision",
  CHANCE: "chance",
  TERMINAL: "terminal",
});

const REQUIRED_METHODS = Object.freeze([
  "nodeKind",
  "currentPlayer",
  "legalActions",
  "applyAction",
  "chanceOutcomes",
  "applyChance",
  "terminalResult",
  "stateHash",
]);

const VALIDATED_LEGAL_ENTRY_SIGNATURES = new WeakMap();
const VALIDATED_DECISION_NODE_BINDINGS = new WeakMap();

export class EnvironmentContractError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "EnvironmentContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new EnvironmentContractError(code, message);
}

function measureDiagnostic(instrumentation, stage, operation) {
  return typeof instrumentation?.measure === "function"
    ? instrumentation.measure(stage, operation)
    : operation();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalSerialize(value, label = "value") {
  const active = new Set();

  function visit(current, path) {
    if (current === null) return "null";

    const type = typeof current;
    if (type === "string" || type === "boolean") return JSON.stringify(current);
    if (type === "number") {
      if (!Number.isFinite(current)) fail("NOT_SERIALIZABLE", `${path} must contain only finite numbers`);
      return Object.is(current, -0) ? "0" : JSON.stringify(current);
    }
    if (type !== "object") {
      fail("NOT_SERIALIZABLE", `${path} contains unsupported ${type} data`);
    }
    if (active.has(current)) fail("NOT_SERIALIZABLE", `${path} contains a cycle`);

    active.add(current);
    let serialized;
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) {
          fail("NOT_SERIALIZABLE", `${path} must not contain sparse array entries`);
        }
      }
      serialized = `[${current.map((item, index) => visit(item, `${path}[${index}]`)).join(",")}]`;
    } else {
      if (!isPlainObject(current)) {
        fail("NOT_SERIALIZABLE", `${path} must contain only plain objects and arrays`);
      }
      const keys = Object.keys(current).sort();
      serialized = `{${keys
        .map((key) => `${JSON.stringify(key)}:${visit(current[key], `${path}.${key}`)}`)
        .join(",")}}`;
    }
    active.delete(current);
    return serialized;
  }

  return visit(value, label);
}

function canonicalEqual(left, right) {
  return canonicalSerialize(left, "left value") === canonicalSerialize(right, "right value");
}

function requireIdentifier(value, label) {
  if (value === null) fail("INVALID_IDENTIFIER", `${label} must not be null`);
  canonicalSerialize(value, label);
  return value;
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length === 0) {
    fail("INVALID_PLAYERS", "adapter.players must be a non-empty array");
  }
  const seen = new Set();
  for (let index = 0; index < players.length; index += 1) {
    requireIdentifier(players[index], `adapter.players[${index}]`);
    const key = canonicalSerialize(players[index]);
    if (seen.has(key)) fail("DUPLICATE_PLAYER", `adapter.players contains a duplicate at index ${index}`);
    seen.add(key);
  }
  return players;
}

export function validateEnvironmentAdapter(adapter, { instrumentation = null } = {}) {
  return measureDiagnostic(instrumentation, "adapterStaticValidation", () => {
    if (adapter === null || typeof adapter !== "object") {
      fail("INVALID_ADAPTER", "adapter must be an object");
    }
    if (adapter.contractVersion !== ENVIRONMENT_CONTRACT_VERSION) {
      fail(
        "UNSUPPORTED_CONTRACT_VERSION",
        `adapter.contractVersion must equal ${ENVIRONMENT_CONTRACT_VERSION}`,
      );
    }

    requireIdentifier(adapter.adapterId, "adapter.adapterId");
    for (const field of ["adapterFingerprint", "gameplayFingerprint"]) {
      if (typeof adapter[field] !== "string" || adapter[field].trim() === "") {
        fail("INVALID_FINGERPRINT", `adapter.${field} must be a non-empty string`);
      }
    }
    validatePlayers(adapter.players);

    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== "function") {
        fail("MISSING_ADAPTER_METHOD", `adapter.${method} must be a function`);
      }
    }
    if (adapter.metadata !== undefined && typeof adapter.metadata !== "function") {
      fail("INVALID_METADATA_METHOD", "adapter.metadata must be a function when provided");
    }
    return adapter;
  });
}

function assertInputUnchanged(before, args, label, instrumentation = null) {
  const after = measureDiagnostic(
    instrumentation,
    "methodInputPostCanonicalization",
    () => canonicalSerialize(args, `${label} inputs`),
  );
  if (after !== before) fail("INPUT_MUTATION", `${label} mutated its input data`);
}

function callWithoutMutation(adapter, method, args, { instrumentation = null } = {}) {
  const label = `adapter.${method}`;
  const before = measureDiagnostic(
    instrumentation,
    "methodInputPreCanonicalization",
    () => canonicalSerialize(args, `${label} inputs`),
  );
  const result = adapter[method](...args);
  assertInputUnchanged(before, args, label, instrumentation);
  measureDiagnostic(
    instrumentation,
    method === "legalActions" ? "legalActionsWholeResultSerialization" : "nonLegalMethodResultSerialization",
    () => canonicalSerialize(result, `${label} result`),
  );
  return result;
}

function callDeterministically(adapter, method, args, options) {
  const first = callWithoutMutation(adapter, method, args, options);
  const second = callWithoutMutation(adapter, method, args, options);
  if (!canonicalEqual(first, second)) {
    fail("NONDETERMINISTIC_ADAPTER", `adapter.${method} returned different results for identical inputs`);
  }
  return first;
}

export function validateLegalActions(actions, { instrumentation = null } = {}) {
  if (!Array.isArray(actions)) fail("INVALID_LEGAL_ACTIONS", "legalActions must return an array");
  const seen = new Set();
  for (let index = 0; index < actions.length; index += 1) {
    const entry = actions[index];
    if (!isPlainObject(entry)) {
      fail("INVALID_LEGAL_ACTION", `legalActions[${index}] must be a plain object`);
    }
    if (!Object.prototype.hasOwnProperty.call(entry, "key")) {
      fail("INVALID_LEGAL_ACTION", `legalActions[${index}] must include key`);
    }
    if (!Object.prototype.hasOwnProperty.call(entry, "action")) {
      fail("INVALID_LEGAL_ACTION", `legalActions[${index}] must include action`);
    }
    const signature = measureDiagnostic(
      instrumentation,
      "legalEntrySignatureSerialization",
      () => canonicalSerialize(entry, `legalActions[${index}]`),
    );
    const key = measureDiagnostic(
      instrumentation,
      "legalEntryKeySerializationDuplicateCheck",
      () => canonicalSerialize(entry.key, `legalActions[${index}].key`),
    );
    if (seen.has(key)) fail("DUPLICATE_ACTION_KEY", `legalActions contains duplicate key at index ${index}`);
    seen.add(key);
    VALIDATED_LEGAL_ENTRY_SIGNATURES.set(entry, { key, signature });
  }
  return actions;
}

export function validateChanceOutcomes(outcomes, tolerance = CHANCE_PROBABILITY_TOLERANCE) {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    fail("INVALID_TOLERANCE", "chance probability tolerance must be finite and positive");
  }
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    fail("INVALID_CHANCE_OUTCOMES", "chanceOutcomes must return a non-empty array at a chance node");
  }

  const keys = new Set();
  let previousKey = null;
  let total = 0;
  for (let index = 0; index < outcomes.length; index += 1) {
    const entry = outcomes[index];
    if (!isPlainObject(entry)) {
      fail("INVALID_CHANCE_OUTCOME", `chanceOutcomes[${index}] must be a plain object`);
    }
    if (!Object.prototype.hasOwnProperty.call(entry, "key") ||
        !Object.prototype.hasOwnProperty.call(entry, "outcome")) {
      fail("INVALID_CHANCE_OUTCOME", `chanceOutcomes[${index}] must include key and outcome`);
    }
    canonicalSerialize(entry, `chanceOutcomes[${index}]`);
    const key = canonicalSerialize(entry.key, `chanceOutcomes[${index}].key`);
    if (keys.has(key)) fail("DUPLICATE_CHANCE_KEY", `chanceOutcomes contains duplicate key at index ${index}`);
    if (previousKey !== null && key <= previousKey) {
      fail("UNSORTED_CHANCE_KEYS", "chance outcome keys must be in strictly increasing canonical order");
    }
    keys.add(key);
    previousKey = key;

    if (!Number.isFinite(entry.probability) || entry.probability < 0) {
      fail("INVALID_CHANCE_PROBABILITY", `chanceOutcomes[${index}].probability must be finite and nonnegative`);
    }
    total += entry.probability;
  }

  if (!(total > 0)) fail("EMPTY_CHANCE_DISTRIBUTION", "chance probabilities must have a positive total");
  if (Math.abs(total - 1) > tolerance) {
    fail("CHANCE_PROBABILITY_SUM", `chance probabilities must sum to 1 within tolerance ${tolerance}`);
  }

  const normalized = outcomes.map((entry) => ({ ...entry, probability: entry.probability / total }));
  const normalizedTotal = normalized.reduce((sum, entry) => sum + entry.probability, 0);
  if (Math.abs(normalizedTotal - 1) > tolerance) {
    fail("CHANCE_NORMALIZATION", "normalized chance probabilities do not sum to 1 within tolerance");
  }
  return normalized;
}

export function validateTerminalResult(result, players) {
  if (!isPlainObject(result)) fail("INVALID_TERMINAL_RESULT", "terminalResult must return a plain object");
  canonicalSerialize(result, "terminalResult");
  if (!Object.prototype.hasOwnProperty.call(result, "winnerId")) {
    fail("INVALID_WINNER", "terminalResult must include winnerId");
  }
  requireIdentifier(result.winnerId, "terminalResult.winnerId");
  if (!players.some((playerId) => canonicalEqual(playerId, result.winnerId))) {
    fail("INVALID_WINNER", "terminalResult.winnerId must identify one adapter player");
  }
  if (!Array.isArray(result.payoffs) || result.payoffs.length !== players.length) {
    fail("MALFORMED_PAYOFFS", "terminalResult.payoffs must contain exactly one entry per adapter player");
  }

  const payoffByPlayer = new Map();
  for (let index = 0; index < result.payoffs.length; index += 1) {
    const payoff = result.payoffs[index];
    if (!isPlainObject(payoff) || !Object.prototype.hasOwnProperty.call(payoff, "playerId")) {
      fail("MALFORMED_PAYOFFS", `terminalResult.payoffs[${index}] must include playerId`);
    }
    const playerKey = canonicalSerialize(payoff.playerId, `terminalResult.payoffs[${index}].playerId`);
    if (payoffByPlayer.has(playerKey)) {
      fail("MALFORMED_PAYOFFS", `terminalResult.payoffs contains a duplicate player at index ${index}`);
    }
    if (!Number.isFinite(payoff.value)) {
      fail("MALFORMED_PAYOFFS", `terminalResult.payoffs[${index}].value must be finite`);
    }
    payoffByPlayer.set(playerKey, payoff.value);
  }
  for (const playerId of players) {
    if (!payoffByPlayer.has(canonicalSerialize(playerId))) {
      fail("MALFORMED_PAYOFFS", "terminalResult.payoffs does not cover every adapter player");
    }
  }
  return result;
}

export function readEnvironmentNode(adapter, state, {
  tolerance = CHANCE_PROBABILITY_TOLERANCE,
  instrumentation = null,
} = {}) {
  validateEnvironmentAdapter(adapter, { instrumentation });
  const stateSignature = measureDiagnostic(
    instrumentation,
    "initialStateCanonicalSignature",
    () => canonicalSerialize(state, "state"),
  );

  const callOptions = { instrumentation };
  const nodeKind = callWithoutMutation(adapter, "nodeKind", [state], callOptions);
  if (!Object.values(NODE_KIND).includes(nodeKind)) {
    fail("INVALID_NODE_KIND", "nodeKind must be decision, chance, or terminal");
  }
  const currentPlayer = callWithoutMutation(adapter, "currentPlayer", [state], callOptions);
  const legalActions = validateLegalActions(
    callWithoutMutation(adapter, "legalActions", [state], callOptions),
    { instrumentation },
  );
  const chanceOutcomesRaw = callWithoutMutation(adapter, "chanceOutcomes", [state], callOptions);
  if (!Array.isArray(chanceOutcomesRaw)) {
    fail("INVALID_CHANCE_OUTCOMES", "chanceOutcomes must return an array");
  }
  const terminalResult = callWithoutMutation(adapter, "terminalResult", [state], callOptions);
  const stateHash = callWithoutMutation(adapter, "stateHash", [state], callOptions);
  const metadata = adapter.metadata === undefined
    ? null
    : callWithoutMutation(adapter, "metadata", [state], callOptions);

  if (typeof stateHash !== "string" || stateHash.trim() === "") {
    fail("INVALID_STATE_HASH", "stateHash must return a non-empty string");
  }

  let chanceOutcomes = chanceOutcomesRaw;
  measureDiagnostic(instrumentation, "nodeKindCurrentPlayerChecks", () => {
    if (nodeKind === NODE_KIND.DECISION) {
      if (currentPlayer === null ||
          !adapter.players.some((playerId) => canonicalEqual(playerId, currentPlayer))) {
        fail("INVALID_CURRENT_PLAYER", "a decision node must identify one adapter player");
      }
      if (legalActions.length === 0) fail("NO_LEGAL_ACTIONS", "a decision node must expose a legal action");
      if (chanceOutcomes.length !== 0 || terminalResult !== null) {
        fail("NODE_METHOD_MISMATCH", "a decision node cannot expose chance outcomes or a terminal result");
      }
    } else if (nodeKind === NODE_KIND.CHANCE) {
      if (currentPlayer !== null || legalActions.length !== 0 || terminalResult !== null) {
        fail("NODE_METHOD_MISMATCH", "a chance node cannot expose a current player, legal actions, or terminal result");
      }
      chanceOutcomes = validateChanceOutcomes(chanceOutcomes, tolerance);
    } else {
      if (currentPlayer !== null || legalActions.length !== 0 || chanceOutcomes.length !== 0) {
        fail("NODE_METHOD_MISMATCH", "a terminal node cannot expose a current player, legal actions, or chance outcomes");
      }
      validateTerminalResult(terminalResult, adapter.players);
    }
  });

  const environmentNode = {
    nodeKind,
    currentPlayer,
    legalActions,
    chanceOutcomes,
    terminalResult,
    stateHash,
    metadata,
  };
  if (nodeKind === NODE_KIND.DECISION) {
    measureDiagnostic(instrumentation, "decisionBindingStateKeyConstruction", () => {
      VALIDATED_DECISION_NODE_BINDINGS.set(environmentNode, {
        adapter,
        state,
        stateSignature,
        stateKey: namespacedStateKeyFromHash(adapter, stateHash),
        legalActions,
        entries: new Map(legalActions.map((entry) => [
          entry,
          VALIDATED_LEGAL_ENTRY_SIGNATURES.get(entry),
        ])),
      });
    });
  }
  return environmentNode;
}

function findByKey(entries, requestedKey) {
  const canonicalKey = canonicalSerialize(requestedKey, "requested key");
  return entries.find((entry) => canonicalSerialize(entry.key) === canonicalKey) || null;
}

function namespacedStateKeyFromHash(adapter, stateHash) {
  const parts = [
    ENVIRONMENT_CONTRACT_VERSION,
    adapter.adapterFingerprint,
    adapter.gameplayFingerprint,
    stateHash,
  ];
  return parts.map((part) => encodeURIComponent(part)).join(":");
}

function validatedDecisionBinding(inputs) {
  const environmentNode = inputs?.environmentNode;
  if (environmentNode === null || typeof environmentNode !== "object") return null;
  const binding = VALIDATED_DECISION_NODE_BINDINGS.get(environmentNode);
  if (!binding || binding.adapter !== inputs.adapter || binding.state !== inputs.state) return null;
  if (environmentNode.nodeKind !== NODE_KIND.DECISION) return null;
  if (environmentNode.legalActions !== binding.legalActions
      || environmentNode.legalActions.length !== binding.entries.size) return null;
  if (inputs.stateKey !== binding.stateKey) return null;
  try {
    if (canonicalSerialize(inputs.state, "validated decision state") !== binding.stateSignature) return null;
  } catch {
    return null;
  }
  return binding;
}

export function withValidatedLegalActionScope(inputs, operation) {
  if (typeof operation !== "function") {
    fail("INVALID_VALIDATED_ACTION_SCOPE", "validated legal-action scope requires an operation");
  }
  const binding = validatedDecisionBinding(inputs);
  let active = true;
  const tryApply = binding
    ? (entry, actionKey) => {
        if (!active) return null;
        const expected = binding.entries.get(entry);
        if (!expected) return null;
        try {
          if (canonicalSerialize(entry, "validated legal entry") !== expected.signature
              || canonicalSerialize(actionKey, "validated action key") !== expected.key) return null;
        } catch {
          return null;
        }
        return {
          applied: true,
          state: callWithoutMutation(inputs.adapter, "applyAction", [inputs.state, entry.action]),
        };
      }
    : null;
  try {
    return operation(tryApply);
  } finally {
    active = false;
  }
}

export function applyLegalAction(adapter, state, actionKey) {
  const node = readEnvironmentNode(adapter, state);
  if (node.nodeKind !== NODE_KIND.DECISION) {
    fail("WRONG_NODE_KIND", "actions can only be applied at decision nodes");
  }
  const entry = findByKey(node.legalActions, actionKey);
  if (entry === null) fail("ACTION_NOT_LEGAL", "the requested action key is not legal in this state");
  return callWithoutMutation(adapter, "applyAction", [state, entry.action]);
}

export function applyChanceOutcome(adapter, state, outcomeKey, options) {
  const node = readEnvironmentNode(adapter, state, options);
  if (node.nodeKind !== NODE_KIND.CHANCE) {
    fail("WRONG_NODE_KIND", "chance outcomes can only be applied at chance nodes");
  }
  const entry = findByKey(node.chanceOutcomes, outcomeKey);
  if (entry === null) fail("CHANCE_OUTCOME_NOT_LEGAL", "the requested chance outcome key is not available");
  return callWithoutMutation(adapter, "applyChance", [state, entry.outcome]);
}

export function createNamespacedStateKey(adapter, state, { instrumentation = null } = {}) {
  validateEnvironmentAdapter(adapter, { instrumentation });
  const stateHash = callDeterministically(adapter, "stateHash", [state], { instrumentation });
  if (typeof stateHash !== "string" || stateHash.trim() === "") {
    fail("INVALID_STATE_HASH", "stateHash must return a non-empty string");
  }
  return measureDiagnostic(
    instrumentation,
    "decisionBindingStateKeyConstruction",
    () => namespacedStateKeyFromHash(adapter, stateHash),
  );
}

export function assertNodeConformance(adapter, state, options) {
  const first = readEnvironmentNode(adapter, state, options);
  const second = readEnvironmentNode(adapter, state, options);
  if (!canonicalEqual(first, second)) {
    fail("NONDETERMINISTIC_ADAPTER", "adapter node methods returned different results for identical state");
  }

  if (first.nodeKind === NODE_KIND.DECISION) {
    for (const entry of first.legalActions) {
      callDeterministically(adapter, "applyAction", [state, entry.action]);
    }
  } else if (first.nodeKind === NODE_KIND.CHANCE) {
    for (const entry of first.chanceOutcomes) {
      callDeterministically(adapter, "applyChance", [state, entry.outcome]);
    }
  }
  createNamespacedStateKey(adapter, state);
  return first;
}

export function assertAdapterConformance(adapter, states, options) {
  validateEnvironmentAdapter(adapter);
  if (!Array.isArray(states) || states.length === 0) {
    fail("INVALID_CONFORMANCE_STATES", "states must be a non-empty array");
  }
  return states.map((state) => assertNodeConformance(adapter, state, options));
}
