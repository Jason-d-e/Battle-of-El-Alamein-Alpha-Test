import {
  alphaDenseNetworkParameterCount,
  normalizeAlphaDenseNetwork,
} from "./ai-alpha-network.js";
import {
  alphaHexGraphParameterCount,
  normalizeAlphaHexGraphModel,
} from "./ai-alpha-hex-graph.js";

export const ALPHA_MODEL_SCHEMA = "zizi-el-alamein-alpha-model-v1";
export const ALPHA_VALUE_MODEL_SCHEMA = "zizi-el-alamein-alpha-value-model-v1";
export const ALPHA_POLICY_MODEL_SCHEMA = "zizi-el-alamein-alpha-policy-model-v1";
export const ALPHA_RELEASE_METADATA_SCHEMA = "zizi-el-alamein-alpha-release-metadata-v1";
export const ALPHA_TRAINING_METADATA_SCHEMA = "zizi-el-alamein-alpha-training-metadata-v1";
export const ALPHA_TRAINING_DATA_SUMMARY_SCHEMA = "zizi-el-alamein-alpha-training-data-summary-v1";
export const ALPHA_TRAINING_VALIDATION_SCHEMA = "zizi-el-alamein-alpha-training-validation-v1";
export const ALPHA_TRAINING_PROFILE_EVIDENCE_SCHEMA = "zizi-el-alamein-alpha-training-profile-evidence-v1";
export const ALPHA_ENVIRONMENT_SCHEMA = "zizi-el-alamein-alpha-environment-v1";
export const ALPHA_FEATURE_CONTRACT_SCHEMA = "zizi-el-alamein-alpha-feature-contract-v1";
const SUPPORTED_TRAINING_VALIDATION_GROUP_BY = Object.freeze(["sample", "stateHash", "side", "phase", "trajectory"]);

export function extractAlphaModelArtifact(value) {
  if (!value || typeof value !== "object") return null;
  const direct = normalizeAlphaModelArtifact(value);
  if (direct) return direct;
  for (const key of ["activeModel", "candidateModel", "model", "baseModel"]) {
    const nested = normalizeAlphaModelArtifact(value[key]);
    if (nested) return nested;
  }
  return null;
}

export function extractReleasedAlphaModelArtifact(value, options = {}) {
  const validation = validateReleasedAlphaModelArtifact(value, options);
  return validation.ok ? validation.model : null;
}

export function validateAlphaModelArtifact(value) {
  const model = normalizeAlphaModelArtifact(value);
  if (!model) {
    return {
      ok: false,
      reason: "invalid_alpha_model",
      model: null,
    };
  }
  return {
    ok: true,
    reason: null,
    model,
  };
}

export function validateReleasedAlphaModelArtifact(value, options = {}) {
  const validation = validateAlphaModelArtifact(value);
  if (!validation.ok) return validation;
  const release = validation.model.release;
  const minSuiteGames = Math.max(0, Number(options.minSuiteGames ?? 2));
  const minSuiteSides = Math.max(0, Number(options.minSuiteSides ?? 2));
  const minEvaluationPhases = Math.max(0, Number(options.minEvaluationPhases ?? release?.minEvaluationPhases ?? 0));
  const minFixedPositions = Math.max(0, Number(options.minFixedPositions ?? 0));
  const minChallengePositions = Math.max(0, Number(options.minChallengePositions ?? 0));
  const maxErrors = Math.max(0, Number(options.maxErrors ?? 0));
  const requireExplicitSuite = options.requireExplicitSuite !== false;
  const requireSourceFingerprint = options.requireSourceFingerprint !== false;
  const minSideScore = optionalFiniteOrNull(options.minSideScore ?? release?.minSideScore);
  const minSideScoreDelta = optionalFiniteOrNull(options.minSideScoreDelta ?? release?.minSideScoreDelta);
  const minScoreLowerBound = optionalFiniteOrNull(options.minScoreLowerBound ?? release?.minScoreLowerBound);
  const minEloLowerBound = optionalFiniteOrNull(options.minEloLowerBound ?? release?.minEloLowerBound);
  const maxArenaDrawRate = optionalFiniteOrNull(options.maxArenaDrawRate ?? release?.maxArenaDrawRate);
  const minArenaDecisiveRate = optionalFiniteOrNull(options.minArenaDecisiveRate ?? release?.minArenaDecisiveRate);
  const minAnalyzedActions = optionalFiniteOrNull(options.minAnalyzedActions ?? release?.minAnalyzedActions);
  const minAverageRootVisits = optionalFiniteOrNull(options.minAverageRootVisits ?? release?.minAverageRootVisits);
  const minCandidateAnalyzedActions = optionalFiniteOrNull(
    options.minCandidateAnalyzedActions ?? release?.minCandidateAnalyzedActions,
  );
  const minCandidateAverageRootVisits = optionalFiniteOrNull(
    options.minCandidateAverageRootVisits ?? release?.minCandidateAverageRootVisits,
  );
  const minCandidateDecisionActionTypes = optionalFiniteOrNull(
    options.minCandidateDecisionActionTypes ?? release?.minCandidateDecisionActionTypes,
  );
  const minCandidateDecisionAverageRecommendationConfidence = optionalFiniteOrNull(
    options.minCandidateDecisionAverageRecommendationConfidence ?? release?.minCandidateDecisionAverageRecommendationConfidence,
  );
  const maxCandidateDecisionAverageRecommendationUncertainty = optionalFiniteOrNull(
    options.maxCandidateDecisionAverageRecommendationUncertainty ?? release?.maxCandidateDecisionAverageRecommendationUncertainty,
  );
  const minCandidateDecisionSelectedActionShare = optionalFiniteOrNull(
    options.minCandidateDecisionSelectedActionShare ?? release?.minCandidateDecisionSelectedActionShare,
  );
  const minDecisionAverageRecommendationConfidence = optionalFiniteOrNull(
    options.minDecisionAverageRecommendationConfidence ?? release?.minDecisionAverageRecommendationConfidence,
  );
  const maxDecisionAverageRecommendationUncertainty = optionalFiniteOrNull(
    options.maxDecisionAverageRecommendationUncertainty ?? release?.maxDecisionAverageRecommendationUncertainty,
  );
  const minDecisionSelectedActionShare = optionalFiniteOrNull(
    options.minDecisionSelectedActionShare ?? release?.minDecisionSelectedActionShare,
  );
  const minDecisionActionTypes = optionalFiniteOrNull(
    options.minDecisionActionTypes ?? release?.minDecisionActionTypes,
  );
  const maxDecisionFallbackRate = optionalFiniteOrNull(
    options.maxDecisionFallbackRate ?? release?.maxDecisionFallbackRate,
  );
  const minReferenceArenaScore = optionalFiniteOrNull(options.minReferenceArenaScore ?? release?.minReferenceArenaScore);
  const minReferenceArenaReferences = optionalFiniteOrNull(
    options.minReferenceArenaReferences ?? release?.minReferenceArenaReferences,
  );
  const maxReferenceArenaErrors = optionalFiniteOrNull(options.maxReferenceArenaErrors ?? release?.maxReferenceArenaErrors);
  const minChallengeAverageRecommendationUncertainty = optionalFiniteOrNull(
    options.minChallengeAverageRecommendationUncertainty ?? release?.minChallengeAverageRecommendationUncertainty,
  );
  const minContestedChallengePositions = optionalFiniteOrNull(
    options.minContestedChallengePositions ?? release?.minContestedChallengePositions,
  );
  const minChallengeAverageRuntimeRisk = optionalFiniteOrNull(
    options.minChallengeAverageRuntimeRisk ?? release?.minChallengeAverageRuntimeRisk,
  );
  const minRuntimeRiskChallengePositions = optionalFiniteOrNull(
    options.minRuntimeRiskChallengePositions ?? release?.minRuntimeRiskChallengePositions,
  );
  const requiredTrainingProfile = stringOrNull(options.requiredTrainingProfile ?? release?.requiredTrainingProfile);
  const trainingGate = trainingDataGate(validation.model.training?.data, {
    minTrainingSamples: options.minTrainingSamples ?? release?.minTrainingSamples,
    minTrainingValueSamples: options.minTrainingValueSamples ?? release?.minTrainingValueSamples,
    minTrainingOutcomeClasses: options.minTrainingOutcomeClasses ?? release?.minTrainingOutcomeClasses,
    minTrainingPolicyRows: options.minTrainingPolicyRows ?? release?.minTrainingPolicyRows,
    minTrainingPolicyActionTypes: options.minTrainingPolicyActionTypes ?? release?.minTrainingPolicyActionTypes,
    minTrainingUniqueStateHashes: options.minTrainingUniqueStateHashes ?? release?.minTrainingUniqueStateHashes,
    maxTrainingDuplicateStateRate: options.maxTrainingDuplicateStateRate ?? release?.maxTrainingDuplicateStateRate,
    minTrainingSides: options.minTrainingSides ?? release?.minTrainingSides,
    minTrainingSources: options.minTrainingSources ?? release?.minTrainingSources,
    minTrainingReanalysisSamples: options.minTrainingReanalysisSamples ?? release?.minTrainingReanalysisSamples,
    minTrainingStateSnapshots: options.minTrainingStateSnapshots ?? release?.minTrainingStateSnapshots,
    minTrainingAverageRootVisits: options.minTrainingAverageRootVisits ?? release?.minTrainingAverageRootVisits,
    minTrainingSelectedActionShare: options.minTrainingSelectedActionShare ?? release?.minTrainingSelectedActionShare,
    minTrainingExplorationShare: options.minTrainingExplorationShare ?? release?.minTrainingExplorationShare,
  });
  const validationGate = trainingValidationGate(validation.model.training?.validation, {
    minTrainingValidationSamples: options.minTrainingValidationSamples ?? release?.minTrainingValidationSamples,
    minTrainingValidationSides: options.minTrainingValidationSides ?? release?.minTrainingValidationSides,
    minTrainingValidationPhases: options.minTrainingValidationPhases ?? release?.minTrainingValidationPhases,
    minTrainingValidationGroups: options.minTrainingValidationGroups ?? release?.minTrainingValidationGroups,
    requiredTrainingValidationGroupBy: options.requiredTrainingValidationGroupBy ?? release?.requiredTrainingValidationGroupBy,
    maxTrainingValidationValueMse: options.maxTrainingValidationValueMse ?? release?.maxTrainingValidationValueMse,
    maxTrainingValidationValueCalibrationBias: options.maxTrainingValidationValueCalibrationBias
      ?? release?.maxTrainingValidationValueCalibrationBias,
    maxTrainingValidationPolicyCrossEntropy: options.maxTrainingValidationPolicyCrossEntropy ?? release?.maxTrainingValidationPolicyCrossEntropy,
    minTrainingValidationPolicyTopChoiceAccuracy: options.minTrainingValidationPolicyTopChoiceAccuracy
      ?? release?.minTrainingValidationPolicyTopChoiceAccuracy,
  });
  const expectedEnvironment = normalizeAlphaModelEnvironment(options.expectedEnvironment)
    || alphaModelEnvironmentFingerprint({ scenario: options.scenario, rules: options.rules });
  const environmentGate = validateAlphaModelEnvironment(validation.model, expectedEnvironment, {
    requireEnvironmentFingerprint: options.requireEnvironmentFingerprint,
  });
  const expectedFeatureContract = normalizeAlphaModelFeatureContract(options.expectedFeatureContract);
  const featureContractGate = validateAlphaModelFeatureContract(validation.model, expectedFeatureContract, {
    requireFeatureContract: options.requireFeatureContract,
  });
  const spatialContractGate = validateAlphaModelSpatialContract(validation.model, options.expectedSpatialContract);
  if (!release) return releaseValidationError("missing_release_metadata", validation.model);
  if (!release.promoted) return releaseValidationError("model_not_promoted", validation.model);
  const promotionVerdictGateResult = promotionVerdictGate(release.promotionVerdict);
  if (!promotionVerdictGateResult.ok) {
    return releaseValidationError(promotionVerdictGateResult.reason, validation.model);
  }
  if (requireSourceFingerprint && !release.sourceArtifact) {
    return releaseValidationError("missing_release_source_artifact", validation.model);
  }
  if (requireSourceFingerprint && !release.sourceHash) {
    return releaseValidationError("missing_release_source_hash", validation.model);
  }
  if (Number(release.errors || 0) > maxErrors) return releaseValidationError("release_errors_exceed_limit", validation.model);
  if (requireExplicitSuite && !release.evaluationSuite?.explicit) {
    return releaseValidationError("evaluation_suite_not_explicit", validation.model);
  }
  if (Number(release.evaluationSuite?.games || 0) < minSuiteGames) {
    return releaseValidationError("evaluation_suite_too_small", validation.model);
  }
  if (Number(release.evaluationSuite?.sides || 0) < minSuiteSides) {
    return releaseValidationError("evaluation_suite_side_coverage_too_narrow", validation.model);
  }
  if (Number(release.evaluationSuite?.phaseCoverage?.phases || 0) < minEvaluationPhases) {
    return releaseValidationError("evaluation_suite_phase_coverage_too_narrow", validation.model);
  }
  if (Number(release.evaluationSuite?.fixedPositions || 0) < minFixedPositions) {
    return releaseValidationError("evaluation_suite_fixed_positions_too_few", validation.model);
  }
  if (Number(release.evaluationSuite?.challengePositions || 0) < minChallengePositions) {
    return releaseValidationError("evaluation_suite_challenge_positions_too_few", validation.model);
  }
  const challengeQualityGateResult = challengeQualityGate(release.evaluationSuite?.challengeQuality, {
    minChallengeAverageRecommendationUncertainty,
    minContestedChallengePositions,
    minChallengeAverageRuntimeRisk,
    minRuntimeRiskChallengePositions,
  });
  if (!challengeQualityGateResult.ok) {
    return releaseValidationError(challengeQualityGateResult.reason, validation.model);
  }
  const profileGate = trainingProfileGate(release.trainingProfile, requiredTrainingProfile);
  if (!profileGate.ok) return releaseValidationError(profileGate.reason, validation.model);
  if (minSideScore !== null) {
    if (!release.sideScores?.length) return releaseValidationError("missing_side_score_evidence", validation.model);
    const weakSide = release.sideScores.find((score) => (
      Number(score.scoredGames || 0) < 1 || Number(score.candidateScore || 0) < minSideScore
    ));
    if (weakSide) return releaseValidationError("candidate_side_score_below_threshold", validation.model);
  }
  if (minSideScoreDelta !== null) {
    if (!release.sideScores?.length) return releaseValidationError("missing_side_score_evidence", validation.model);
    const weakSide = release.sideScores.find((score) => (
      Number(score.scoredGames || 0) < 1
      || optionalFiniteOrNull(score.scoreDelta) === null
      || Number(score.scoreDelta) < minSideScoreDelta
    ));
    if (weakSide || release.sideScoreDeltaPass === false) {
      return releaseValidationError("candidate_side_score_delta_below_threshold", validation.model);
    }
  }
  if (minScoreLowerBound !== null) {
    if (!release.arena?.scoreInterval95) return releaseValidationError("missing_arena_evidence", validation.model);
    if (
      release.scoreLowerBoundPass === false
      || Number(release.arena.scoreInterval95.low || 0) < minScoreLowerBound
    ) {
      return releaseValidationError("candidate_score_lower_bound_below_threshold", validation.model);
    }
  }
  if (minEloLowerBound !== null) {
    if (!release.arena?.eloDiffInterval95) return releaseValidationError("missing_arena_evidence", validation.model);
    if (
      release.eloLowerBoundPass === false
      || Number(release.arena.eloDiffInterval95.low || 0) < minEloLowerBound
    ) {
      return releaseValidationError("candidate_elo_lower_bound_below_threshold", validation.model);
    }
  }
  if (maxArenaDrawRate !== null || minArenaDecisiveRate !== null) {
    if (!release.arena || Number(release.arena.scoredGames || 0) < 1) {
      return releaseValidationError("missing_arena_evidence", validation.model);
    }
    if (
      maxArenaDrawRate !== null
      && (
        release.drawRatePass === false
        || Number(release.arena.drawRate || 0) > maxArenaDrawRate
      )
    ) {
      return releaseValidationError("arena_draw_rate_too_high", validation.model);
    }
    if (
      minArenaDecisiveRate !== null
      && (
        release.decisiveRatePass === false
        || Number(release.arena.decisiveRate || 0) < minArenaDecisiveRate
      )
    ) {
      return releaseValidationError("arena_decisive_rate_too_low", validation.model);
    }
  }
  if (
    minAnalyzedActions !== null
    || minAverageRootVisits !== null
    || minDecisionAverageRecommendationConfidence !== null
    || maxDecisionAverageRecommendationUncertainty !== null
    || minDecisionSelectedActionShare !== null
    || minDecisionActionTypes !== null
    || maxDecisionFallbackRate !== null
  ) {
    if (!release.decisionEvidence) return releaseValidationError("missing_decision_evidence", validation.model);
    if (minAnalyzedActions !== null && Number(release.decisionEvidence.analyzedActions || 0) < minAnalyzedActions) {
      return releaseValidationError("decision_evidence_too_few_analyzed_actions", validation.model);
    }
    if (minAverageRootVisits !== null && Number(release.decisionEvidence.averageRootVisits || 0) < minAverageRootVisits) {
      return releaseValidationError("decision_evidence_root_visits_too_low", validation.model);
    }
    if (minDecisionActionTypes !== null && countActionTypes(release.decisionEvidence.actionTypes) < minDecisionActionTypes) {
      return releaseValidationError("decision_evidence_action_coverage_too_narrow", validation.model);
    }
    if (
      minDecisionAverageRecommendationConfidence !== null
      && (
        release.decisionEvidence.averageRecommendationConfidence === null
        || release.decisionEvidence.averageRecommendationConfidence === undefined
        || Number(release.decisionEvidence.averageRecommendationConfidence) < minDecisionAverageRecommendationConfidence
      )
    ) {
      return releaseValidationError("decision_evidence_confidence_too_low", validation.model);
    }
    if (
      maxDecisionAverageRecommendationUncertainty !== null
      && (
        release.decisionEvidence.averageRecommendationUncertainty === null
        || release.decisionEvidence.averageRecommendationUncertainty === undefined
        || Number(release.decisionEvidence.averageRecommendationUncertainty) > maxDecisionAverageRecommendationUncertainty
      )
    ) {
      return releaseValidationError("decision_evidence_uncertainty_too_high", validation.model);
    }
    if (
      minDecisionSelectedActionShare !== null
      && (
        release.decisionEvidence.selectedActionShare === null
        || release.decisionEvidence.selectedActionShare === undefined
        || Number(release.decisionEvidence.selectedActionShare) < minDecisionSelectedActionShare
      )
    ) {
      return releaseValidationError("decision_evidence_selected_share_too_low", validation.model);
    }
    if (maxDecisionFallbackRate !== null) {
      const fallbackRate = decisionFallbackRate(release.decisionEvidence);
      if (fallbackRate === null) return releaseValidationError("decision_evidence_too_few_decisions", validation.model);
      if (fallbackRate > maxDecisionFallbackRate) {
        return releaseValidationError("decision_evidence_fallback_rate_too_high", validation.model);
      }
    }
  }
  if (
    minCandidateAnalyzedActions !== null
    || minCandidateAverageRootVisits !== null
    || minCandidateDecisionActionTypes !== null
    || minCandidateDecisionAverageRecommendationConfidence !== null
    || maxCandidateDecisionAverageRecommendationUncertainty !== null
    || minCandidateDecisionSelectedActionShare !== null
  ) {
    const candidate = release.decisionEvidence?.roles?.candidate;
    if (!candidate || Number(candidate.actionCount || 0) < 1) {
      return releaseValidationError("missing_candidate_decision_evidence", validation.model);
    }
    if (
      minCandidateAnalyzedActions !== null
      && Number(candidate.analyzedActions || 0) < minCandidateAnalyzedActions
    ) {
      return releaseValidationError("candidate_decision_evidence_too_few_analyzed_actions", validation.model);
    }
    if (
      minCandidateAverageRootVisits !== null
      && Number(candidate.averageRootVisits || 0) < minCandidateAverageRootVisits
    ) {
      return releaseValidationError("candidate_decision_evidence_root_visits_too_low", validation.model);
    }
    if (minCandidateDecisionActionTypes !== null && countActionTypes(candidate.actionTypes) < minCandidateDecisionActionTypes) {
      return releaseValidationError("candidate_decision_evidence_action_coverage_too_narrow", validation.model);
    }
    if (
      minCandidateDecisionAverageRecommendationConfidence !== null
      && (
        candidate.averageRecommendationConfidence === null
        || candidate.averageRecommendationConfidence === undefined
        || Number(candidate.averageRecommendationConfidence) < minCandidateDecisionAverageRecommendationConfidence
      )
    ) {
      return releaseValidationError("candidate_decision_evidence_confidence_too_low", validation.model);
    }
    if (
      maxCandidateDecisionAverageRecommendationUncertainty !== null
      && (
        candidate.averageRecommendationUncertainty === null
        || candidate.averageRecommendationUncertainty === undefined
        || Number(candidate.averageRecommendationUncertainty) > maxCandidateDecisionAverageRecommendationUncertainty
      )
    ) {
      return releaseValidationError("candidate_decision_evidence_uncertainty_too_high", validation.model);
    }
    if (
      minCandidateDecisionSelectedActionShare !== null
      && (
        candidate.selectedActionShare === null
        || candidate.selectedActionShare === undefined
        || Number(candidate.selectedActionShare) < minCandidateDecisionSelectedActionShare
      )
    ) {
      return releaseValidationError("candidate_decision_evidence_selected_share_too_low", validation.model);
    }
  }
  if (!trainingGate.ok) return releaseValidationError(trainingGate.reason, validation.model);
  if (!validationGate.ok) return releaseValidationError(validationGate.reason, validation.model);
  const referenceGate = referenceArenaGate(release.referenceArena, {
    minReferenceArenaScore,
    minReferenceArenaReferences,
    maxReferenceArenaErrors,
  });
  if (!referenceGate.ok) return releaseValidationError(referenceGate.reason, validation.model);
  if (!environmentGate.ok) return releaseValidationError(environmentGate.reason, validation.model, environmentGate);
  if (!featureContractGate.ok) {
    return releaseValidationError(featureContractGate.reason, validation.model, environmentGate, featureContractGate);
  }
  if (!spatialContractGate.ok) {
    return releaseValidationError(
      spatialContractGate.reason,
      validation.model,
      environmentGate,
      featureContractGate,
      spatialContractGate,
    );
  }
  return {
    ...validation,
    environment: environmentGate,
    featureContract: featureContractGate,
    spatialContract: spatialContractGate,
  };
}

export function validateAlphaModelSpatialContract(modelOrArtifact, expectedContract = null) {
  const model = normalizeAlphaModelArtifact(modelOrArtifact);
  const hexGraph = model?.hexGraph || normalizeAlphaHexGraphModel(modelOrArtifact?.hexGraph ?? modelOrArtifact);
  if (!hexGraph) return { ok: true, reason: null, match: null, fingerprint: null, expectedFingerprint: null };
  const fingerprint = hexGraph.contractFingerprint;
  const expectedFingerprint = typeof expectedContract?.fingerprint === "string" ? expectedContract.fingerprint : null;
  if (!expectedFingerprint) return { ok: true, reason: null, match: null, fingerprint, expectedFingerprint: null };
  const match = fingerprint === expectedFingerprint;
  return {
    ok: match,
    reason: match ? null : "model_spatial_contract_mismatch",
    match,
    fingerprint,
    expectedFingerprint,
  };
}

export function normalizeAlphaModelArtifact(value) {
  if (!value || typeof value !== "object") return null;
  if (value.schema !== ALPHA_MODEL_SCHEMA) return null;
  const valueModel = normalizeSubModel(value.value, ALPHA_VALUE_MODEL_SCHEMA);
  const policyModel = normalizeSubModel(value.policy, ALPHA_POLICY_MODEL_SCHEMA);
  const hexGraph = normalizeAlphaHexGraphModel(value.hexGraph);
  if (!valueModel && !policyModel && !hexGraph) return null;
  return {
    schema: ALPHA_MODEL_SCHEMA,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null,
    method: typeof value.method === "string" ? value.method : "unknown",
    sampleCount: finiteNumber(value.sampleCount, 0),
    sources: Array.isArray(value.sources) ? value.sources.map(String) : [],
    environment: normalizeAlphaModelEnvironment(value.environment),
    featureContract: normalizeAlphaModelFeatureContract(value.featureContract),
    training: normalizeAlphaTrainingMetadata(value.training),
    value: valueModel,
    policy: policyModel,
    hexGraph,
    release: normalizeAlphaReleaseMetadata(value.release),
  };
}

export function alphaModelMetadata(value) {
  const model = normalizeAlphaModelArtifact(value);
  if (!model) return null;
  return {
    schema: model.schema,
    generatedAt: model.generatedAt,
    method: model.method,
    sampleCount: model.sampleCount,
    sources: model.sources.slice(),
    environment: model.environment,
    featureContract: model.featureContract,
    hasValue: Boolean(model.value),
    hasPolicy: Boolean(model.policy),
    hasHexGraph: Boolean(model.hexGraph),
    valueWeights: model.value ? Object.keys(model.value.weights).length : 0,
    policyWeights: model.policy ? Object.keys(model.policy.weights).length : 0,
    valueArchitecture: model.value?.architecture || "linear-v1",
    policyArchitecture: model.policy?.architecture || "linear-v1",
    valueNetworkParameters: alphaDenseNetworkParameterCount(model.value?.network),
    policyNetworkParameters: alphaDenseNetworkParameterCount(model.policy?.network),
    hexGraphParameters: alphaHexGraphParameterCount(model.hexGraph),
    training: model.training ? {
      schema: model.training.schema,
      warmStarted: model.training.warmStarted,
      parent: model.training.parent,
      data: model.training.data,
      validation: model.training.validation,
    } : null,
    release: model.release ? {
      schema: model.release.schema,
      releasedAt: model.release.releasedAt,
      sourceSchema: model.release.sourceSchema,
      sourceArtifact: model.release.sourceArtifact,
      sourceHash: model.release.sourceHash,
      sourceSizeBytes: model.release.sourceSizeBytes,
      candidateScore: model.release.candidateScore,
      minSideScore: model.release.minSideScore,
      minSideScoreDelta: model.release.minSideScoreDelta,
      minScoreLowerBound: model.release.minScoreLowerBound,
      minEloLowerBound: model.release.minEloLowerBound,
      maxArenaDrawRate: model.release.maxArenaDrawRate,
      minArenaDecisiveRate: model.release.minArenaDecisiveRate,
      minAnalyzedActions: model.release.minAnalyzedActions,
      minAverageRootVisits: model.release.minAverageRootVisits,
      minCandidateAnalyzedActions: model.release.minCandidateAnalyzedActions,
      minCandidateAverageRootVisits: model.release.minCandidateAverageRootVisits,
      minCandidateDecisionActionTypes: model.release.minCandidateDecisionActionTypes,
      minCandidateDecisionAverageRecommendationConfidence: model.release.minCandidateDecisionAverageRecommendationConfidence,
      maxCandidateDecisionAverageRecommendationUncertainty: model.release.maxCandidateDecisionAverageRecommendationUncertainty,
      minCandidateDecisionSelectedActionShare: model.release.minCandidateDecisionSelectedActionShare,
      minDecisionAverageRecommendationConfidence: model.release.minDecisionAverageRecommendationConfidence,
      maxDecisionAverageRecommendationUncertainty: model.release.maxDecisionAverageRecommendationUncertainty,
      minDecisionSelectedActionShare: model.release.minDecisionSelectedActionShare,
      minDecisionActionTypes: model.release.minDecisionActionTypes,
      maxDecisionFallbackRate: model.release.maxDecisionFallbackRate,
      minReferenceArenaScore: model.release.minReferenceArenaScore,
      minReferenceArenaReferences: model.release.minReferenceArenaReferences,
      maxReferenceArenaErrors: model.release.maxReferenceArenaErrors,
      minChallengeAverageRecommendationUncertainty: model.release.minChallengeAverageRecommendationUncertainty,
      minContestedChallengePositions: model.release.minContestedChallengePositions,
      minChallengeAverageRuntimeRisk: model.release.minChallengeAverageRuntimeRisk,
      minRuntimeRiskChallengePositions: model.release.minRuntimeRiskChallengePositions,
      minEvaluationPhases: model.release.minEvaluationPhases,
      requiredTrainingProfile: model.release.requiredTrainingProfile,
      trainingProfile: model.release.trainingProfile,
      minTrainingSamples: model.release.minTrainingSamples,
      minTrainingValueSamples: model.release.minTrainingValueSamples,
      minTrainingOutcomeClasses: model.release.minTrainingOutcomeClasses,
      minTrainingPolicyRows: model.release.minTrainingPolicyRows,
      minTrainingPolicyActionTypes: model.release.minTrainingPolicyActionTypes,
      minTrainingUniqueStateHashes: model.release.minTrainingUniqueStateHashes,
      maxTrainingDuplicateStateRate: model.release.maxTrainingDuplicateStateRate,
      minTrainingSides: model.release.minTrainingSides,
      minTrainingSources: model.release.minTrainingSources,
      minTrainingReanalysisSamples: model.release.minTrainingReanalysisSamples,
      minTrainingStateSnapshots: model.release.minTrainingStateSnapshots,
      minTrainingAverageRootVisits: model.release.minTrainingAverageRootVisits,
      minTrainingSelectedActionShare: model.release.minTrainingSelectedActionShare,
      minTrainingExplorationShare: model.release.minTrainingExplorationShare,
      minTrainingValidationSamples: model.release.minTrainingValidationSamples,
      minTrainingValidationSides: model.release.minTrainingValidationSides,
      minTrainingValidationPhases: model.release.minTrainingValidationPhases,
      minTrainingValidationGroups: model.release.minTrainingValidationGroups,
      requiredTrainingValidationGroupBy: model.release.requiredTrainingValidationGroupBy,
      maxTrainingValidationValueMse: model.release.maxTrainingValidationValueMse,
      maxTrainingValidationValueCalibrationBias: model.release.maxTrainingValidationValueCalibrationBias,
      maxTrainingValidationPolicyCrossEntropy: model.release.maxTrainingValidationPolicyCrossEntropy,
      minTrainingValidationPolicyTopChoiceAccuracy: model.release.minTrainingValidationPolicyTopChoiceAccuracy,
      promotionVerdict: model.release.promotionVerdict,
      sideScoreDeltaPass: model.release.sideScoreDeltaPass,
      scoreLowerBoundPass: model.release.scoreLowerBoundPass,
      eloLowerBoundPass: model.release.eloLowerBoundPass,
      drawRatePass: model.release.drawRatePass,
      decisiveRatePass: model.release.decisiveRatePass,
      arena: model.release.arena,
      decisionEvidence: model.release.decisionEvidence,
      referenceArena: model.release.referenceArena,
      activeGeneration: model.release.activeGeneration,
      evaluationSuite: model.release.evaluationSuite,
      sideScores: model.release.sideScores,
      runtime: model.release.runtime,
    } : null,
  };
}

export function alphaModelEnvironmentFingerprint({ scenario = null, rules = null } = {}) {
  const scenarioFingerprint = alphaScenarioEnvironmentFingerprint(scenario);
  const rulesFingerprint = alphaRulesEnvironmentFingerprint(rules);
  if (!scenarioFingerprint && !rulesFingerprint) return null;
  return normalizeAlphaModelEnvironment({
    schema: ALPHA_ENVIRONMENT_SCHEMA,
    scenario: scenarioFingerprint,
    rules: rulesFingerprint,
  });
}

export function normalizeAlphaModelEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_ENVIRONMENT_SCHEMA) return null;
  const scenario = normalizeAlphaEnvironmentScenario(value.scenario);
  const rules = normalizeAlphaEnvironmentRules(value.rules);
  if (!scenario && !rules) return null;
  const expectedFingerprint = alphaEnvironmentHash({ scenario, rules });
  const fingerprint = typeof value.fingerprint === "string" && value.fingerprint
    ? value.fingerprint
    : expectedFingerprint;
  return {
    schema: ALPHA_ENVIRONMENT_SCHEMA,
    fingerprint,
    scenario,
    rules,
  };
}

export function validateAlphaModelEnvironment(modelOrEnvironment, expectedEnvironment = null, options = {}) {
  const environment = normalizeAlphaModelEnvironment(modelOrEnvironment?.environment ?? modelOrEnvironment);
  const expected = normalizeAlphaModelEnvironment(expectedEnvironment);
  const requireEnvironmentFingerprint = Boolean(options.requireEnvironmentFingerprint);
  if (!expected) {
    if (requireEnvironmentFingerprint && !environment) {
      return {
        ok: false,
        reason: "missing_model_environment",
        match: null,
        environment: null,
        expected: null,
      };
    }
    return {
      ok: true,
      reason: null,
      match: null,
      environment,
      expected: null,
    };
  }
  if (!environment) {
    return {
      ok: !requireEnvironmentFingerprint,
      reason: requireEnvironmentFingerprint ? "missing_model_environment" : null,
      match: null,
      environment: null,
      expected,
    };
  }
  const match = environment.fingerprint === expected.fingerprint;
  return {
    ok: match,
    reason: match ? null : "model_environment_mismatch",
    match,
    environment,
    expected,
  };
}

export function alphaModelFeatureContract({
  valueFeatureScales = null,
  policyFeatureKeys = null,
} = {}) {
  const valueScales = normalizeNumberMap(valueFeatureScales);
  const policyKeys = Array.isArray(policyFeatureKeys) ? policyFeatureKeys.map(String) : [];
  if (!Object.keys(valueScales).length && !policyKeys.length) return null;
  return normalizeAlphaModelFeatureContract({
    schema: ALPHA_FEATURE_CONTRACT_SCHEMA,
    value: Object.keys(valueScales).length
      ? {
        featureKeys: Object.keys(valueScales).sort(),
        featureScales: valueScales,
      }
      : null,
    policy: policyKeys.length
      ? {
        featureKeys: policyKeys,
      }
      : null,
  });
}

export function normalizeAlphaModelFeatureContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_FEATURE_CONTRACT_SCHEMA) return null;
  const valueContract = normalizeAlphaValueFeatureContract(value.value);
  const policyContract = normalizeAlphaPolicyFeatureContract(value.policy);
  if (!valueContract && !policyContract) return null;
  const expectedFingerprint = alphaEnvironmentHash({
    value: valueContract,
    policy: policyContract,
  });
  const fingerprint = typeof value.fingerprint === "string" && value.fingerprint
    ? value.fingerprint
    : expectedFingerprint;
  return {
    schema: ALPHA_FEATURE_CONTRACT_SCHEMA,
    fingerprint,
    value: valueContract,
    policy: policyContract,
  };
}

export function validateAlphaModelFeatureContract(modelOrContract, expectedContract = null, options = {}) {
  const model = normalizeAlphaModelArtifact(modelOrContract);
  const featureContract = normalizeAlphaModelFeatureContract(model?.featureContract ?? modelOrContract?.featureContract ?? modelOrContract);
  const expected = normalizeAlphaModelFeatureContract(expectedContract);
  const requireFeatureContract = Boolean(options.requireFeatureContract);
  const integrity = featureContract ? validateFeatureContractIntegrity(featureContract) : null;
  const submodels = model && featureContract ? validateSubmodelFeatureContract(model, featureContract) : null;
  if (!expected) {
    if (requireFeatureContract && !featureContract) {
      return {
        ok: false,
        reason: "missing_model_feature_contract",
        match: null,
        featureContract: null,
        expected: null,
        integrity,
        submodels,
      };
    }
    if (integrity && !integrity.ok) {
      return {
        ok: false,
        reason: "model_feature_contract_mismatch",
        match: false,
        featureContract,
        expected: null,
        integrity,
        submodels,
      };
    }
    if (submodels && !submodels.ok) {
      return {
        ok: false,
        reason: "model_feature_contract_mismatch",
        match: false,
        featureContract,
        expected: null,
        integrity,
        submodels,
      };
    }
    return {
      ok: true,
      reason: null,
      match: null,
      featureContract,
      expected: null,
      integrity,
      submodels,
    };
  }
  if (!featureContract) {
    return {
      ok: !requireFeatureContract,
      reason: requireFeatureContract ? "missing_model_feature_contract" : null,
      match: null,
      featureContract: null,
      expected,
      integrity,
      submodels,
    };
  }
  if (!integrity.ok || (submodels && !submodels.ok)) {
    return {
      ok: false,
      reason: "model_feature_contract_mismatch",
      match: false,
      featureContract,
      expected,
      integrity,
      submodels,
    };
  }
  const match = featureContract.fingerprint === expected.fingerprint;
  return {
    ok: match,
    reason: match ? null : "model_feature_contract_mismatch",
    match,
    featureContract,
    expected,
    integrity,
    submodels,
  };
}

export function normalizeAlphaReleaseMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_RELEASE_METADATA_SCHEMA) return null;
  return {
    schema: ALPHA_RELEASE_METADATA_SCHEMA,
    releasedAt: typeof value.releasedAt === "string" ? value.releasedAt : null,
    sourceSchema: typeof value.sourceSchema === "string" ? value.sourceSchema : null,
    sourceArtifact: typeof value.sourceArtifact === "string" ? value.sourceArtifact : null,
    sourceHash: normalizeSourceHash(value.sourceHash),
    sourceSizeBytes: finiteOrNull(value.sourceSizeBytes),
    promoted: Boolean(value.promoted),
    candidateScore: finiteOrNull(value.candidateScore),
    promotionThreshold: finiteOrNull(value.promotionThreshold),
    minSideScore: optionalFiniteOrNull(value.minSideScore),
    minSideScoreDelta: optionalFiniteOrNull(value.minSideScoreDelta),
    minScoreLowerBound: optionalFiniteOrNull(value.minScoreLowerBound),
    minEloLowerBound: optionalFiniteOrNull(value.minEloLowerBound),
    maxArenaDrawRate: optionalFiniteOrNull(value.maxArenaDrawRate),
    minArenaDecisiveRate: optionalFiniteOrNull(value.minArenaDecisiveRate),
    minAnalyzedActions: optionalFiniteOrNull(value.minAnalyzedActions),
    minAverageRootVisits: optionalFiniteOrNull(value.minAverageRootVisits),
    minCandidateAnalyzedActions: optionalFiniteOrNull(value.minCandidateAnalyzedActions),
    minCandidateAverageRootVisits: optionalFiniteOrNull(value.minCandidateAverageRootVisits),
    minCandidateDecisionActionTypes: optionalFiniteOrNull(value.minCandidateDecisionActionTypes),
    minCandidateDecisionAverageRecommendationConfidence: optionalFiniteOrNull(value.minCandidateDecisionAverageRecommendationConfidence),
    maxCandidateDecisionAverageRecommendationUncertainty: optionalFiniteOrNull(value.maxCandidateDecisionAverageRecommendationUncertainty),
    minCandidateDecisionSelectedActionShare: optionalFiniteOrNull(value.minCandidateDecisionSelectedActionShare),
    minDecisionAverageRecommendationConfidence: optionalFiniteOrNull(value.minDecisionAverageRecommendationConfidence),
    maxDecisionAverageRecommendationUncertainty: optionalFiniteOrNull(value.maxDecisionAverageRecommendationUncertainty),
    minDecisionSelectedActionShare: optionalFiniteOrNull(value.minDecisionSelectedActionShare),
    minDecisionActionTypes: optionalFiniteOrNull(value.minDecisionActionTypes),
    maxDecisionFallbackRate: optionalFiniteOrNull(value.maxDecisionFallbackRate),
    minReferenceArenaScore: optionalFiniteOrNull(value.minReferenceArenaScore),
    minReferenceArenaReferences: optionalFiniteOrNull(value.minReferenceArenaReferences),
    maxReferenceArenaErrors: optionalFiniteOrNull(value.maxReferenceArenaErrors),
    minChallengeAverageRecommendationUncertainty: optionalFiniteOrNull(value.minChallengeAverageRecommendationUncertainty),
    minContestedChallengePositions: optionalFiniteOrNull(value.minContestedChallengePositions),
    minChallengeAverageRuntimeRisk: optionalFiniteOrNull(value.minChallengeAverageRuntimeRisk),
    minRuntimeRiskChallengePositions: optionalFiniteOrNull(value.minRuntimeRiskChallengePositions),
    minEvaluationPhases: optionalFiniteOrNull(value.minEvaluationPhases),
    requiredTrainingProfile: stringOrNull(value.requiredTrainingProfile),
    trainingProfile: normalizeAlphaTrainingProfileEvidence(value.trainingProfile),
    minTrainingSamples: optionalFiniteOrNull(value.minTrainingSamples),
    minTrainingValueSamples: optionalFiniteOrNull(value.minTrainingValueSamples),
    minTrainingOutcomeClasses: optionalFiniteOrNull(value.minTrainingOutcomeClasses),
    minTrainingPolicyRows: optionalFiniteOrNull(value.minTrainingPolicyRows),
    minTrainingPolicyActionTypes: optionalFiniteOrNull(value.minTrainingPolicyActionTypes),
    minTrainingUniqueStateHashes: optionalFiniteOrNull(value.minTrainingUniqueStateHashes),
    maxTrainingDuplicateStateRate: optionalFiniteOrNull(value.maxTrainingDuplicateStateRate),
    minTrainingSides: optionalFiniteOrNull(value.minTrainingSides),
    minTrainingSources: optionalFiniteOrNull(value.minTrainingSources),
    minTrainingReanalysisSamples: optionalFiniteOrNull(value.minTrainingReanalysisSamples),
    minTrainingStateSnapshots: optionalFiniteOrNull(value.minTrainingStateSnapshots),
    minTrainingAverageRootVisits: optionalFiniteOrNull(value.minTrainingAverageRootVisits),
    minTrainingSelectedActionShare: optionalFiniteOrNull(value.minTrainingSelectedActionShare),
    minTrainingExplorationShare: optionalFiniteOrNull(value.minTrainingExplorationShare),
    minTrainingValidationSamples: optionalFiniteOrNull(value.minTrainingValidationSamples),
    minTrainingValidationSides: optionalFiniteOrNull(value.minTrainingValidationSides),
    minTrainingValidationPhases: optionalFiniteOrNull(value.minTrainingValidationPhases),
    minTrainingValidationGroups: optionalFiniteOrNull(value.minTrainingValidationGroups),
    requiredTrainingValidationGroupBy: stringOrNull(value.requiredTrainingValidationGroupBy),
    maxTrainingValidationValueMse: optionalFiniteOrNull(value.maxTrainingValidationValueMse),
    maxTrainingValidationValueCalibrationBias: optionalFiniteOrNull(value.maxTrainingValidationValueCalibrationBias),
    maxTrainingValidationPolicyCrossEntropy: optionalFiniteOrNull(value.maxTrainingValidationPolicyCrossEntropy),
    minTrainingValidationPolicyTopChoiceAccuracy: optionalFiniteOrNull(value.minTrainingValidationPolicyTopChoiceAccuracy),
    promotionVerdict: normalizePromotionVerdict(value.promotionVerdict),
    sideScoreDeltaPass: value.sideScoreDeltaPass !== false,
    scoreLowerBoundPass: value.scoreLowerBoundPass !== false,
    eloLowerBoundPass: value.eloLowerBoundPass !== false,
    drawRatePass: value.drawRatePass !== false,
    decisiveRatePass: value.decisiveRatePass !== false,
    arena: normalizeReleaseArena(value.arena),
    decisionEvidence: normalizeDecisionEvidence(value.decisionEvidence),
    referenceArena: normalizeReferenceArena(value.referenceArena),
    errors: finiteNumber(value.errors, 0),
    activeGeneration: finiteOrNull(value.activeGeneration),
    evaluationSuite: normalizeReleaseSuiteEvidence(value.evaluationSuite),
    sideScores: normalizeReleaseSideScores(value.sideScores),
    runtime: normalizeRuntimeInstallEvidence(value.runtime),
  };
}

export function normalizeAlphaTrainingProfileEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_TRAINING_PROFILE_EVIDENCE_SCHEMA) return null;
  const profile = stringOrNull(value.profile);
  if (!profile) return null;
  return {
    schema: ALPHA_TRAINING_PROFILE_EVIDENCE_SCHEMA,
    profile,
    selfPlayOptions: normalizeTrainingProfileOptions(value.selfPlayOptions),
    replayBufferOptions: normalizeTrainingProfileOptions(value.replayBufferOptions),
    reanalysisOptions: normalizeTrainingProfileOptions(value.reanalysisOptions),
    trainingOptions: normalizeTrainingProfileOptions(value.trainingOptions),
    releaseGate: normalizeTrainingProfileOptions(value.releaseGate),
  };
}

function normalizeRuntimeInstallEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: value.schema === "zizi-el-alamein-alpha-runtime-install-v1"
      ? value.schema
      : "zizi-el-alamein-alpha-runtime-install-v1",
    target: typeof value.target === "string" ? value.target : null,
    modelFile: typeof value.modelFile === "string" ? value.modelFile : null,
    installApproved: Boolean(value.installApproved),
  };
}

function normalizeTrainingProfileOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .map(([key, raw]) => [String(key), normalizeTrainingProfileOptionValue(raw)])
    .filter(([, normalized]) => normalized !== undefined);
  return Object.fromEntries(entries);
}

function normalizeTrainingProfileOptionValue(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    return trimmed !== "" && Number.isFinite(numeric) ? numeric : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeTrainingProfileOptions(value);
  return undefined;
}

export function normalizeAlphaTrainingMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_TRAINING_METADATA_SCHEMA) return null;
  return {
    schema: ALPHA_TRAINING_METADATA_SCHEMA,
    warmStarted: Boolean(value.warmStarted),
    parent: normalizeTrainingParentMetadata(value.parent),
    data: normalizeTrainingDataSummary(value.data),
    validation: normalizeTrainingValidation(value.validation),
  };
}

function normalizeReleaseSuiteEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      schema: "zizi-el-alamein-alpha-release-suite-evidence-v1",
      explicit: false,
      games: 0,
      sides: 0,
      seeds: 0,
      phaseCoverage: emptyPhaseCoverageEvidence(),
      fixedPositions: 0,
      challengePositions: 0,
      challengeQuality: null,
      challengeSelection: null,
    };
  }
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-release-suite-evidence-v1",
    explicit: Boolean(value.explicit),
    games: finiteNumber(value.games, 0),
    sides: finiteNumber(value.sides, 0),
    seeds: finiteNumber(value.seeds, 0),
    phaseCoverage: normalizePhaseCoverage(value.phaseCoverage),
    fixedPositions: finiteNumber(value.fixedPositions, 0),
    challengePositions: finiteNumber(value.challengePositions, 0),
    challengeQuality: normalizeChallengeQuality(value.challengeQuality),
    challengeSelection: normalizeChallengeSelection(value.challengeSelection),
  };
}

function normalizePhaseCoverage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyPhaseCoverageEvidence();
  const counts = normalizeCountMap(value.counts);
  const ids = Array.isArray(value.ids)
    ? [...new Set(value.ids.map(String).filter(Boolean))].sort()
    : Object.keys(counts).sort();
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-release-phase-coverage-v1",
    phases: finiteNumber(value.phases, ids.length),
    ids,
    counts: Object.fromEntries(ids.map((id) => [id, counts[id] || 0]).filter(([, count]) => count > 0)),
  };
}

function emptyPhaseCoverageEvidence() {
  return {
    schema: "zizi-el-alamein-alpha-release-phase-coverage-v1",
    phases: 0,
    ids: [],
    counts: {},
  };
}

function normalizeChallengeQuality(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-challenge-quality-v1",
    samples: finiteNumber(value.samples, 0),
    averagePriority: finiteOrNull(value.averagePriority),
    averageRuntimeRisk: finiteOrNull(value.averageRuntimeRisk),
    runtimeRiskPositions: finiteNumber(value.runtimeRiskPositions, 0),
    runtimeRecommendations: finiteNumber(value.runtimeRecommendations, 0),
    runtimeRejectedRecommendations: finiteNumber(value.runtimeRejectedRecommendations, 0),
    runtimeCandidateFallbacks: finiteNumber(value.runtimeCandidateFallbacks, 0),
    runtimeIllegalCandidatesSkipped: finiteNumber(value.runtimeIllegalCandidatesSkipped, 0),
    averagePolicyEntropy: finiteOrNull(value.averagePolicyEntropy),
    averageRecommendationConfidence: finiteOrNull(value.averageRecommendationConfidence),
    averageRecommendationVisitMargin: finiteOrNull(value.averageRecommendationVisitMargin),
    averageRecommendationQMargin: finiteOrNull(value.averageRecommendationQMargin),
    averageRecommendationUncertainty: finiteOrNull(value.averageRecommendationUncertainty),
    averageTemperature: finiteOrNull(value.averageTemperature),
    averageRootNoiseWeight: finiteOrNull(value.averageRootNoiseWeight),
    averageSearchIterations: finiteOrNull(value.averageSearchIterations),
    averageRootVisits: finiteOrNull(value.averageRootVisits),
    recommendationLabels: normalizeCountMap(value.recommendationLabels),
    selectionModes: normalizeCountMap(value.selectionModes),
  };
}

function normalizeReferenceArena(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      schema: "zizi-el-alamein-alpha-reference-arena-evidence-v1",
      references: 0,
      scoredReferences: 0,
      minCandidateScore: null,
      averageCandidateScore: null,
      errors: 0,
      entries: [],
    };
  }
  const entries = Array.isArray(value.entries)
    ? value.entries.map(normalizeReferenceArenaEntry).filter(Boolean)
    : [];
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-reference-arena-evidence-v1",
    references: finiteNumber(value.references, entries.length),
    scoredReferences: finiteNumber(value.scoredReferences, entries.filter((entry) => entry.scoredGames > 0).length),
    minCandidateScore: finiteOrNull(value.minCandidateScore),
    averageCandidateScore: finiteOrNull(value.averageCandidateScore),
    errors: finiteNumber(value.errors, entries.reduce((sum, entry) => sum + Number(entry.errors || 0), 0)),
    entries,
  };
}

function normalizeReferenceArenaEntry(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-reference-arena-entry-evidence-v1",
    index: finiteNumber(value.index, index),
    label: typeof value.label === "string" && value.label ? value.label : `reference-${index + 1}`,
    source: typeof value.source === "string" ? value.source : null,
    modelPresent: Boolean(value.modelPresent),
    games: finiteNumber(value.games, 0),
    scoredGames: finiteNumber(value.scoredGames, 0),
    candidateScore: finiteOrNull(value.candidateScore),
    errors: finiteNumber(value.errors, 0),
    arena: normalizeReleaseArena(value.arena),
  };
}

function challengeQualityGate(quality, options = {}) {
  const minAverageUncertainty = optionalFiniteOrNull(options.minChallengeAverageRecommendationUncertainty);
  const minContestedPositions = optionalFiniteOrNull(options.minContestedChallengePositions);
  const minAverageRuntimeRisk = optionalFiniteOrNull(options.minChallengeAverageRuntimeRisk);
  const minRuntimeRiskPositions = optionalFiniteOrNull(options.minRuntimeRiskChallengePositions);
  if (
    minAverageUncertainty === null
    && minContestedPositions === null
    && minAverageRuntimeRisk === null
    && minRuntimeRiskPositions === null
  ) return { ok: true, reason: null };
  if (!quality) return { ok: false, reason: "missing_challenge_quality_evidence" };
  if (
    minAverageUncertainty !== null
    && (
      quality.averageRecommendationUncertainty === null
      || quality.averageRecommendationUncertainty === undefined
      || Number(quality.averageRecommendationUncertainty) < minAverageUncertainty
    )
  ) {
    return { ok: false, reason: "challenge_average_uncertainty_too_low" };
  }
  if (
    minContestedPositions !== null
    && Number(quality.recommendationLabels?.contested || 0) < minContestedPositions
  ) {
    return { ok: false, reason: "challenge_contested_positions_too_few" };
  }
  if (
    minAverageRuntimeRisk !== null
    && (
      quality.averageRuntimeRisk === null
      || quality.averageRuntimeRisk === undefined
      || Number(quality.averageRuntimeRisk) < minAverageRuntimeRisk
    )
  ) {
    return { ok: false, reason: "challenge_average_runtime_risk_too_low" };
  }
  if (
    minRuntimeRiskPositions !== null
    && Number(quality.runtimeRiskPositions || 0) < minRuntimeRiskPositions
  ) {
    return { ok: false, reason: "challenge_runtime_risk_positions_too_few" };
  }
  return { ok: true, reason: null };
}

function trainingProfileGate(profile, requiredProfile = null) {
  const required = stringOrNull(requiredProfile);
  if (required === null) return { ok: true, reason: null };
  const evidence = normalizeAlphaTrainingProfileEvidence(profile);
  if (!evidence) return { ok: false, reason: "missing_training_profile_evidence" };
  if (evidence.profile !== required) return { ok: false, reason: "training_profile_mismatch" };
  return { ok: true, reason: null };
}

function referenceArenaGate(arena, options = {}) {
  const minScore = optionalFiniteOrNull(options.minReferenceArenaScore);
  const minReferences = optionalFiniteOrNull(options.minReferenceArenaReferences);
  const maxErrors = optionalFiniteOrNull(options.maxReferenceArenaErrors);
  if (minScore === null && minReferences === null && maxErrors === null) return { ok: true, reason: null };
  const evidence = normalizeReferenceArena(arena);
  if (!evidence.references) return { ok: false, reason: "missing_reference_arena_evidence" };
  if (minReferences !== null && Number(evidence.scoredReferences || 0) < minReferences) {
    return { ok: false, reason: "reference_arena_too_few_references" };
  }
  if (maxErrors !== null && Number(evidence.errors || 0) > maxErrors) {
    return { ok: false, reason: "reference_arena_errors_exceed_limit" };
  }
  if (
    minScore !== null
    && (
      evidence.minCandidateScore === null
      || evidence.minCandidateScore === undefined
      || Number(evidence.minCandidateScore) < minScore
    )
  ) {
    return { ok: false, reason: "reference_arena_score_below_threshold" };
  }
  return { ok: true, reason: null };
}

function normalizeChallengeSelection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-challenge-suite-selection-v1",
    inputCount: finiteNumber(value.inputCount, 0),
    eligibleSamples: finiteNumber(value.eligibleSamples, 0),
    selectedSamples: finiteNumber(value.selectedSamples, 0),
    maxPositions: finiteNumber(value.maxPositions, 0),
    balanceBy: typeof value.balanceBy === "string" ? value.balanceBy : "none",
    priorityBy: typeof value.priorityBy === "string" ? value.priorityBy : "none",
    sources: Array.isArray(value.sources) ? value.sources.map(String) : [],
  };
}

function normalizeReleaseSideScores(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      candidateSide: entry?.candidateSide === "axis" || entry?.candidateSide === "allied"
        ? entry.candidateSide
        : null,
      games: finiteNumber(entry?.games, 0),
      candidateWins: finiteNumber(entry?.candidateWins, 0),
      baselineWins: finiteNumber(entry?.baselineWins, 0),
      draws: finiteNumber(entry?.draws, 0),
      errors: finiteNumber(entry?.errors, 0),
      scoredGames: finiteNumber(entry?.scoredGames, 0),
      candidateScore: finiteNumber(entry?.candidateScore, 0),
      baselineScore: optionalFiniteOrNull(entry?.baselineScore),
      scoreDelta: optionalFiniteOrNull(entry?.scoreDelta),
      arena: normalizeReleaseArena(entry?.arena),
    }))
    .filter((entry) => entry.candidateSide);
}

function normalizePromotionVerdict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const gates = Array.isArray(value.gates)
    ? value.gates
      .map(normalizePromotionGate)
      .filter(Boolean)
    : [];
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-promotion-verdict-v1",
    ok: typeof value.ok === "boolean" ? value.ok : (gates.length > 0 && gates.every((gate) => gate.ok)),
    reason: typeof value.reason === "string" && value.reason ? value.reason : null,
    gates,
  };
}

function promotionVerdictGate(value) {
  const promotionVerdict = normalizePromotionVerdict(value);
  if (!promotionVerdict) {
    return { ok: true, reason: null, promotionVerdict: null };
  }
  const failedGate = promotionVerdict.gates.find((gate) => gate.ok === false);
  if (!promotionVerdict.ok || failedGate) {
    return {
      ok: false,
      reason: "promotion_verdict_failed",
      promotionVerdict,
    };
  }
  return {
    ok: true,
    reason: null,
    promotionVerdict,
  };
}

function normalizePromotionGate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.key !== "string") return null;
  return {
    key: value.key,
    ok: Boolean(value.ok),
    required: value.required !== false,
    actual: finiteOrNull(value.actual),
    threshold: finiteOrNull(value.threshold),
    comparison: typeof value.comparison === "string" && value.comparison ? value.comparison : "min",
    reason: typeof value.reason === "string" && value.reason ? value.reason : null,
  };
}

function normalizeDecisionEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-decision-evidence-v1",
    games: finiteNumber(value.games, 0),
    actionCount: finiteNumber(value.actionCount, 0),
    decisionCount: finiteNumber(value.decisionCount, 0),
    analyzedActions: finiteNumber(value.analyzedActions, 0),
    candidateActions: finiteNumber(value.candidateActions, 0),
    baselineActions: finiteNumber(value.baselineActions, 0),
    chanceActions: finiteNumber(value.chanceActions, 0),
    fallbackActions: finiteNumber(value.fallbackActions, 0),
    averagePolicyEntropy: finiteOrNull(value.averagePolicyEntropy),
    averageRecommendationConfidence: finiteOrNull(value.averageRecommendationConfidence),
    averageRecommendationVisitMargin: finiteOrNull(value.averageRecommendationVisitMargin),
    averageRecommendationQMargin: finiteOrNull(value.averageRecommendationQMargin),
    averageRecommendationUncertainty: finiteOrNull(value.averageRecommendationUncertainty),
    averageSearchIterations: finiteOrNull(value.averageSearchIterations),
    averageRootVisits: finiteOrNull(value.averageRootVisits),
    selectedActionShare: finiteOrNull(value.selectedActionShare),
    actionTypes: normalizeCountMap(value.actionTypes),
    selectionModes: normalizeCountMap(value.selectionModes),
    recommendationLabels: normalizeCountMap(value.recommendationLabels),
    roles: {
      candidate: normalizeRoleDecisionEvidence(value.roles?.candidate),
      baseline: normalizeRoleDecisionEvidence(value.roles?.baseline),
    },
  };
}

function normalizeRoleDecisionEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      actionCount: 0,
      decisionCount: 0,
      analyzedActions: 0,
      averagePolicyEntropy: null,
      averageRecommendationConfidence: null,
      averageRecommendationVisitMargin: null,
      averageRecommendationQMargin: null,
      averageRecommendationUncertainty: null,
      averageSearchIterations: null,
      averageRootVisits: null,
      selectedActionShare: null,
      recommendationLabels: {},
      actionTypes: {},
    };
  }
  return {
    actionCount: finiteNumber(value.actionCount, 0),
    decisionCount: finiteNumber(value.decisionCount, 0),
    analyzedActions: finiteNumber(value.analyzedActions, 0),
    averagePolicyEntropy: finiteOrNull(value.averagePolicyEntropy),
    averageRecommendationConfidence: finiteOrNull(value.averageRecommendationConfidence),
    averageRecommendationVisitMargin: finiteOrNull(value.averageRecommendationVisitMargin),
    averageRecommendationQMargin: finiteOrNull(value.averageRecommendationQMargin),
    averageRecommendationUncertainty: finiteOrNull(value.averageRecommendationUncertainty),
    averageSearchIterations: finiteOrNull(value.averageSearchIterations),
    averageRootVisits: finiteOrNull(value.averageRootVisits),
    selectedActionShare: finiteOrNull(value.selectedActionShare),
    recommendationLabels: normalizeCountMap(value.recommendationLabels),
    actionTypes: normalizeCountMap(value.actionTypes),
  };
}

function normalizeCountMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [String(key), Math.max(0, finiteNumber(raw, 0))])
      .filter(([, count]) => count > 0),
  );
}

function normalizeReleaseArena(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : "zizi-el-alamein-alpha-arena-metrics-v1",
    games: finiteNumber(value.games, 0),
    scoredGames: finiteNumber(value.scoredGames, 0),
    errors: finiteNumber(value.errors, 0),
    score: finiteNumber(value.score, 0),
    scoreInterval95: normalizeScoreInterval(value.scoreInterval95),
    eloDiff: finiteOrNull(value.eloDiff),
    eloDiffInterval95: normalizeEloInterval(value.eloDiffInterval95),
    decisiveRate: finiteNumber(value.decisiveRate, 0),
    drawRate: finiteNumber(value.drawRate, 0),
  };
}

function normalizeScoreInterval(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    low: finiteNumber(value.low, 0),
    high: finiteNumber(value.high, 0),
  };
}

function normalizeEloInterval(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    low: finiteOrNull(value.low),
    high: finiteOrNull(value.high),
  };
}

function normalizeTrainingParentMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : null,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null,
    method: typeof value.method === "string" ? value.method : null,
    sampleCount: finiteNumber(value.sampleCount, 0),
    sources: Array.isArray(value.sources) ? value.sources.map(String) : [],
    hasValue: Boolean(value.hasValue),
    hasPolicy: Boolean(value.hasPolicy),
    valueWeights: finiteNumber(value.valueWeights, 0),
    policyWeights: finiteNumber(value.policyWeights, 0),
    release: normalizeTrainingParentRelease(value.release),
    trainingData: normalizeTrainingDataSummary(value.trainingData),
    trainingValidation: normalizeTrainingValidation(value.trainingValidation),
  };
}

function normalizeTrainingParentRelease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    schema: typeof value.schema === "string" ? value.schema : null,
    sourceSchema: typeof value.sourceSchema === "string" ? value.sourceSchema : null,
    sourceArtifact: typeof value.sourceArtifact === "string" ? value.sourceArtifact : null,
    sourceHash: normalizeSourceHash(value.sourceHash),
    activeGeneration: finiteOrNull(value.activeGeneration),
  };
}

function normalizeTrainingDataSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_TRAINING_DATA_SUMMARY_SCHEMA) return null;
  return {
    schema: ALPHA_TRAINING_DATA_SUMMARY_SCHEMA,
    sampleCount: finiteCount(value.sampleCount),
    sources: Array.isArray(value.sources) ? value.sources.map(String) : [],
    sides: normalizeTrainingCountMap(value.sides),
    phases: normalizeTrainingCountMap(value.phases),
    outcomeSources: normalizeTrainingCountMap(value.outcomeSources),
    selectionModes: normalizeTrainingCountMap(value.selectionModes),
    valueSamples: finiteCount(value.valueSamples),
    outcomeBuckets: normalizeTrainingCountMap(value.outcomeBuckets),
    outcomeClassCount: finiteCount(value.outcomeClassCount),
    averageOutcome: finiteOrNull(value.averageOutcome),
    samplesWithPolicy: finiteCount(value.samplesWithPolicy),
    policyRows: finiteCount(value.policyRows),
    policyActionTypes: normalizeTrainingCountMap(value.policyActionTypes),
    policyActionTypeCount: finiteCount(value.policyActionTypeCount),
    stateHashSamples: finiteCount(value.stateHashSamples),
    uniqueStateHashes: finiteCount(value.uniqueStateHashes),
    duplicateStateSamples: finiteCount(value.duplicateStateSamples),
    stateHashCoverage: finiteOrNull(value.stateHashCoverage),
    duplicateStateRate: finiteOrNull(value.duplicateStateRate),
    samplesWithDecision: finiteCount(value.samplesWithDecision),
    sampledDecisionCount: finiteCount(value.sampledDecisionCount),
    explorationDecisionCount: finiteCount(value.explorationDecisionCount),
    explorationDecisionShare: finiteOrNull(value.explorationDecisionShare),
    temperatureDecisionCount: finiteCount(value.temperatureDecisionCount),
    rootNoiseDecisionCount: finiteCount(value.rootNoiseDecisionCount),
    nonBestSelectedActions: finiteCount(value.nonBestSelectedActions),
    samplesWithStateSnapshot: finiteCount(value.samplesWithStateSnapshot),
    reanalysisSamples: finiteCount(value.reanalysisSamples),
    averageOutcomeWeight: finiteOrNull(value.averageOutcomeWeight),
    averageRootVisits: finiteOrNull(value.averageRootVisits),
    averageTemperature: finiteOrNull(value.averageTemperature),
    averageRootNoiseWeight: finiteOrNull(value.averageRootNoiseWeight),
    averagePolicyEntropy: finiteOrNull(value.averagePolicyEntropy),
    averageSelectedVisitShare: finiteOrNull(value.averageSelectedVisitShare),
    averageSelectedPolicyRank: finiteOrNull(value.averageSelectedPolicyRank),
    selectedBestActions: finiteCount(value.selectedBestActions),
  };
}

function normalizeTrainingValidation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== ALPHA_TRAINING_VALIDATION_SCHEMA) return null;
  return {
    schema: ALPHA_TRAINING_VALIDATION_SCHEMA,
    seed: typeof value.seed === "string" ? value.seed : null,
    validationFraction: finiteOrNull(value.validationFraction),
    validationGroupBy: typeof value.validationGroupBy === "string" ? value.validationGroupBy : "sample",
    trainingGroups: finiteCount(value.trainingGroups),
    validationGroups: finiteCount(value.validationGroups),
    trainingSamples: finiteCount(value.trainingSamples),
    explicitValidation: Boolean(value.explicitValidation),
    stateHashOverlapCount: nonnegativeIntegerOrNull(value.stateHashOverlapCount),
    crossSplitComponentCount: nonnegativeIntegerOrNull(value.crossSplitComponentCount),
    environmentFingerprint: canonicalFingerprintOrNull(value.environmentFingerprint),
    trainingArtifactFingerprint: canonicalFingerprintOrNull(value.trainingArtifactFingerprint),
    validationArtifactFingerprint: canonicalFingerprintOrNull(value.validationArtifactFingerprint),
    trainingFileSha256: canonicalFingerprintOrNull(value.trainingFileSha256),
    validationFileSha256: canonicalFingerprintOrNull(value.validationFileSha256),
    trainingTrajectories: nonnegativeIntegerOrNull(value.trainingTrajectories),
    validationTrajectories: nonnegativeIntegerOrNull(value.validationTrajectories),
    trajectoryOverlapCount: nonnegativeIntegerOrNull(value.trajectoryOverlapCount),
    sampleCount: finiteCount(value.sampleCount),
    sides: normalizeTrainingCountMap(value.sides),
    phases: normalizeTrainingCountMap(value.phases),
    outcomeSources: normalizeTrainingCountMap(value.outcomeSources),
    value: normalizeMetrics(value.value),
    policy: normalizeMetrics(value.policy),
  };
}

function normalizeTrainingCountMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, count]) => [String(key), finiteCount(count)])
    .filter(([key, count]) => key && count > 0));
}

function alphaScenarioEnvironmentFingerprint(scenario) {
  if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) return null;
  const board = scenario.board && typeof scenario.board === "object" ? scenario.board : {};
  const hexes = Array.isArray(board.hexes) ? board.hexes : [];
  const units = Array.isArray(scenario.units) ? scenario.units : [];
  const objectives = scenario.objectives && typeof scenario.objectives === "object" ? scenario.objectives : {};
  return {
    id: stringOrNull(scenario.id || scenario.name || scenario.title),
    format: stringOrNull(scenario.format),
    version: finiteOrNull(scenario.version),
    boardName: stringOrNull(board.name),
    boardImage: stringOrNull(board.image),
    boardSize: {
      width: finiteOrNull(board.width),
      height: finiteOrNull(board.height),
    },
    hexCount: hexes.length,
    unitCount: units.length,
    objectiveKeys: Object.keys(objectives).sort(),
    hexHash: alphaEnvironmentHash(hexes.map(compactScenarioHexForEnvironment)),
    unitHash: alphaEnvironmentHash(units.map(compactScenarioUnitForEnvironment)),
    objectiveHash: alphaEnvironmentHash(objectives),
  };
}

function alphaRulesEnvironmentFingerprint(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return null;
  return {
    format: stringOrNull(rules.format),
    version: finiteOrNull(rules.version),
    turnCount: Array.isArray(rules.turns) ? rules.turns.length : 0,
    phases: Array.isArray(rules.phases)
      ? rules.phases.map((phase) => ({
        id: stringOrNull(phase?.id),
        side: stringOrNull(phase?.side),
        type: stringOrNull(phase?.type),
      }))
      : [],
    crtHash: alphaEnvironmentHash(rules.crt || rules.combatResults || null),
    terrainHash: alphaEnvironmentHash(rules.terrain || null),
    rulesHash: alphaEnvironmentHash(stripDisplayTextForEnvironment(rules)),
  };
}

function normalizeAlphaEnvironmentScenario(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    id: stringOrNull(value.id),
    format: stringOrNull(value.format),
    version: finiteOrNull(value.version),
    boardName: stringOrNull(value.boardName),
    boardImage: stringOrNull(value.boardImage),
    boardSize: {
      width: finiteOrNull(value.boardSize?.width),
      height: finiteOrNull(value.boardSize?.height),
    },
    hexCount: finiteCount(value.hexCount),
    unitCount: finiteCount(value.unitCount),
    objectiveKeys: Array.isArray(value.objectiveKeys) ? value.objectiveKeys.map(String).sort() : [],
    hexHash: stringOrNull(value.hexHash),
    unitHash: stringOrNull(value.unitHash),
    objectiveHash: stringOrNull(value.objectiveHash),
  };
}

function normalizeAlphaEnvironmentRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    format: stringOrNull(value.format),
    version: finiteOrNull(value.version),
    turnCount: finiteCount(value.turnCount),
    phases: Array.isArray(value.phases)
      ? value.phases.map((phase) => ({
        id: stringOrNull(phase?.id),
        side: stringOrNull(phase?.side),
        type: stringOrNull(phase?.type),
      }))
      : [],
    crtHash: stringOrNull(value.crtHash),
    terrainHash: stringOrNull(value.terrainHash),
    rulesHash: stringOrNull(value.rulesHash),
  };
}

function normalizeAlphaValueFeatureContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const featureScales = normalizeNumberMap(value.featureScales);
  const featureKeys = Array.isArray(value.featureKeys)
    ? value.featureKeys.map(String).sort()
    : Object.keys(featureScales).sort();
  if (!featureKeys.length && !Object.keys(featureScales).length) return null;
  return {
    featureKeys,
    featureScales,
    featureScalesHash: alphaEnvironmentHash(featureScales),
  };
}

function normalizeAlphaPolicyFeatureContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const featureKeys = Array.isArray(value.featureKeys) ? value.featureKeys.map(String) : [];
  if (!featureKeys.length) return null;
  return {
    featureKeys,
    featureKeysHash: alphaEnvironmentHash(featureKeys),
  };
}

function validateFeatureContractIntegrity(featureContract) {
  const expectedFingerprint = alphaEnvironmentHash({
    value: featureContract.value,
    policy: featureContract.policy,
  });
  const match = featureContract.fingerprint === expectedFingerprint;
  return {
    ok: match,
    reason: match ? null : "feature_contract_fingerprint_mismatch",
    match,
    fingerprint: featureContract.fingerprint,
    expectedFingerprint,
  };
}

function validateSubmodelFeatureContract(model, featureContract) {
  const value = validateValueSubmodelFeatureContract(model.value, featureContract.value);
  const policy = validatePolicySubmodelFeatureContract(model.policy, featureContract.policy);
  return {
    ok: value.ok && policy.ok,
    value,
    policy,
  };
}

function validateValueSubmodelFeatureContract(valueModel, valueContract) {
  if (!valueModel) return { ok: true, reason: null, match: null };
  if (!valueContract) return { ok: false, reason: "missing_value_feature_contract", match: false };
  const featureScales = normalizeNumberMap(valueModel.featureScales);
  const featureKeys = (valueModel.featureKeys.length
    ? valueModel.featureKeys
    : Object.keys(featureScales)).map(String).sort();
  const featureKeysMatch = sameStringArray(featureKeys, valueContract.featureKeys);
  const featureScalesHash = alphaEnvironmentHash(featureScales);
  const featureScalesMatch = featureScalesHash === valueContract.featureScalesHash;
  return {
    ok: featureKeysMatch && featureScalesMatch,
    reason: featureKeysMatch && featureScalesMatch ? null : "value_feature_contract_mismatch",
    match: featureKeysMatch && featureScalesMatch,
    featureKeysMatch,
    featureScalesMatch,
    featureKeys,
    expectedFeatureKeys: valueContract.featureKeys,
    featureScalesHash,
    expectedFeatureScalesHash: valueContract.featureScalesHash,
  };
}

function validatePolicySubmodelFeatureContract(policyModel, policyContract) {
  if (!policyModel) return { ok: true, reason: null, match: null };
  if (!policyContract) return { ok: false, reason: "missing_policy_feature_contract", match: false };
  const featureKeys = policyModel.featureKeys.map(String);
  const featureKeysMatch = sameStringArray(featureKeys, policyContract.featureKeys);
  return {
    ok: featureKeysMatch,
    reason: featureKeysMatch ? null : "policy_feature_contract_mismatch",
    match: featureKeysMatch,
    featureKeys,
    expectedFeatureKeys: policyContract.featureKeys,
  };
}

function sameStringArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => String(value) === String(right[index]));
}

function compactScenarioHexForEnvironment(hex) {
  return {
    id: stringOrNull(hex?.id),
    col: finiteOrNull(hex?.col),
    row: finiteOrNull(hex?.row),
    terrain: stringOrNull(hex?.terrain),
    road: Boolean(hex?.road),
    britishPosition: Boolean(hex?.britishPosition),
    objective: Array.isArray(hex?.objective) ? hex.objective.map(String).sort() : [],
  };
}

function compactScenarioUnitForEnvironment(unit) {
  return {
    id: stringOrNull(unit?.id),
    side: stringOrNull(unit?.side),
    type: stringOrNull(unit?.type),
    combat: finiteOrNull(unit?.combat),
    attack: finiteOrNull(unit?.attack),
    defense: finiteOrNull(unit?.defense),
    movement: finiteOrNull(unit?.movement),
    steps: finiteOrNull(unit?.steps),
    hexId: stringOrNull(unit?.hexId),
    entryTurn: finiteOrNull(unit?.entryTurn),
  };
}

function stripDisplayTextForEnvironment(value, seen = new WeakSet()) {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => stripDisplayTextForEnvironment(entry, seen))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== "object") return null;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (["label", "labels", "name", "description", "text"].includes(key)) continue;
    const next = stripDisplayTextForEnvironment(value[key], seen);
    if (next !== undefined) output[key] = next;
  }
  seen.delete(value);
  return output;
}

function alphaEnvironmentHash(value) {
  return `fnv1a32:${stableHash(stableValue(value))}`;
}

function trainingDataGate(data, options = {}) {
  const thresholds = {
    minTrainingSamples: optionalFiniteOrNull(options.minTrainingSamples),
    minTrainingValueSamples: optionalFiniteOrNull(options.minTrainingValueSamples),
    minTrainingOutcomeClasses: optionalFiniteOrNull(options.minTrainingOutcomeClasses),
    minTrainingPolicyRows: optionalFiniteOrNull(options.minTrainingPolicyRows),
    minTrainingPolicyActionTypes: optionalFiniteOrNull(options.minTrainingPolicyActionTypes),
    minTrainingUniqueStateHashes: optionalFiniteOrNull(options.minTrainingUniqueStateHashes),
    maxTrainingDuplicateStateRate: optionalFiniteOrNull(options.maxTrainingDuplicateStateRate),
    minTrainingSides: optionalFiniteOrNull(options.minTrainingSides),
    minTrainingSources: optionalFiniteOrNull(options.minTrainingSources),
    minTrainingReanalysisSamples: optionalFiniteOrNull(options.minTrainingReanalysisSamples),
    minTrainingStateSnapshots: optionalFiniteOrNull(options.minTrainingStateSnapshots),
    minTrainingAverageRootVisits: optionalFiniteOrNull(options.minTrainingAverageRootVisits),
    minTrainingSelectedActionShare: optionalFiniteOrNull(options.minTrainingSelectedActionShare),
    minTrainingExplorationShare: optionalFiniteOrNull(options.minTrainingExplorationShare),
  };
  if (Object.values(thresholds).every((value) => value === null)) return { ok: true, reason: null };
  if (!data) return { ok: false, reason: "missing_training_data_evidence" };
  if (thresholds.minTrainingSamples !== null && Number(data.sampleCount || 0) < thresholds.minTrainingSamples) {
    return { ok: false, reason: "training_samples_too_few" };
  }
  if (
    thresholds.minTrainingValueSamples !== null
    && Number(data.valueSamples || 0) < thresholds.minTrainingValueSamples
  ) {
    return { ok: false, reason: "training_value_samples_too_few" };
  }
  if (
    thresholds.minTrainingOutcomeClasses !== null
    && Number(data.outcomeClassCount ?? countPositiveKeys(data.outcomeBuckets)) < thresholds.minTrainingOutcomeClasses
  ) {
    return { ok: false, reason: "training_outcome_coverage_too_narrow" };
  }
  if (
    thresholds.minTrainingPolicyRows !== null
    && Number(data.policyRows || 0) < thresholds.minTrainingPolicyRows
  ) {
    return { ok: false, reason: "training_policy_rows_too_few" };
  }
  if (
    thresholds.minTrainingPolicyActionTypes !== null
    && Number(data.policyActionTypeCount ?? countPositiveKeys(data.policyActionTypes)) < thresholds.minTrainingPolicyActionTypes
  ) {
    return { ok: false, reason: "training_policy_action_coverage_too_narrow" };
  }
  if (
    thresholds.minTrainingUniqueStateHashes !== null
    && Number(data.uniqueStateHashes || 0) < thresholds.minTrainingUniqueStateHashes
  ) {
    return { ok: false, reason: "training_unique_states_too_few" };
  }
  if (
    thresholds.maxTrainingDuplicateStateRate !== null
    && (
      data.duplicateStateRate === null
      || data.duplicateStateRate === undefined
      || Number(data.duplicateStateRate) > thresholds.maxTrainingDuplicateStateRate
    )
  ) {
    return { ok: false, reason: "training_duplicate_state_rate_too_high" };
  }
  if (thresholds.minTrainingSides !== null && Object.keys(data.sides || {}).length < thresholds.minTrainingSides) {
    return { ok: false, reason: "training_side_coverage_too_narrow" };
  }
  if (thresholds.minTrainingSources !== null && (data.sources || []).length < thresholds.minTrainingSources) {
    return { ok: false, reason: "training_sources_too_few" };
  }
  if (
    thresholds.minTrainingReanalysisSamples !== null
    && Number(data.reanalysisSamples || 0) < thresholds.minTrainingReanalysisSamples
  ) {
    return { ok: false, reason: "training_reanalysis_samples_too_few" };
  }
  if (
    thresholds.minTrainingStateSnapshots !== null
    && Number(data.samplesWithStateSnapshot || 0) < thresholds.minTrainingStateSnapshots
  ) {
    return { ok: false, reason: "training_state_snapshots_too_few" };
  }
  if (
    thresholds.minTrainingAverageRootVisits !== null
    && (data.averageRootVisits === null || Number(data.averageRootVisits || 0) < thresholds.minTrainingAverageRootVisits)
  ) {
    return { ok: false, reason: "training_root_visits_too_low" };
  }
  if (
    thresholds.minTrainingSelectedActionShare !== null
    && (
      data.averageSelectedVisitShare === null
      || data.averageSelectedVisitShare === undefined
      || Number(data.averageSelectedVisitShare || 0) < thresholds.minTrainingSelectedActionShare
    )
  ) {
    return { ok: false, reason: "training_selected_action_share_too_low" };
  }
  const explorationShare = trainingExplorationShare(data);
  if (
    thresholds.minTrainingExplorationShare !== null
    && (explorationShare === null || explorationShare < thresholds.minTrainingExplorationShare)
  ) {
    return { ok: false, reason: "training_exploration_share_too_low" };
  }
  return { ok: true, reason: null };
}

function trainingExplorationShare(data) {
  const recorded = Number(data?.explorationDecisionShare);
  if (Number.isFinite(recorded)) return recorded;
  const decisions = Number(data?.samplesWithDecision || 0);
  if (!(decisions > 0)) return null;
  const modes = data?.selectionModes || {};
  const sampled = Number(data?.sampledDecisionCount ?? 0)
    || Number(modes.sampled || 0) + Number(modes.sampled_best || 0);
  const explored = Number(data?.explorationDecisionCount ?? sampled);
  if (!Number.isFinite(explored)) return null;
  return explored / decisions;
}

function decisionFallbackRate(evidence) {
  const decisions = Number(evidence?.decisionCount ?? evidence?.actionCount ?? 0);
  if (!(decisions > 0)) return null;
  return Number(evidence?.fallbackActions || 0) / decisions;
}

function countActionTypes(actionTypes) {
  return Object.values(actionTypes || {}).filter((count) => Number(count) > 0).length;
}

function countPositiveKeys(value) {
  return Object.values(value || {}).filter((count) => Number(count) > 0).length;
}

function trainingValidationGate(validation, options = {}) {
  const minSamples = optionalFiniteOrNull(options.minTrainingValidationSamples);
  const minSides = optionalFiniteOrNull(options.minTrainingValidationSides);
  const minPhases = optionalFiniteOrNull(options.minTrainingValidationPhases);
  const minGroups = optionalFiniteOrNull(options.minTrainingValidationGroups);
  const requiredGroupBy = stringOrNull(options.requiredTrainingValidationGroupBy);
  const maxValueMse = optionalFiniteOrNull(options.maxTrainingValidationValueMse);
  const maxValueCalibrationBias = optionalFiniteOrNull(options.maxTrainingValidationValueCalibrationBias);
  const maxPolicyCrossEntropy = optionalFiniteOrNull(options.maxTrainingValidationPolicyCrossEntropy);
  const minPolicyTopChoiceAccuracy = optionalFiniteOrNull(options.minTrainingValidationPolicyTopChoiceAccuracy);
  if (requiredGroupBy !== null && !SUPPORTED_TRAINING_VALIDATION_GROUP_BY.includes(requiredGroupBy)) {
    return { ok: false, reason: "unsupported_training_validation_group_by" };
  }
  const trajectoryValidation = validation?.validationGroupBy === "trajectory";
  if (
    minSamples === null
    && minSides === null
    && minPhases === null
    && minGroups === null
    && requiredGroupBy === null
    && maxValueMse === null
    && maxValueCalibrationBias === null
    && maxPolicyCrossEntropy === null
    && minPolicyTopChoiceAccuracy === null
    && !trajectoryValidation
  ) {
    return { ok: true, reason: null };
  }
  if (!validation) return { ok: false, reason: "missing_training_validation_evidence" };
  if (trajectoryValidation && validation.trajectoryOverlapCount === null) {
    return { ok: false, reason: "missing_training_validation_trajectory_overlap_evidence" };
  }
  if (trajectoryValidation && Number(validation.trajectoryOverlapCount) !== 0) {
    return { ok: false, reason: "training_validation_trajectory_overlap" };
  }
  if (validation?.explicitValidation && validation.stateHashOverlapCount === null) {
    return { ok: false, reason: "missing_training_validation_state_overlap_evidence" };
  }
  if (validation?.explicitValidation && Number(validation.stateHashOverlapCount) !== 0) {
    return { ok: false, reason: "training_validation_state_overlap" };
  }
  if (validation?.explicitValidation && validation.crossSplitComponentCount === null) {
    return { ok: false, reason: "missing_training_validation_component_overlap_evidence" };
  }
  if (validation?.explicitValidation && Number(validation.crossSplitComponentCount) !== 0) {
    return { ok: false, reason: "training_validation_component_overlap" };
  }
  if (
    validation?.explicitValidation
    && [
      validation.environmentFingerprint,
      validation.trainingArtifactFingerprint,
      validation.validationArtifactFingerprint,
      validation.trainingFileSha256,
      validation.validationFileSha256,
    ].some((fingerprint) => !fingerprint)
  ) {
    return { ok: false, reason: "missing_explicit_training_validation_fingerprint" };
  }
  if (trajectoryValidation && Number(validation.trainingTrajectories || 0) < 1) {
    return { ok: false, reason: "training_validation_training_trajectories_too_few" };
  }
  if (trajectoryValidation && Number(validation.validationTrajectories || 0) < 1) {
    return { ok: false, reason: "training_validation_validation_trajectories_too_few" };
  }
  if (minSamples !== null && Number(validation.sampleCount || 0) < minSamples) {
    return { ok: false, reason: "training_validation_samples_too_few" };
  }
  if (minSides !== null && countPositiveKeys(validation.sides) < minSides) {
    return { ok: false, reason: "training_validation_side_coverage_too_narrow" };
  }
  if (minPhases !== null && countPositiveKeys(validation.phases) < minPhases) {
    return { ok: false, reason: "training_validation_phase_coverage_too_narrow" };
  }
  if (minGroups !== null && Number(validation.validationGroups || 0) < minGroups) {
    return { ok: false, reason: "training_validation_groups_too_few" };
  }
  if (requiredGroupBy !== null && validation.validationGroupBy !== requiredGroupBy) {
    return { ok: false, reason: "training_validation_group_by_mismatch" };
  }
  if (
    maxValueMse !== null
    && (validation.value?.mse === null || validation.value?.mse === undefined || Number(validation.value.mse) > maxValueMse)
  ) {
    return { ok: false, reason: "training_validation_value_mse_too_high" };
  }
  if (
    maxValueCalibrationBias !== null
    && (
      validation.value?.calibrationBias === null
      || validation.value?.calibrationBias === undefined
      || Math.abs(Number(validation.value.calibrationBias)) > maxValueCalibrationBias
    )
  ) {
    return { ok: false, reason: "training_validation_value_calibration_bias_too_high" };
  }
  if (
    maxPolicyCrossEntropy !== null
    && (
      validation.policy?.crossEntropy === null
      || validation.policy?.crossEntropy === undefined
      || Number(validation.policy.crossEntropy) > maxPolicyCrossEntropy
    )
  ) {
    return { ok: false, reason: "training_validation_policy_cross_entropy_too_high" };
  }
  if (
    minPolicyTopChoiceAccuracy !== null
    && (
      validation.policy?.topChoiceAccuracy === null
      || validation.policy?.topChoiceAccuracy === undefined
      || Number(validation.policy.topChoiceAccuracy) < minPolicyTopChoiceAccuracy
    )
  ) {
    return { ok: false, reason: "training_validation_policy_top_choice_accuracy_too_low" };
  }
  return { ok: true, reason: null };
}

function releaseValidationError(reason, model, environment = null, featureContract = null, spatialContract = null) {
  return {
    ok: false,
    reason,
    model,
    environment,
    featureContract,
    spatialContract,
  };
}

function normalizeSubModel(value, schema) {
  if (!value || typeof value !== "object") return null;
  if (value.schema !== schema) return null;
  const weights = normalizeWeights(value.weights);
  if (!Object.keys(weights).length) return null;
  const featureKeys = Array.isArray(value.featureKeys) ? value.featureKeys.map(String) : [];
  const network = normalizeAlphaDenseNetwork(value.network, featureKeys);
  if (value.network !== undefined && !network) return null;
  return {
    schema,
    featureScales: normalizeNumberMap(value.featureScales),
    featureKeys,
    weights,
    architecture: network ? "dense-residual-v1" : "linear-v1",
    ...(network ? { network } : {}),
    metrics: normalizeMetrics(value.metrics),
  };
}

function normalizeWeights(weights) {
  return normalizeNumberMap(weights);
}

function normalizeNumberMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [String(key), Number(raw)])
      .filter(([, next]) => Number.isFinite(next)),
  );
}

function normalizeMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, raw]) => raw === null || Number.isFinite(Number(raw)))
      .map(([key, raw]) => [String(key), raw === null ? null : Number(raw)]),
  );
}

function finiteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function finiteOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function optionalFiniteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return finiteOrNull(value);
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function finiteCount(value) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
}

function nonnegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isInteger(next) && next >= 0 ? next : null;
}

function normalizeSourceHash(value) {
  if (typeof value !== "string") return null;
  const next = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(next) ? next : null;
}

function canonicalFingerprintOrNull(value) {
  if (typeof value !== "string") return null;
  const next = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(next)) return `sha256:${next}`;
  return /^sha256:[a-f0-9]{64}$/.test(next) ? next : null;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index += 1) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableValue(value, seen = new WeakSet()) {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableValue(entry, seen)).join(",")}]`;
  if (typeof value !== "object") return "null";
  if (seen.has(value)) return JSON.stringify("[Circular]");
  seen.add(value);
  const output = `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableValue(value[key], seen)}`
  )).join(",")}}`;
  seen.delete(value);
  return output;
}
