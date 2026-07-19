const WRITABLE_CAPTURE_STATUSES = new Set(["restored", "rebuilt"]);
const RECOVERABLE_CAPTURE_FAILURES = new Set(["archive_failed", "restore_failed", "state_unavailable"]);

/** Keeps a valid game continuation independent from recoverable Human Lab capture failures. */
export function humanLabContinuationPolicy(captureStatus) {
  if (WRITABLE_CAPTURE_STATUSES.has(captureStatus)) {
    return {
      allowContinuation: true,
      captureWritable: true,
      requiresExport: false,
      reason: null,
    };
  }
  if (RECOVERABLE_CAPTURE_FAILURES.has(captureStatus)) {
    return {
      allowContinuation: true,
      captureWritable: false,
      requiresExport: true,
      reason: captureStatus,
    };
  }
  if (captureStatus === "unavailable") {
    return {
      allowContinuation: true,
      captureWritable: false,
      requiresExport: false,
      reason: "unavailable",
    };
  }
  throw new Error("invalid_human_lab_capture_status");
}

/** Reports only the facts needed to render a local recovery/export affordance. */
export function humanLabRecordingRecoveryState(recording) {
  const decisionCount = Array.isArray(recording?.decisions) ? recording.decisions.length : 0;
  return {
    canExport: decisionCount > 0,
    decisionCount,
    gameStatus: typeof recording?.game?.status === "string" ? recording.game.status : null,
  };
}
