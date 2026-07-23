export const HUMAN_LAB_CAPTURE_ENVELOPE_SCHEMA = "zizi-el-alamein-human-lab-capture-envelope-v1";
export const HUMAN_LAB_COMPACT_RECORDING_SCHEMA = "zizi-el-alamein-human-lab-compact-recording-v2";
export const HUMAN_LAB_RECOVERY_EXPORT_SCHEMA = "zizi-el-alamein-human-lab-recovery-export-v1";

const PERSISTENCE_ONLY_CAPTURE_ISSUES = new Set([
  "checkpoint_failed",
  "quota_exceeded",
  "storage_write_failed",
]);

export function createHumanLabCaptureStore({
  storage,
  keyPrefix = "zizi-el-alamein-human-lab-capture-v1",
  now,
  codec = identityCaptureCodec(),
} = {}) {
  assertStorage(storage);
  assert(typeof now === "function", "human_lab_capture_clock_required");
  assertCaptureCodec(codec);

  function writeCheckpoint(slot, { stateHash, recording }) {
    const envelope = captureEnvelope({
      kind: "checkpoint",
      slot,
      stateHash,
      recording: codec.encode(recording),
      createdAt: now(),
    });
    const key = checkpointKey(slot);
    const failure = writeStorage(storage, key, JSON.stringify(envelope));
    if (failure) return failure;
    return { status: "written", key, envelope: copy(envelope) };
  }

  function readCheckpoint(slot, expectedStateHash) {
    const raw = storage.getItem(checkpointKey(slot));
    if (!raw) return { status: "missing", recording: null, envelope: null };
    const envelope = parseEnvelope(raw);
    if (envelope.stateHash !== requiredText(expectedStateHash, "invalid_capture_state_hash")) {
      return { status: "state_mismatch", recording: null, envelope: copy(envelope) };
    }
    return { status: "matched", recording: codec.decode(envelope.recording), envelope: copy(envelope) };
  }

  function archiveRecording(recording, { reason, stateHash = null } = {}) {
    const gameId = requiredText(recording?.game?.id, "invalid_capture_game_id");
    const envelope = captureEnvelope({
      kind: "archive",
      slot: requiredText(reason, "invalid_capture_archive_reason"),
      stateHash,
      recording: codec.encode(recording),
      createdAt: now(),
    });
    const mutationSequence = Number(recording.capture?.lastMutationSequence || 0);
    assert(Number.isInteger(mutationSequence) && mutationSequence >= 0, "invalid_capture_mutation_sequence");
    const journalSequence = Number(recording.journal?.at(-1)?.sequence || 0);
    assert(Number.isInteger(journalSequence) && journalSequence >= 0, "invalid_capture_journal_sequence");
    const key = `${keyPrefix}:archive:${gameId}:${mutationSequence}:${journalSequence}`;
    const existing = storage.getItem(key);
    if (existing !== null) {
      const parsed = parseEnvelope(existing);
      assert(canonicalJson(parsed.recording) === canonicalJson(envelope.recording), "human_lab_archive_collision");
      return { status: "already_archived", key, envelope: copy(parsed) };
    }
    const failure = writeStorage(storage, key, JSON.stringify(envelope));
    if (failure) return failure;
    return { status: "archived", key, envelope: copy(envelope) };
  }

  function checkpointKey(slot) {
    return `${keyPrefix}:checkpoint:${requiredText(slot, "invalid_capture_checkpoint_slot")}`;
  }

  return Object.freeze({ archiveRecording, readCheckpoint, writeCheckpoint });
}

/**
 * Removes only deterministic legal-action lists from browser persistence.
 * Decoding regenerates them through the same authoritative rules adapter and
 * refuses to restore a recording if the stored decision no longer matches it.
 */
export function createHumanLabCaptureCodec({ verifyDecision, normalizeAction = copy } = {}) {
  assert(typeof verifyDecision === "function", "human_lab_capture_verifier_required");
  assert(typeof normalizeAction === "function", "human_lab_capture_action_normalizer_required");

  function encode(recording) {
    assertRecording(recording);
    if (recording.schema === HUMAN_LAB_COMPACT_RECORDING_SCHEMA) return copy(recording);
    const compact = copy(recording);
    for (const decision of compact.decisions || []) delete decision.legalActions;
    return {
      schema: HUMAN_LAB_COMPACT_RECORDING_SCHEMA,
      recording: compact,
    };
  }

  function decode(value) {
    assertRecording(value);
    if (value.schema !== HUMAN_LAB_COMPACT_RECORDING_SCHEMA) return copy(value);
    assertRecording(value.recording);
    const recording = copy(value.recording);
    for (const decision of recording.decisions || []) {
      assert(decision?.stateSnapshot && typeof decision.stateSnapshot === "object", "invalid_compact_decision_state");
      const facts = verifyDecision(copy(decision.stateSnapshot));
      assert(facts && typeof facts === "object", "compact_decision_verification_failed");
      assert(decision.stateHash === facts.stateHash, "compact_decision_state_hash_mismatch");
      assert(decision.turn === facts.turn, "compact_decision_turn_mismatch");
      assert(decision.phase === facts.phase, "compact_decision_phase_mismatch");
      assert(decision.side === facts.side, "compact_decision_side_mismatch");
      assert(Array.isArray(facts.legalActions), "compact_decision_legal_actions_missing");
      const legalActions = facts.legalActions.map((action) => copy(normalizeAction(copy(action))));
      const chosenActionKey = canonicalJson(normalizeAction(copy(decision.chosenAction)));
      assert(
        legalActions.some((action) => canonicalJson(action) === chosenActionKey),
        "compact_decision_chosen_action_illegal",
      );
      decision.legalActions = legalActions;
    }
    return recording;
  }

  return Object.freeze({ decode, encode });
}

/**
 * Records one browser-observed action through the same authoritative action
 * resolver used by the live game. The result is explicit so UI callers can
 * latch a degraded capture instead of silently continuing with a missing
 * policy sample.
 */
export function recordHumanLabObservedDecision({
  recorder,
  verifyDecision,
  resolveAuthoritativeAction,
  normalizeAction = copy,
  stateSnapshot,
  action,
  side = null,
  player,
  isSideAllowed = () => true,
} = {}) {
  assert(recorder && typeof recorder.recordDecision === "function", "human_lab_recorder_required");
  assert(typeof verifyDecision === "function", "human_lab_decision_verifier_required");
  assert(typeof resolveAuthoritativeAction === "function", "human_lab_action_resolver_required");
  assert(typeof normalizeAction === "function", "human_lab_action_normalizer_required");
  assert(player && typeof player === "object" && !Array.isArray(player), "human_lab_player_required");
  assert(typeof isSideAllowed === "function", "human_lab_side_guard_required");

  let facts;
  try {
    facts = verifyDecision(copy(stateSnapshot));
  } catch (error) {
    return failedObservedDecision("decision_verification_failed", error);
  }
  if (!facts || typeof facts !== "object") {
    return failedObservedDecision("decision_verification_failed");
  }
  if (!Array.isArray(facts.legalActions)) {
    return failedObservedDecision("decision_legal_actions_missing");
  }
  const decisionSide = side || facts.side;
  if (!decisionSide || !isSideAllowed(decisionSide)) {
    return { status: "skipped", reason: "side_not_captured", decision: null };
  }

  let observedAction;
  let legalActions;
  let authoritativeAction;
  try {
    observedAction = copy(normalizeAction(copy(action)));
    legalActions = facts.legalActions.map((entry) => copy(normalizeAction(copy(entry))));
    authoritativeAction = resolveAuthoritativeAction(observedAction, legalActions);
  } catch (error) {
    return failedObservedDecision("decision_alignment_failed", error);
  }
  if (!authoritativeAction) return failedObservedDecision("decision_alignment_failed");

  try {
    const decision = recorder.recordDecision({
      playerSourceId: player.sourceId,
      turn: facts.turn,
      phase: facts.phase,
      side: decisionSide,
      stateHash: facts.stateHash,
      stateSnapshot: copy(stateSnapshot),
      legalActions,
      chosenAction: copy(authoritativeAction),
      expertBestAction: null,
      rankedAlternatives: [],
      confidence: null,
      intent: null,
      turnDoctrineTags: [],
    }, player);
    return { status: "recorded", reason: null, decision };
  } catch (error) {
    return failedObservedDecision("decision_recording_failed", error);
  }
}

/** Tombstones the exact declaration sample before the live battle is removed. */
export function tombstoneHumanLabObservedDecision({
  recorder,
  decisionId,
  stateHash,
  reason = "cancel_declared_combat",
} = {}) {
  assert(recorder && typeof recorder.tombstoneDecision === "function", "human_lab_recorder_required");
  if (typeof decisionId !== "string" || !decisionId) {
    return { status: "skipped", reason: "missing_decision_id", tombstone: null };
  }
  try {
    const tombstone = recorder.tombstoneDecision(decisionId, { reason, stateHash });
    return { status: "tombstoned", reason: null, tombstone };
  } catch (error) {
    return { status: "failed", reason: "decision_tombstone_failed", tombstone: null, error };
  }
}

export function humanLabStandardExportReadiness(recording, {
  captureIssue = null,
  expectedHumanSides = [],
} = {}) {
  if (captureIssue && !humanLabCaptureIssuePolicy(captureIssue).standardExportAllowed) {
    return { ready: false, reason: "capture_degraded" };
  }
  const continuity = humanLabRecordingContinuity(recording);
  if (!continuity.ok) return { ready: false, reason: "capture_continuity_gap" };
  if (recording?.game?.status === "completed") {
    const observedSides = new Set((recording.decisions || []).map((decision) => decision.side));
    for (const side of expectedHumanSides) {
      const expectedSide = requiredText(side, "invalid_expected_human_side");
      if (!observedSides.has(expectedSide)) {
        return { ready: false, reason: `missing_human_side:${expectedSide}` };
      }
    }
  }
  return { ready: true, reason: null };
}

/**
 * Reconciles every completed declaration group with the authoritative battle
 * snapshot captured immediately before FINISH_DECLARATIONS. This catches both
 * silently omitted legal declarations and stale declarations that were
 * cancelled in the game but not tombstoned from the recording.
 */
export function humanLabRecordingContinuity(recording) {
  const decisions = Array.isArray(recording?.decisions)
    ? recording.decisions.map((decision, index) => ({ decision, index })).sort((left, right) => {
      const leftSequence = Number.isInteger(left.decision?.sequence) ? left.decision.sequence : left.index;
      const rightSequence = Number.isInteger(right.decision?.sequence) ? right.decision.sequence : right.index;
      return leftSequence - rightSequence || left.index - right.index;
    })
    : [];
  const pendingByGroup = new Map();
  let inspectedDeclarationGroups = 0;

  for (const { decision } of decisions) {
    const action = decision?.chosenAction;
    const groupKey = declarationGroupKey(decision);
    if (action?.type === "DECLARE_COMBAT") {
      const identity = combatDeclarationIdentity(action);
      if (!groupKey || !identity) {
        return continuityGap({
          inspectedDeclarationGroups,
          decision,
          expectedDeclarations: 0,
          recordedDeclarations: 1,
        });
      }
      const pending = pendingByGroup.get(groupKey) || [];
      pending.push(identity);
      pendingByGroup.set(groupKey, pending);
      continue;
    }
    if (action?.type !== "FINISH_DECLARATIONS") continue;

    inspectedDeclarationGroups += 1;
    const declaredCombats = decision?.stateSnapshot?.declaredCombats;
    if (!groupKey || !Array.isArray(declaredCombats)) {
      return continuityGap({
        inspectedDeclarationGroups,
        decision,
        expectedDeclarations: 0,
        recordedDeclarations: (pendingByGroup.get(groupKey) || []).length,
      });
    }
    const expected = declaredCombats.map(combatDeclarationIdentity);
    const recorded = pendingByGroup.get(groupKey) || [];
    if (expected.some((identity) => identity === null) || !sameStringMultiset(expected, recorded)) {
      return continuityGap({
        inspectedDeclarationGroups,
        decision,
        expectedDeclarations: expected.length,
        recordedDeclarations: recorded.length,
      });
    }
    pendingByGroup.delete(groupKey);
  }

  return { ok: true, reason: null, inspectedDeclarationGroups };
}

/**
 * Keeps an uninterrupted in-memory recording alive when only browser
 * persistence has failed. Alignment failures still fail closed because the
 * recording may no longer describe the game state being played.
 */
export function humanLabCaptureIssuePolicy(reason) {
  const normalizedReason = requiredText(reason, "invalid_capture_issue");
  const persistenceOnly = PERSISTENCE_ONLY_CAPTURE_ISSUES.has(normalizedReason);
  return {
    captureWritable: persistenceOnly,
    persistenceWritable: false,
    standardExportAllowed: persistenceOnly,
    reason: normalizedReason,
  };
}

export function shouldProtectUnexportedHumanLabRecording(recording) {
  if (!recording || !["incomplete", "completed"].includes(recording.game?.status)) return false;
  const lastMutation = Number(recording.capture?.lastMutationSequence || 0);
  const lastExported = Number(recording.capture?.lastExportedSequence || 0);
  const lastRecoveryExported = Number(recording.capture?.lastRecoveryExportedSequence || 0);
  return Array.isArray(recording.decisions)
    && recording.decisions.length > 0
    && lastMutation > Math.max(lastExported, lastRecoveryExported);
}

function captureEnvelope({ kind, slot, stateHash, recording, createdAt }) {
  assert(recording && typeof recording === "object" && !Array.isArray(recording), "invalid_capture_recording");
  return {
    schema: HUMAN_LAB_CAPTURE_ENVELOPE_SCHEMA,
    kind: requiredText(kind, "invalid_capture_kind"),
    slot: requiredText(slot, "invalid_capture_slot"),
    stateHash: stateHash === null ? null : requiredText(stateHash, "invalid_capture_state_hash"),
    createdAt: requiredText(createdAt, "invalid_capture_timestamp"),
    recording: copy(recording),
  };
}

function parseEnvelope(raw) {
  let envelope;
  try {
    envelope = JSON.parse(String(raw));
  } catch {
    throw new Error("invalid_capture_envelope_json");
  }
  assert(envelope?.schema === HUMAN_LAB_CAPTURE_ENVELOPE_SCHEMA, "invalid_capture_envelope_schema");
  assert(envelope.recording && typeof envelope.recording === "object" && !Array.isArray(envelope.recording), "invalid_capture_recording");
  requiredText(envelope.kind, "invalid_capture_kind");
  requiredText(envelope.slot, "invalid_capture_slot");
  requiredText(envelope.createdAt, "invalid_capture_timestamp");
  if (envelope.stateHash !== null) requiredText(envelope.stateHash, "invalid_capture_state_hash");
  return envelope;
}

function assertStorage(storage) {
  assert(storage && typeof storage.getItem === "function" && typeof storage.setItem === "function", "invalid_capture_storage");
}

function declarationGroupKey(decision) {
  if (!decision || !Number.isInteger(decision.turn)) return null;
  if (typeof decision.phase !== "string" || !decision.phase) return null;
  if (typeof decision.side !== "string" || !decision.side) return null;
  return `${decision.turn}|${decision.phase}|${decision.side}`;
}

function failedObservedDecision(reason, error = null) {
  return { status: "failed", reason, decision: null, ...(error ? { error } : {}) };
}

function combatDeclarationIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.defenderId !== "string" || !value.defenderId) return null;
  if (!Array.isArray(value.attackerIds) || value.attackerIds.length === 0) return null;
  const attackerIds = value.attackerIds.map((id) => (
    typeof id === "string" && id ? id : null
  ));
  if (attackerIds.some((id) => id === null)) return null;
  if (new Set(attackerIds).size !== attackerIds.length) return null;
  return canonicalJson({ defenderId: value.defenderId, attackerIds: attackerIds.slice().sort() });
}

function sameStringMultiset(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = left.slice().sort();
  const rightSorted = right.slice().sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function continuityGap({
  inspectedDeclarationGroups,
  decision,
  expectedDeclarations,
  recordedDeclarations,
}) {
  return {
    ok: false,
    reason: "combat_declaration_continuity_gap",
    inspectedDeclarationGroups,
    turn: decision?.turn ?? null,
    phase: decision?.phase ?? null,
    side: decision?.side ?? null,
    expectedDeclarations,
    recordedDeclarations,
  };
}

function assertCaptureCodec(codec) {
  assert(codec && typeof codec.encode === "function" && typeof codec.decode === "function", "invalid_capture_codec");
}

function identityCaptureCodec() {
  return Object.freeze({
    encode: copy,
    decode: copy,
  });
}

function assertRecording(recording) {
  assert(recording && typeof recording === "object" && !Array.isArray(recording), "invalid_capture_recording");
}

export function humanLabStorageFailureReason(error) {
  return error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014
    ? "quota_exceeded"
    : "storage_write_failed";
}

/** Preserves the raw local recording when normal dataset construction cannot complete. */
export function serializeHumanLabRecoveryExport(recording, { exportedAt, reason } = {}) {
  assert(recording && typeof recording === "object" && !Array.isArray(recording), "invalid_capture_recording");
  return `${canonicalJson({
    schema: HUMAN_LAB_RECOVERY_EXPORT_SCHEMA,
    exportedAt: requiredText(exportedAt, "invalid_recovery_export_timestamp"),
    reason: requiredText(reason, "invalid_recovery_export_reason"),
    recording: copy(recording),
  })}\n`;
}

/** Records that the player safely downloaded a raw recovery bundle without mutating the source. */
export function acknowledgeHumanLabRecoveryExport(recording, { exportedAt } = {}) {
  assert(recording && typeof recording === "object" && !Array.isArray(recording), "invalid_capture_recording");
  const acknowledged = copy(recording);
  const lastMutation = Number(acknowledged.capture?.lastMutationSequence || 0);
  assert(Number.isInteger(lastMutation) && lastMutation >= 0, "invalid_capture_mutation_sequence");
  acknowledged.capture ||= {};
  acknowledged.capture.lastRecoveryExportedSequence = lastMutation;
  acknowledged.capture.lastRecoveryExportedAt = requiredText(exportedAt, "invalid_recovery_export_timestamp");
  return acknowledged;
}

function writeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
    return null;
  } catch (error) {
    return {
      status: "storage_failed",
      reason: humanLabStorageFailureReason(error),
      key,
    };
  }
}

function requiredText(value, reason) {
  assert(typeof value === "string" && value.length > 0, reason);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, reason) {
  if (!condition) throw new Error(reason);
}
