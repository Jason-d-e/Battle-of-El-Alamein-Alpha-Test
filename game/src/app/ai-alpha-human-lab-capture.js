export const HUMAN_LAB_CAPTURE_ENVELOPE_SCHEMA = "zizi-el-alamein-human-lab-capture-envelope-v1";
export const HUMAN_LAB_RECOVERY_EXPORT_SCHEMA = "zizi-el-alamein-human-lab-recovery-export-v1";

export function createHumanLabCaptureStore({
  storage,
  keyPrefix = "zizi-el-alamein-human-lab-capture-v1",
  now,
} = {}) {
  assertStorage(storage);
  assert(typeof now === "function", "human_lab_capture_clock_required");

  function writeCheckpoint(slot, { stateHash, recording }) {
    const envelope = captureEnvelope({ kind: "checkpoint", slot, stateHash, recording, createdAt: now() });
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
    return { status: "matched", recording: copy(envelope.recording), envelope: copy(envelope) };
  }

  function archiveRecording(recording, { reason, stateHash = null } = {}) {
    const gameId = requiredText(recording?.game?.id, "invalid_capture_game_id");
    const envelope = captureEnvelope({
      kind: "archive",
      slot: requiredText(reason, "invalid_capture_archive_reason"),
      stateHash,
      recording,
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

export function shouldProtectUnexportedHumanLabRecording(recording) {
  if (!recording || !["incomplete", "completed"].includes(recording.game?.status)) return false;
  const lastMutation = Number(recording.capture?.lastMutationSequence || 0);
  const lastExported = Number(recording.capture?.lastExportedSequence || 0);
  return Array.isArray(recording.decisions) && recording.decisions.length > 0 && lastMutation > lastExported;
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
