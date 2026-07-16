import { alphaHexGraphParameterCount } from "./ai-alpha-hex-graph.js";
import {
  validateAlphaModelArtifact,
  validateAlphaModelEnvironment,
  validateAlphaModelFeatureContract,
  validateAlphaModelSpatialContract,
} from "./ai-alpha-model.js";
import { canonicalSha256 } from "../../../shared/wargame-alpha/fingerprint.js";

export const LOCAL_ALPHA_PREVIEW_QUERY = "alphaPreview";
export const LOCAL_ALPHA_PREVIEW_ID = "local-mvp-2026-07-14";

const LOCAL_ALPHA_PREVIEW_CANDIDATES = Object.freeze({
  [LOCAL_ALPHA_PREVIEW_ID]: Object.freeze({
    url: "/.tmp/alpha-mvp/2026-07-14-local-alpha-mvp/candidate-explicit-a.json",
    fileSha256: "4727ce4a66aad11a66a448356b0e817af2df8ce57c9e494a760e5f60c6b53b5a",
    functionalFingerprint: "sha256:d6f7bc5c76ef27b7e097144aac51cedddb8171ce02177aa71c97ff0875bc004d",
    parameterCount: 1689,
    hiddenSize: 8,
    layerCount: 2,
  }),
});
const LOCAL_PREVIEW_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LOCAL_PREVIEW_PROTOCOLS = new Set(["http:", "https:"]);
const POLICY_ONLY_OUTCOME_SOURCES = new Set([
  "guard_zero",
  "policy_only_guard",
  "policy_only_merged",
  "policy_only_unlabeled",
  "policy_only_unresolved",
  "unresolved",
]);

export function alphaPreviewFunctionalFingerprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = { ...value };
  delete payload.generatedAt;
  return canonicalSha256(payload, "El Alamein local Alpha preview candidate");
}

export function resolveLocalAlphaPreviewRequest(locationLike) {
  const location = normalizedLocationUrl(locationLike);
  const previewId = location?.searchParams?.get(LOCAL_ALPHA_PREVIEW_QUERY);
  if (!previewId) {
    return {
      requested: false,
      status: "inactive",
      previewId: null,
      url: null,
      reason: null,
    };
  }
  const candidate = LOCAL_ALPHA_PREVIEW_CANDIDATES[previewId] || null;
  if (!candidate) return failedPreviewRequest(previewId, "unknown_preview_candidate");
  if (
    !location
    || !LOCAL_PREVIEW_PROTOCOLS.has(location.protocol)
    || !LOCAL_PREVIEW_HOSTS.has(location.hostname)
  ) {
    return failedPreviewRequest(previewId, "preview_origin_not_local");
  }
  return {
    requested: true,
    status: "requested",
    previewId,
    url: candidate.url,
    reason: null,
    expectedFunctionalFingerprint: candidate.functionalFingerprint,
    expectedFileSha256: candidate.fileSha256,
  };
}

export async function loadLocalAlphaPreviewModel({
  location = globalThis.location,
  loadJson,
} = {}) {
  const request = resolveLocalAlphaPreviewRequest(location);
  if (!request.requested) {
    return {
      requested: false,
      status: "inactive",
      modelLoad: null,
      previewValidationOptions: null,
    };
  }
  if (request.status !== "requested") return failedPreviewLoad(request.previewId, request.reason);
  if (typeof loadJson !== "function") return failedPreviewLoad(request.previewId, "preview_loader_missing");
  let loaded;
  try {
    loaded = await loadJson(request.url);
  } catch {
    return failedPreviewLoad(request.previewId, "preview_model_load_failed");
  }
  if (!loaded || (loaded.status !== "loaded" && loaded.status !== "preview") || !loaded.value) {
    const reason = loaded?.status === "missing" || loaded?.reason === "model_missing"
      ? "preview_model_missing"
      : "preview_model_load_failed";
    return failedPreviewLoad(request.previewId, reason);
  }
  return {
    requested: true,
    status: "preview",
    modelLoad: {
      status: "preview",
      value: loaded.value,
      reason: null,
      previewId: request.previewId,
      sourceUrl: request.url,
    },
    previewValidationOptions: {
      previewId: request.previewId,
    },
  };
}

export function validateLocalAlphaPreviewModel(value, {
  previewId = null,
  expectedEnvironment = null,
  expectedFeatureContract = null,
  expectedSpatialContract = null,
} = {}) {
  const preview = LOCAL_ALPHA_PREVIEW_CANDIDATES[previewId] || null;
  if (!preview) return failedPreviewValidation("unknown_preview_candidate", { previewId });
  return validateAlphaPreviewModelCandidate(value, {
    previewId,
    candidateDescriptor: preview,
    expectedEnvironment,
    expectedFeatureContract,
    expectedSpatialContract,
  });
}

export function validateAlphaPreviewModelCandidate(value, {
  previewId = null,
  candidateDescriptor = null,
  expectedEnvironment = null,
  expectedFeatureContract = null,
  expectedSpatialContract = null,
} = {}) {
  if (
    !candidateDescriptor
    || typeof candidateDescriptor !== "object"
    || typeof candidateDescriptor.functionalFingerprint !== "string"
    || !Number.isFinite(Number(candidateDescriptor.parameterCount))
    || !Number.isFinite(Number(candidateDescriptor.hiddenSize))
    || !Number.isFinite(Number(candidateDescriptor.layerCount))
  ) {
    return failedPreviewValidation("preview_candidate_contract_missing", { previewId });
  }
  const artifact = validateAlphaModelArtifact(value);
  if (!artifact.ok) return failedPreviewValidation(artifact.reason, { previewId });
  const candidateFingerprint = alphaPreviewFunctionalFingerprint(value);
  if (candidateFingerprint !== candidateDescriptor.functionalFingerprint) {
    return failedPreviewValidation("preview_candidate_fingerprint_mismatch", {
      previewId,
      candidateFingerprint,
    });
  }
  if (artifact.model.release) {
    return failedPreviewValidation("preview_candidate_has_release_metadata", {
      previewId,
      candidateFingerprint,
    });
  }
  const environment = validateAlphaModelEnvironment(artifact.model, expectedEnvironment, {
    requireEnvironmentFingerprint: true,
  });
  if (!environment.ok) {
    return failedPreviewValidation(environment.reason, {
      previewId,
      candidateFingerprint,
      environment,
    });
  }
  const featureContract = validateAlphaModelFeatureContract(artifact.model, expectedFeatureContract, {
    requireFeatureContract: true,
  });
  if (!featureContract.ok) {
    return failedPreviewValidation(featureContract.reason, {
      previewId,
      candidateFingerprint,
      environment,
      featureContract,
    });
  }
  const spatialContract = validateAlphaModelSpatialContract(artifact.model, expectedSpatialContract);
  if (!spatialContract.ok) {
    return failedPreviewValidation(spatialContract.reason, {
      previewId,
      candidateFingerprint,
      environment,
      featureContract,
      spatialContract,
    });
  }
  const parameterCount = alphaHexGraphParameterCount(artifact.model.hexGraph);
  if (
    parameterCount !== Number(candidateDescriptor.parameterCount)
    || artifact.model.hexGraph?.hiddenSize !== Number(candidateDescriptor.hiddenSize)
    || artifact.model.hexGraph?.layers?.length !== Number(candidateDescriptor.layerCount)
  ) {
    return failedPreviewValidation("preview_candidate_architecture_mismatch", {
      previewId,
      candidateFingerprint,
      environment,
      featureContract,
      spatialContract,
      parameterCount,
    });
  }
  const trainingValidation = artifact.model.training?.validation || null;
  const trainingData = artifact.model.training?.data || null;
  const evidenceFailure = previewTrainingEvidenceFailure(trainingData, trainingValidation);
  if (evidenceFailure) {
    return failedPreviewValidation(evidenceFailure, {
      previewId,
      candidateFingerprint,
      environment,
      featureContract,
      spatialContract,
      parameterCount,
      trainingValidation,
    });
  }
  return {
    ok: true,
    reason: null,
    model: artifact.model,
    validationMode: "local_preview",
    previewId,
    candidateFingerprint,
    environment,
    featureContract,
    spatialContract,
    parameterCount,
    trainingValidation,
  };
}

function previewTrainingEvidenceFailure(training, validation) {
  if (!training || !validation) return "preview_training_evidence_missing";
  if (validation.explicitValidation !== true) return "preview_validation_not_explicit";
  if (validation.validationGroupBy !== "trajectory") return "preview_validation_not_trajectory_grouped";
  if (Number(validation.trainingTrajectories || 0) < 1 || Number(validation.validationTrajectories || 0) < 1) {
    return "preview_validation_trajectories_missing";
  }
  if (
    validation.trajectoryOverlapCount !== 0
    || validation.stateHashOverlapCount !== 0
    || validation.crossSplitComponentCount !== 0
  ) return "preview_validation_overlap_detected";
  if ([
    validation.environmentFingerprint,
    validation.trainingArtifactFingerprint,
    validation.validationArtifactFingerprint,
    validation.trainingFileSha256,
    validation.validationFileSha256,
  ].some((fingerprint) => !fingerprint)) return "preview_validation_fingerprint_missing";
  if (Object.keys(training.sides || {}).length < 2 || Object.keys(validation.sides || {}).length < 2) {
    return "preview_validation_side_coverage_too_narrow";
  }
  if (Object.keys(training.phases || {}).length < 2 || Object.keys(validation.phases || {}).length < 2) {
    return "preview_validation_phase_coverage_too_narrow";
  }
  if (Number(training.valueSamples || 0) !== 0 || Number(validation.value?.samples || 0) !== 0) {
    return "preview_untrusted_value_labels_present";
  }
  if (Object.keys(training.outcomeSources || {}).some((source) => !POLICY_ONLY_OUTCOME_SOURCES.has(source))) {
    return "preview_untrusted_outcome_source";
  }
  return null;
}

function normalizedLocationUrl(locationLike) {
  try {
    if (locationLike instanceof URL) return locationLike;
    if (typeof locationLike?.href === "string") return new URL(locationLike.href);
    if (typeof locationLike === "string") return new URL(locationLike);
  } catch {
    return null;
  }
  return null;
}

function failedPreviewRequest(previewId, reason) {
  return {
    requested: true,
    status: "failed",
    previewId,
    url: null,
    reason,
  };
}

function failedPreviewLoad(previewId, reason) {
  return {
    requested: true,
    status: "failed",
    modelLoad: {
      status: "failed",
      value: null,
      reason,
      previewId,
    },
    previewValidationOptions: null,
  };
}

function failedPreviewValidation(reason, details = {}) {
  return {
    ok: false,
    reason,
    model: null,
    validationMode: "local_preview",
    previewId: details.previewId || null,
    candidateFingerprint: details.candidateFingerprint || null,
    environment: details.environment || null,
    featureContract: details.featureContract || null,
    spatialContract: details.spatialContract || null,
    parameterCount: details.parameterCount ?? null,
    trainingValidation: details.trainingValidation || null,
  };
}
