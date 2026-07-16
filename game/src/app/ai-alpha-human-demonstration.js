export const HUMAN_DEMONSTRATION_RECORDING_SCHEMA = "wargame-alpha-human-demonstration-recording-v1";
export const HUMAN_DEMONSTRATION_DATASET_SCHEMA = "wargame-alpha-human-demonstration-dataset-v1";
export const HUMAN_DEMONSTRATION_SCHEMA_VERSION = 1;
export const HUMAN_POLICY_LABEL_OBSERVED = "observed_move";
export const HUMAN_POLICY_LABEL_EXPERT = "expert_best";

const OBSERVED_MOVE_LABEL = HUMAN_POLICY_LABEL_OBSERVED;
const EXPERT_BEST_LABEL = HUMAN_POLICY_LABEL_EXPERT;
const ADAPTER_WINNER_AUTHORITY = "adapter";
const GAME_STATUSES = new Set(["completed", "incomplete"]);
const FORBIDDEN_NON_WINNER_IDS = new Set(["draw", "tie", "ceasefire"]);
const SAFE_PLAYER_METADATA_KEYS = new Set([
  "consentVersion",
  "experienceBand",
  "expertiseLevel",
  "ratingBand",
  "sourceCohort",
]);
const FORBIDDEN_LOG_FIELDS = new Set(["localizedLog", "localizedLogText", "logText"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ANONYMOUS_PARTICIPANT_PATTERN = /^anon:[0-9a-f]{16,64}$/;
const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const STATE_HASH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Builds a deterministic, game-agnostic human-demonstration dataset.
 * IDs and timestamps must be supplied by the caller; this module never uses a clock or randomness.
 */
export function buildHumanDemonstrationDataset(recording, adapter) {
  assert(recording?.schema === HUMAN_DEMONSTRATION_RECORDING_SCHEMA, "invalid_recording_schema");
  assertNoLocalizedLogInput(recording);
  const adapterContract = normalizeAdapter(adapter);
  const game = normalizeGame(recording.game);
  const players = normalizePlayers(recording.players);
  const playerIds = new Map(players.map((player) => [player.sourceId, player.participantId]));
  const decisions = normalizeDecisions(recording.decisions, playerIds, adapterContract.factionIds, adapter);

  let value = null;
  if (game.status === "completed") {
    assert(isPlainObject(recording.finalState), "completed_game_requires_final_state");
    const terminal = adapter.getTerminalResult(canonicalCopy(recording.finalState), canonicalCopy(recording));
    assert(isPlainObject(terminal), "completed_game_requires_terminal_result");
    assert(adapterContract.factionIds.includes(terminal.winnerId), "invalid_adapter_winner_id");
    assert(isStateHash(terminal.stateHash), "invalid_final_state_hash");
    assert(isFingerprint(terminal.stateFingerprint), "invalid_final_state_fingerprint");
    value = {
      authority: ADAPTER_WINNER_AUTHORITY,
      winnerId: terminal.winnerId,
      finalStateHash: terminal.stateHash,
      finalStateFingerprint: terminal.stateFingerprint,
      finalStateSnapshot: canonicalCopy(recording.finalState),
    };
  } else {
    assert(!Object.hasOwn(recording, "finalState"), "incomplete_game_must_not_supply_final_state");
  }

  const dataset = {
    schema: HUMAN_DEMONSTRATION_DATASET_SCHEMA,
    schemaVersion: HUMAN_DEMONSTRATION_SCHEMA_VERSION,
    datasetId: requiredId(recording.datasetId, "invalid_dataset_id"),
    generatedAt: requiredTimestamp(recording.generatedAt, "invalid_generated_at"),
    adapter: adapterContract,
    fingerprints: normalizeFingerprints(recording.fingerprints),
    game,
    players: players
      .map(({ sourceId: _sourceId, ...player }) => player)
      .sort((left, right) => left.participantId.localeCompare(right.participantId)),
    decisions: decisions.sort((left, right) => left.sequence - right.sequence || left.decisionId.localeCompare(right.decisionId)),
    supervision: {
      policy: true,
      policyOnly: game.status === "incomplete",
      value,
    },
  };
  dataset.fingerprint = humanDemonstrationDatasetFingerprint(dataset);

  const validation = validateHumanDemonstrationDataset(dataset);
  assert(validation.ok, validation.reason);
  return canonicalCopy(dataset);
}

/** Returns a structured key derived only from the canonical structured action. */
export function canonicalHumanActionKey(action) {
  assert(isPlainObject(action), "structured_action_required");
  assert(Object.keys(action).length > 0, "empty_action");
  return `sha256:${sha256Hex(canonicalJsonStringify(action))}`;
}

export function canonicalHumanStateFingerprint(state) {
  assert(isPlainObject(state), "invalid_state_snapshot");
  return `sha256:${sha256Hex(canonicalJsonStringify(state))}`;
}

/** Produces the dataset content fingerprint without trusting a stored fingerprint. */
export function humanDemonstrationDatasetFingerprint(dataset) {
  assert(isPlainObject(dataset), "invalid_dataset");
  const { fingerprint: _fingerprint, ...payload } = dataset;
  return `sha256:${sha256Hex(canonicalJsonStringify(payload))}`;
}

/** Serializes a valid dataset with stable object-key order and one trailing newline. */
export function serializeHumanDemonstrationDataset(dataset) {
  const validation = validateHumanDemonstrationDataset(dataset);
  assert(validation.ok, validation.reason);
  return `${canonicalJsonStringify(dataset)}\n`;
}

/** Parses, validates, and canonicalizes an exported dataset. */
export function parseHumanDemonstrationDataset(text) {
  let dataset;
  try {
    dataset = JSON.parse(String(text));
  } catch {
    throw new Error("invalid_dataset_json");
  }
  const validation = validateHumanDemonstrationDataset(dataset);
  assert(validation.ok, validation.reason);
  return canonicalCopy(dataset);
}

export function convertHumanDemonstrationToAlphaSamples(dataset, adapter, options = {}) {
  const validation = validateHumanDemonstrationDataset(dataset);
  assert(validation.ok, validation.reason);
  assert(isPlainObject(adapter), "invalid_training_adapter");
  assert(typeof adapter.verifyDecision === "function", "missing_adapter_decision_verifier");
  assert(typeof adapter.featuresForState === "function", "missing_adapter_training_features");
  assert(typeof adapter.verifyTerminalEvidence === "function", "missing_adapter_terminal_verifier");
  assert(isPlainObject(adapter.featureContract), "missing_adapter_feature_contract");
  const labelSource = options.labelSource || OBSERVED_MOVE_LABEL;
  assert([OBSERVED_MOVE_LABEL, EXPERT_BEST_LABEL].includes(labelSource), "invalid_human_policy_label_source");

  if (dataset.game.status === "completed") {
    const terminal = adapter.verifyTerminalEvidence(canonicalCopy(dataset.supervision.value));
    assert(isPlainObject(terminal), "invalid_adapter_terminal_verification");
    assert(terminal.winnerId === dataset.supervision.value.winnerId, "adapter_winner_mismatch");
    assert(terminal.stateHash === dataset.supervision.value.finalStateHash, "adapter_final_state_hash_mismatch");
    assert(terminal.stateFingerprint === dataset.supervision.value.finalStateFingerprint, "adapter_final_state_fingerprint_mismatch");
  }

  return dataset.decisions.map((decision) => {
    verifyDecisionAgainstAdapter(decision, adapter);
    const target = labelSource === EXPERT_BEST_LABEL ? decision.expertBestAction : decision.chosenAction;
    assert(target, "missing_expert_best_label");
    const features = adapter.featuresForState(canonicalCopy(decision.stateSnapshot), decision.side);
    assert(isPlainObject(features), "invalid_adapter_training_features");
    const completed = dataset.game.status === "completed";
    const winnerId = completed ? dataset.supervision.value.winnerId : null;
    return {
      schema: "zizi-el-alamein-alpha-training-sample-v1",
      stateHash: decision.stateHash,
      side: decision.side,
      turn: decision.turn,
      phaseId: decision.phase,
      initialState: canonicalCopy(decision.stateSnapshot),
      features: canonicalCopy(features),
      featureContract: canonicalCopy(adapter.featureContract),
      rootValue: null,
      outcome: completed ? (winnerId === decision.side ? 1 : -1) : null,
      outcomeSource: completed ? "terminal_result" : "human_policy_only",
      outcomeWeight: completed ? 1 : 0,
      policy: decision.legalActions.map((entry) => ({
        action: canonicalCopy(entry.action),
        visitShare: entry.key === target.key ? 1 : 0,
        visits: entry.key === target.key ? 1 : 0,
        q: null,
        prior: null,
      })),
      trajectoryIds: [dataset.fingerprint],
      humanDemonstration: {
        datasetId: dataset.datasetId,
        datasetFingerprint: dataset.fingerprint,
        decisionId: decision.decisionId,
        participantId: decision.participantId,
        policyLabelSource: labelSource,
        confidence: decision.confidence,
        intent: canonicalCopy(decision.intent),
        turnDoctrineTags: canonicalCopy(decision.turnDoctrineTags),
      },
    };
  });
}

/**
 * Collects structured human decisions in a game-agnostic recording.
 * Time, IDs, persistence, and rule authority are injected by the host game.
 */
export function createHumanDemonstrationRecorder({
  adapter,
  initialRecording = null,
  fingerprints = null,
  now = null,
  createId = null,
  onChange = null,
} = {}) {
  assert(isPlainObject(adapter), "invalid_recorder_adapter");
  assert(typeof adapter.verifyDecision === "function", "missing_recorder_decision_verifier");
  assert(typeof adapter.getTerminalResult === "function", "missing_recorder_terminal_resolver");
  assert(typeof now === "function", "recorder_clock_must_be_injected");
  const makeId = typeof createId === "function"
    ? createId
    : (kind, sequence) => `${kind}-${sequence}`;
  let recording = initialRecording ? canonicalCopy(initialRecording) : null;

  function start({ datasetId, gameId, generatedAt = now(), recordingFingerprints = fingerprints } = {}) {
    recording = {
      schema: HUMAN_DEMONSTRATION_RECORDING_SCHEMA,
      datasetId: requiredId(datasetId, "invalid_dataset_id"),
      generatedAt: requiredTimestamp(generatedAt, "invalid_generated_at"),
      game: {
        id: requiredId(gameId, "invalid_game_id"),
        status: "incomplete",
      },
      fingerprints: canonicalCopy(recordingFingerprints),
      players: [],
      decisions: [],
    };
    notify();
    return getRecording();
  }

  function ensureStarted() {
    assert(recording?.schema === HUMAN_DEMONSTRATION_RECORDING_SCHEMA, "recorder_not_started");
    assert(recording.game?.status === "incomplete", "recorder_already_completed");
  }

  function ensureRecording() {
    assert(recording?.schema === HUMAN_DEMONSTRATION_RECORDING_SCHEMA, "recorder_not_started");
  }

  function ensurePlayer(player) {
    ensureStarted();
    assert(isPlainObject(player), "invalid_recorder_player");
    const sourceId = requiredId(player.sourceId, "invalid_player_source_id");
    const participantId = requiredId(player.participantId, "invalid_participant_id");
    const existing = recording.players.find((entry) => entry.sourceId === sourceId);
    if (existing) {
      assert(existing.participantId === participantId, "recorder_player_identity_mismatch");
      return existing.participantId;
    }
    assert(ANONYMOUS_PARTICIPANT_PATTERN.test(participantId), "participant_id_must_be_anonymous_token");
    assert(sourceId !== participantId, "participant_id_must_be_anonymized");
    assert(!recording.players.some((entry) => entry.participantId === participantId), "duplicate_participant_id");
    recording.players.push({
      sourceId,
      participantId,
      metadata: sanitizePlayerMetadata(player.metadata),
    });
    return participantId;
  }

  function recordDecision(decision, player = null) {
    ensureStarted();
    assert(isPlainObject(decision), "invalid_recorder_decision");
    if (player) ensurePlayer(player);
    else ensurePlayer({
      sourceId: decision.playerSourceId,
      participantId: decision.participantId,
      metadata: decision.metadata,
    });
    const sequence = decision.sequence === undefined
      ? recording.decisions.length + 1
      : decision.sequence;
    const normalized = {
      ...canonicalCopy(decision),
      id: decision.id || makeId("decision", sequence, recording),
      sequence,
      observedAt: decision.observedAt || now(),
    };
    delete normalized.participantId;
    delete normalized.metadata;
    recording.decisions.push(normalized);
    notify();
    return canonicalCopy(normalized);
  }

  function complete(finalState) {
    ensureStarted();
    assert(isPlainObject(finalState), "completed_game_requires_final_state");
    const terminal = adapter.getTerminalResult(canonicalCopy(finalState), canonicalCopy(recording));
    assert(isPlainObject(terminal), "completed_game_requires_terminal_result");
    recording.game.status = "completed";
    recording.finalState = canonicalCopy(finalState);
    notify();
    return getRecording();
  }

  function reset() {
    recording = null;
    notify();
  }

  function buildDataset() {
    ensureRecording();
    return buildHumanDemonstrationDataset(recording, adapter);
  }

  function getRecording() {
    return recording ? canonicalCopy(recording) : null;
  }

  function notify() {
    onChange?.(getRecording());
  }

  return Object.freeze({
    buildDataset,
    complete,
    ensurePlayer,
    getRecording,
    recordDecision,
    reset,
    start,
  });
}

/** Generates a privacy-preserving local participant token from an injected seed. */
export function anonymousHumanParticipantId(seed) {
  return `anon:${sha256Hex(String(seed)).slice(0, 16)}`;
}

/** Validates schema, action legality, outcome authority, anonymity, and fingerprint integrity. */
export function validateHumanDemonstrationDataset(dataset) {
  try {
    if (!isPlainObject(dataset) || dataset.schema !== HUMAN_DEMONSTRATION_DATASET_SCHEMA) {
      return invalid("invalid_dataset_schema");
    }
    if (dataset.schemaVersion !== HUMAN_DEMONSTRATION_SCHEMA_VERSION) return invalid("invalid_schema_version");
    if (!hasOnlyKeys(dataset, ["schema", "schemaVersion", "datasetId", "generatedAt", "adapter", "fingerprints", "game", "players", "decisions", "supervision", "fingerprint"])) {
      return invalid("unknown_dataset_field");
    }
    if (!isId(dataset.datasetId)) return invalid("invalid_dataset_id");
    if (!isTimestamp(dataset.generatedAt)) return invalid("invalid_generated_at");

    const adapter = dataset.adapter;
    if (!isPlainObject(adapter) || !isId(adapter.id) || !isId(adapter.version)) return invalid("invalid_adapter_contract");
    if (!hasOnlyKeys(adapter, ["id", "version", "factionIds", "decisionAuthority", "winnerAuthority"])) return invalid("unknown_adapter_field");
    if (!isUniqueIdArray(adapter.factionIds)) return invalid("invalid_adapter_faction_ids");
    if (adapter.factionIds.some((id) => FORBIDDEN_NON_WINNER_IDS.has(id.toLowerCase()))) return invalid("non_winner_outcome_id_forbidden");
    if (adapter.decisionAuthority !== ADAPTER_WINNER_AUTHORITY || adapter.winnerAuthority !== ADAPTER_WINNER_AUTHORITY) {
      return invalid("invalid_adapter_authority");
    }

    if (!validFingerprints(dataset.fingerprints)) return invalid("invalid_fingerprints");
    if (!validGame(dataset.game)) return invalid("invalid_game");
    if (!Array.isArray(dataset.players) || !dataset.players.length) return invalid("invalid_players");

    const participantIds = new Set();
    for (const [playerIndex, player] of dataset.players.entries()) {
      if (!validExportedPlayer(player)) return invalid("invalid_anonymized_player", { playerIndex });
      if (participantIds.has(player.participantId)) return invalid("duplicate_participant_id", { playerIndex });
      participantIds.add(player.participantId);
    }

    if (!Array.isArray(dataset.decisions) || !dataset.decisions.length) return invalid("invalid_decisions");
    const decisionIds = new Set();
    const sequences = new Set();
    for (const [decisionIndex, decision] of dataset.decisions.entries()) {
      const decisionValidation = validateDecision(decision, participantIds, adapter.factionIds);
      if (!decisionValidation.ok) return { ...decisionValidation, decisionIndex };
      if (decisionIds.has(decision.decisionId)) return invalid("duplicate_decision_id", { decisionIndex });
      if (sequences.has(decision.sequence)) return invalid("duplicate_decision_sequence", { decisionIndex });
      decisionIds.add(decision.decisionId);
      sequences.add(decision.sequence);
    }

    const supervision = dataset.supervision;
    if (!isPlainObject(supervision) || supervision.policy !== true) return invalid("invalid_supervision");
    if (!hasOnlyKeys(supervision, ["policy", "policyOnly", "value"])) return invalid("unknown_supervision_field");
    if (dataset.game.status === "incomplete") {
      if (supervision.policyOnly !== true || supervision.value !== null) {
        return invalid("incomplete_game_must_be_policy_only");
      }
    } else {
      if (supervision.policyOnly !== false || !isPlainObject(supervision.value)) {
        return invalid("completed_game_requires_adapter_winner");
      }
      if (supervision.value.authority !== ADAPTER_WINNER_AUTHORITY) {
        return invalid("invalid_winner_authority");
      }
      if (!hasOnlyKeys(supervision.value, ["authority", "winnerId", "finalStateHash", "finalStateFingerprint", "finalStateSnapshot"])) {
        return invalid("unknown_winner_field");
      }
      if (!adapter.factionIds.includes(supervision.value.winnerId)) {
        return invalid("invalid_adapter_winner_id");
      }
      if (
        !isStateHash(supervision.value.finalStateHash)
        || !isPlainObject(supervision.value.finalStateSnapshot)
        || !isFingerprint(supervision.value.finalStateFingerprint)
        || supervision.value.finalStateFingerprint !== canonicalHumanStateFingerprint(supervision.value.finalStateSnapshot)
      ) {
        return invalid("invalid_final_state_evidence");
      }
    }

    if (!/^sha256:[0-9a-f]{64}$/.test(String(dataset.fingerprint || ""))) {
      return invalid("invalid_dataset_fingerprint");
    }
    if (dataset.fingerprint !== humanDemonstrationDatasetFingerprint(dataset)) {
      return invalid("dataset_fingerprint_mismatch");
    }
    canonicalJsonStringify(dataset);
    return { ok: true, reason: null };
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "invalid_dataset");
  }
}

/** Stable JSON for fingerprints, canonical action keys, and byte-identical exports. */
export function canonicalJsonStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

function normalizeAdapter(adapter) {
  assert(isPlainObject(adapter), "invalid_adapter_contract");
  assert(typeof adapter.verifyDecision === "function", "missing_adapter_decision_verifier");
  assert(typeof adapter.getTerminalResult === "function", "missing_adapter_terminal_resolver");
  const contract = {
    id: requiredId(adapter.id, "invalid_adapter_id"),
    version: requiredId(adapter.version, "invalid_adapter_version"),
    factionIds: normalizeUniqueIds(adapter.factionIds, "invalid_adapter_faction_ids"),
    decisionAuthority: ADAPTER_WINNER_AUTHORITY,
    winnerAuthority: ADAPTER_WINNER_AUTHORITY,
  };
  assert(!contract.factionIds.some((id) => FORBIDDEN_NON_WINNER_IDS.has(id.toLowerCase())), "non_winner_outcome_id_forbidden");
  return contract;
}

function normalizeGame(game) {
  assert(isPlainObject(game), "invalid_game");
  assert(!Object.hasOwn(game, "winner") && !Object.hasOwn(game, "winnerId") && !Object.hasOwn(game, "outcome"), "winner_must_come_from_adapter");
  assert(GAME_STATUSES.has(game.status), "invalid_game_status");
  return {
    id: requiredId(game.id, "invalid_game_id"),
    status: game.status,
  };
}

function normalizeFingerprints(fingerprints) {
  assert(validFingerprints(fingerprints), "invalid_fingerprints");
  return {
    features: fingerprints.features,
    rules: fingerprints.rules,
    scenario: fingerprints.scenario,
  };
}

function normalizePlayers(players) {
  assert(Array.isArray(players) && players.length > 0, "invalid_players");
  const sourceIds = new Set();
  const participantIds = new Set();
  return players.map((player) => {
    assert(isPlainObject(player), "invalid_player");
    const sourceId = requiredId(player.sourceId, "invalid_player_source_id");
    const participantId = requiredId(player.participantId, "invalid_participant_id");
    assert(ANONYMOUS_PARTICIPANT_PATTERN.test(participantId), "participant_id_must_be_anonymous_token");
    assert(sourceId !== participantId, "participant_id_must_be_anonymized");
    assert(!sourceIds.has(sourceId), "duplicate_player_source_id");
    assert(!participantIds.has(participantId), "duplicate_participant_id");
    sourceIds.add(sourceId);
    participantIds.add(participantId);
    return {
      sourceId,
      participantId,
      metadata: sanitizePlayerMetadata(player.metadata),
    };
  });
}

function sanitizePlayerMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  assert(isPlainObject(metadata), "invalid_player_metadata");
  const safeEntries = Object.entries(metadata)
    .filter(([key]) => SAFE_PLAYER_METADATA_KEYS.has(key))
    .map(([key, value]) => [key, canonicalValue(value)]);
  return Object.fromEntries(safeEntries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeDecisions(decisions, playerIds, factionIds, adapter) {
  assert(Array.isArray(decisions) && decisions.length > 0, "invalid_decisions");
  const decisionIds = new Set();
  const sequences = new Set();
  return decisions.map((decision) => {
    assert(isPlainObject(decision), "invalid_decision");
    assertNoLocalizedLogInput(decision);
    assert(!Object.hasOwn(decision, "value") && !Object.hasOwn(decision, "valueLabel") && !Object.hasOwn(decision, "outcome"), "decision_value_label_forbidden");
    const decisionId = requiredId(decision.id, "invalid_decision_id");
    const sequence = requiredPositiveInteger(decision.sequence, "invalid_decision_sequence");
    assert(!decisionIds.has(decisionId), "duplicate_decision_id");
    assert(!sequences.has(sequence), "duplicate_decision_sequence");
    decisionIds.add(decisionId);
    sequences.add(sequence);
    const participantId = playerIds.get(decision.playerSourceId);
    assert(participantId, "unknown_decision_player");
    const turn = requiredPositiveInteger(decision.turn, "invalid_turn");
    const phase = requiredId(decision.phase, "invalid_phase");
    const side = requiredId(decision.side, "invalid_side");
    assert(factionIds.includes(side), "unknown_side_id");

    const legalActions = normalizeLegalActions(decision.legalActions);
    const legalByKey = new Map(legalActions.map((entry) => [entry.key, entry.action]));
    const chosenAction = normalizeLabeledAction(decision.chosenAction, OBSERVED_MOVE_LABEL, legalByKey, "chosen_action_not_legal");
    const expertBestAction = decision.expertBestAction === undefined || decision.expertBestAction === null
      ? null
      : normalizeLabeledAction(decision.expertBestAction, EXPERT_BEST_LABEL, legalByKey, "expert_best_action_not_legal");

    const normalized = {
      decisionId,
      sequence,
      observedAt: requiredTimestamp(decision.observedAt, "invalid_observed_at"),
      participantId,
      turn,
      phase,
      side,
      stateHash: requiredStateHash(decision.stateHash, "invalid_state_hash"),
      stateSnapshot: decision.stateSnapshot === undefined || decision.stateSnapshot === null
        ? null
        : normalizeSnapshot(decision.stateSnapshot),
      stateFingerprint: decision.stateSnapshot === undefined || decision.stateSnapshot === null
        ? null
        : canonicalHumanStateFingerprint(decision.stateSnapshot),
      legalActions,
      chosenAction,
      expertBestAction,
      rankedAlternatives: normalizeRankedAlternatives(decision.rankedAlternatives, legalByKey, chosenAction.key),
      confidence: optionalConfidence(decision.confidence),
      intent: normalizeIntent(decision.intent),
      turnDoctrineTags: normalizeDoctrineTags(decision.turnDoctrineTags, { turn, phase, side }),
    };
    verifyDecisionAgainstAdapter(normalized, adapter);
    return normalized;
  });
}

function normalizeLegalActions(actions) {
  assert(Array.isArray(actions) && actions.length > 0, "missing_legal_actions");
  const byKey = new Map();
  for (const action of actions) {
    const key = canonicalHumanActionKey(action);
    assert(!byKey.has(key), "duplicate_legal_action");
    byKey.set(key, canonicalCopy(action));
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, action]) => ({ key, action }));
}

function verifyDecisionAgainstAdapter(decision, adapter) {
  assert(isPlainObject(decision.stateSnapshot), "decision_state_snapshot_required");
  const facts = adapter.verifyDecision(canonicalCopy(decision.stateSnapshot), canonicalCopy(decision));
  assert(isPlainObject(facts), "invalid_adapter_decision_verification");
  assert(facts.stateHash === decision.stateHash, "adapter_state_hash_mismatch");
  assert(facts.turn === decision.turn, "adapter_turn_mismatch");
  assert(facts.phase === decision.phase, "adapter_phase_mismatch");
  assert(facts.side === decision.side, "adapter_side_mismatch");
  const expectedFingerprint = canonicalHumanStateFingerprint(decision.stateSnapshot);
  assert(decision.stateFingerprint === expectedFingerprint, "state_fingerprint_mismatch");
  const suppliedKeys = decision.legalActions.map((entry) => entry.key).sort();
  const authoritativeActions = normalizeLegalActions(facts.legalActions);
  const authoritativeKeys = authoritativeActions.map((entry) => entry.key).sort();
  assert(suppliedKeys.length === authoritativeKeys.length, "adapter_legal_actions_mismatch");
  assert(suppliedKeys.every((key, index) => key === authoritativeKeys[index]), "adapter_legal_actions_mismatch");
}

function normalizeLabeledAction(action, label, legalByKey, reason) {
  const key = canonicalHumanActionKey(action);
  assert(legalByKey.has(key), reason);
  return {
    key,
    action: canonicalCopy(legalByKey.get(key)),
    label,
  };
}

function normalizeRankedAlternatives(alternatives, legalByKey, chosenKey) {
  if (alternatives === undefined || alternatives === null) return [];
  assert(Array.isArray(alternatives), "invalid_ranked_alternatives");
  const keys = new Set();
  const ranks = new Set();
  return alternatives.map((entry) => {
    assert(isPlainObject(entry), "invalid_ranked_alternative");
    const key = canonicalHumanActionKey(entry.action);
    const rank = requiredPositiveInteger(entry.rank, "invalid_alternative_rank");
    assert(legalByKey.has(key), "ranked_action_not_legal");
    assert(key !== chosenKey, "chosen_action_is_not_an_alternative");
    assert(!keys.has(key), "duplicate_ranked_action");
    assert(!ranks.has(rank), "duplicate_alternative_rank");
    keys.add(key);
    ranks.add(rank);
    return {
      rank,
      key,
      action: canonicalCopy(legalByKey.get(key)),
      confidence: optionalConfidence(entry.confidence),
    };
  }).sort((left, right) => left.rank - right.rank || left.key.localeCompare(right.key));
}

function normalizeIntent(intent) {
  if (intent === undefined || intent === null) return null;
  assert(isPlainObject(intent), "structured_intent_required");
  const normalized = { code: requiredId(intent.code, "invalid_intent_code") };
  if (intent.parameters !== undefined) normalized.parameters = canonicalValue(intent.parameters);
  return normalized;
}

function normalizeDoctrineTags(tags, decision) {
  if (tags === undefined || tags === null) return [];
  assert(Array.isArray(tags), "invalid_turn_doctrine_tags");
  const ids = new Set();
  return tags.map((tag) => {
    assert(isPlainObject(tag), "invalid_turn_doctrine_tag");
    const normalized = {
      id: requiredId(tag.id, "invalid_turn_doctrine_tag_id"),
      turn: requiredPositiveInteger(tag.turn, "invalid_turn_doctrine_tag_turn"),
      phase: requiredId(tag.phase, "invalid_turn_doctrine_tag_phase"),
      side: requiredId(tag.side, "invalid_turn_doctrine_tag_side"),
    };
    assert(normalized.turn === decision.turn && normalized.phase === decision.phase && normalized.side === decision.side, "turn_doctrine_tag_context_mismatch");
    assert(!ids.has(normalized.id), "duplicate_turn_doctrine_tag");
    ids.add(normalized.id);
    return normalized;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function validateDecision(decision, participantIds, factionIds) {
  if (!isPlainObject(decision) || !isId(decision.decisionId)) return invalid("invalid_decision_id");
  if (!hasOnlyKeys(decision, [
    "decisionId", "sequence", "observedAt", "participantId", "turn", "phase", "side",
    "stateHash", "stateSnapshot", "stateFingerprint", "legalActions", "chosenAction",
    "expertBestAction", "rankedAlternatives", "confidence", "intent", "turnDoctrineTags",
  ])) return invalid("unknown_decision_field");
  if (!Number.isInteger(decision.sequence) || decision.sequence < 1) return invalid("invalid_decision_sequence");
  if (!isTimestamp(decision.observedAt)) return invalid("invalid_observed_at");
  if (!participantIds.has(decision.participantId)) return invalid("unknown_decision_participant");
  if (!Number.isInteger(decision.turn) || decision.turn < 1) return invalid("invalid_turn");
  if (!isId(decision.phase)) return invalid("invalid_phase");
  if (!factionIds.includes(decision.side)) return invalid("unknown_side_id");
  if (!isStateHash(decision.stateHash)) return invalid("invalid_state_hash");
  if (!isPlainObject(decision.stateSnapshot)) return invalid("decision_state_snapshot_required");
  if (!isFingerprint(decision.stateFingerprint) || decision.stateFingerprint !== canonicalHumanStateFingerprint(decision.stateSnapshot)) {
    return invalid("state_fingerprint_mismatch");
  }
  if (!Array.isArray(decision.legalActions) || !decision.legalActions.length) return invalid("missing_legal_actions");

  const legalKeys = new Set();
  for (const entry of decision.legalActions) {
    if (!isPlainObject(entry) || !isPlainObject(entry.action)) return invalid("structured_action_required");
    if (!hasOnlyKeys(entry, ["key", "action"])) return invalid("unknown_legal_action_field");
    const expectedKey = canonicalHumanActionKey(entry.action);
    if (entry.key !== expectedKey) return invalid("action_key_mismatch");
    if (legalKeys.has(entry.key)) return invalid("duplicate_legal_action");
    legalKeys.add(entry.key);
  }
  if (!validLabeledAction(decision.chosenAction, OBSERVED_MOVE_LABEL, legalKeys)) return invalid("chosen_action_not_legal");
  if (decision.expertBestAction !== null && !validLabeledAction(decision.expertBestAction, EXPERT_BEST_LABEL, legalKeys)) {
    return invalid("expert_best_action_not_legal");
  }
  if (!Array.isArray(decision.rankedAlternatives)) return invalid("invalid_ranked_alternatives");
  const rankedKeys = new Set();
  const ranks = new Set();
  for (const entry of decision.rankedAlternatives) {
    if (!isPlainObject(entry) || !Number.isInteger(entry.rank) || entry.rank < 1) return invalid("invalid_ranked_alternative");
    if (!hasOnlyKeys(entry, ["rank", "key", "action", "confidence"])) return invalid("unknown_ranked_action_field");
    if (!isPlainObject(entry.action) || entry.key !== canonicalHumanActionKey(entry.action)) return invalid("action_key_mismatch");
    if (!legalKeys.has(entry.key)) return invalid("ranked_action_not_legal");
    if (entry.key === decision.chosenAction.key) return invalid("chosen_action_is_not_an_alternative");
    if (rankedKeys.has(entry.key) || ranks.has(entry.rank)) return invalid("duplicate_ranked_alternative");
    if (!validOptionalConfidence(entry.confidence)) return invalid("invalid_confidence");
    rankedKeys.add(entry.key);
    ranks.add(entry.rank);
  }
  if (!validOptionalConfidence(decision.confidence)) return invalid("invalid_confidence");
  if (decision.intent !== null && (!isPlainObject(decision.intent) || !isId(decision.intent.code))) return invalid("invalid_intent");
  if (!Array.isArray(decision.turnDoctrineTags)) return invalid("invalid_turn_doctrine_tags");
  const doctrineIds = new Set();
  for (const tag of decision.turnDoctrineTags) {
    if (!isPlainObject(tag) || !isId(tag.id) || tag.turn !== decision.turn || tag.phase !== decision.phase || tag.side !== decision.side) {
      return invalid("turn_doctrine_tag_context_mismatch");
    }
    if (doctrineIds.has(tag.id)) return invalid("duplicate_turn_doctrine_tag");
    doctrineIds.add(tag.id);
  }
  if (Object.hasOwn(decision, "value") || Object.hasOwn(decision, "valueLabel") || Object.hasOwn(decision, "outcome")) {
    return invalid("decision_value_label_forbidden");
  }
  return { ok: true, reason: null };
}

function validLabeledAction(entry, label, legalKeys) {
  return isPlainObject(entry)
    && hasOnlyKeys(entry, ["key", "action", "label"])
    && entry.label === label
    && isPlainObject(entry.action)
    && entry.key === canonicalHumanActionKey(entry.action)
    && legalKeys.has(entry.key);
}

function validExportedPlayer(player) {
  if (!isPlainObject(player) || Object.keys(player).some((key) => !["participantId", "metadata"].includes(key))) return false;
  if (!isId(player.participantId) || !ANONYMOUS_PARTICIPANT_PATTERN.test(player.participantId) || !isPlainObject(player.metadata)) return false;
  return Object.keys(player.metadata).every((key) => SAFE_PLAYER_METADATA_KEYS.has(key));
}

function normalizeSnapshot(snapshot) {
  assert(isPlainObject(snapshot), "invalid_state_snapshot");
  return canonicalCopy(snapshot);
}

function optionalConfidence(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  assert(Number.isFinite(number) && number >= 0 && number <= 1, "invalid_confidence");
  return number;
}

function validOptionalConfidence(value) {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
}

function validFingerprints(value) {
  return isPlainObject(value)
    && hasOnlyKeys(value, ["scenario", "rules", "features"])
    && isFingerprint(value.scenario)
    && isFingerprint(value.rules)
    && isFingerprint(value.features);
}

function validGame(game) {
  return isPlainObject(game)
    && Object.keys(game).every((key) => ["id", "status"].includes(key))
    && isId(game.id)
    && GAME_STATUSES.has(game.status);
}

function assertNoLocalizedLogInput(value) {
  for (const key of FORBIDDEN_LOG_FIELDS) {
    assert(!Object.hasOwn(value, key), "localized_log_input_forbidden");
  }
}

function normalizeUniqueIds(values, reason) {
  assert(isUniqueIdArray(values), reason);
  return [...values].sort((left, right) => left.localeCompare(right));
}

function isUniqueIdArray(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every(isId)
    && new Set(values).size === values.length;
}

function requiredId(value, reason) {
  assert(isId(value), reason);
  return value;
}

function isId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function requiredFingerprint(value, reason) {
  assert(isFingerprint(value), reason);
  return value;
}

function requiredStateHash(value, reason) {
  assert(isStateHash(value), reason);
  return value;
}

function isFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

function isStateHash(value) {
  return typeof value === "string" && STATE_HASH_PATTERN.test(value);
}

function requiredTimestamp(value, reason) {
  assert(isTimestamp(value), reason);
  return value;
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function requiredPositiveInteger(value, reason) {
  assert(Number.isInteger(value) && value >= 1, reason);
  return value;
}

function canonicalCopy(value) {
  return JSON.parse(canonicalJsonStringify(value));
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value), "non_finite_json_number");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  assert(isPlainObject(value), "non_json_value");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function invalid(reason, details = {}) {
  return { ok: false, reason, ...details };
}

function assert(condition, reason) {
  if (!condition) throw new Error(reason);
}

function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const byteLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const message = new Uint8Array(byteLength);
  message.set(bytes);
  message[bytes.length] = 0x80;
  const view = new DataView(message.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(byteLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(byteLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
