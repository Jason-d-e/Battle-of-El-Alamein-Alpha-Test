import {
  ENV_ACTION,
  activeSide,
  applyEnvironmentAction,
  calculateOdds,
  compactAction,
  generateLegalActions,
  stateHash,
  unitById,
} from "../core/index.js";
import {
  analyzeSituation,
  axisObjectiveHexes,
  evaluateSituation,
  nearestDistanceToAny,
} from "./ai-situation.js";
import {
  actionPolicyFeatures,
  alphaPolicyFeatureContributions,
  alphaTrainingSampleFeatureContract,
  alphaValueFeatureContributions,
  scoreAlphaPolicyLogit,
  scoreAlphaValueSample,
} from "./ai-alpha-training.js";
import {
  alphaHexGraphForward,
  scoreAlphaHexGraphSparsePolicy,
  scoreAlphaHexGraphValue,
} from "./ai-alpha-hex-graph.js";
import {
  alphaSpatialFeatureContract,
  encodeAlphaSpatialActionSparse,
  encodeAlphaSpatialState,
} from "./ai-alpha-spatial.js";
import { combatEliminationProfile } from "./ai-tactics.js";
import {
  alliedImmediateBreakthroughUnitIds,
  axisBreakthroughScreenRisk,
  beamSearchMovementPhase,
} from "./ai-phase-search.js";

const DEFAULT_ITERATIONS = 96;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_ACTION_LIMIT = 24;
const DEFAULT_PRE_APPLY_LIMIT = 24;
const DEFAULT_EXPLORATION = 1.35;
const DEFAULT_ROOT_DIRICHLET_ALPHA = 0.3;
const ROOT_SELECTION_PUCT = "puct";
const ROOT_SELECTION_GUMBEL = "gumbel";
const OPPOSITE_SIDE = Object.freeze({ axis: "allied", allied: "axis" });

export function analyzePosition(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const valueModel = options.model?.value || options.weights?.valueModel || null;
  const hexGraphModel = options.model?.hexGraph || options.weights?.hexGraph || null;
  const valueWeights = options.weights?.value || null;
  const cache = options.useCache === false ? null : createAlphaSearchCache();
  const root = createNode({
    environment,
    side,
    depth: 0,
    prior: 1,
    action: null,
    parent: null,
    seedValue: evaluateAlphaSearchValue(environment, { side, valueModel, valueWeights, hexGraphModel, cache }),
  });
  const startedAt = now();
  const iterations = Math.max(1, Number(options.iterations || DEFAULT_ITERATIONS));
  const timeBudgetMs = Number(options.timeBudgetMs || 0);
  const maxDepth = Math.max(1, Number(options.maxDepth || DEFAULT_MAX_DEPTH));
  const actionLimit = Number(options.actionLimit || DEFAULT_ACTION_LIMIT);
  const preApplyLimit = Number(options.preApplyLimit || defaultPreApplyLimit(actionLimit));
  const pvLimit = Math.max(0, Number(options.pvLimit || maxDepth));
  const candidateLineLimit = Math.max(0, Number(options.candidateLineLimit ?? options.lineLimit ?? 3));
  const progressInterval = Math.max(0, Math.floor(Number(options.progressInterval ?? 0)));
  const progressLimit = Math.max(0, Math.floor(Number(options.progressLimit ?? 6)));
  const policyModel = options.model?.policy || options.weights?.policy || null;
  const policyWeight = Number(options.policyWeight ?? (policyModel || hexGraphModel ? 1.6 : 0));
  const phasePlan = searchPhasePlan(environment, side, options);
  const rootPhaseActionKey = actionKey(phasePlan?.actions?.[0]);
  const phasePlanWeight = Math.max(0, Number(options.phasePlanWeight || 0));
  const priorSideMode = "active-side";
  let completedIterations = 0;
  const progress = [];
  let rootSelection = null;
  const rootSelectionMode = normalizeRootSelectionMode(options.rootSelectionMode);
  const searchContext = {
    side,
    maxDepth,
    actionLimit,
    preApplyLimit,
    exploration: Number(options.exploration || DEFAULT_EXPLORATION),
    weights: options.weights || null,
    valueModel,
    valueWeights,
    hexGraphModel,
    policyModel,
    policyWeight,
    rootNoiseWeight: Number(options.rootNoiseWeight || 0),
    rootDirichletAlpha: Number(options.rootDirichletAlpha || DEFAULT_ROOT_DIRICHLET_ALPHA),
    rootNoise: options.rootNoise || null,
    rootNoiseRandom: typeof options.rootNoiseRandom === "function" ? options.rootNoiseRandom : null,
    priorSideMode,
    rootPhaseActionKey,
    phasePlanWeight,
    cache,
  };

  if (rootSelectionMode === ROOT_SELECTION_GUMBEL) {
    expandNode(root, searchContext);
    if (!isChanceOnlyRoot(root)) {
      const gumbelResult = runGumbelSequentialHalving(root, {
        ...searchContext,
        iterations,
        startedAt,
        timeBudgetMs,
        gumbelScale: finitePositiveOrDefault(options.gumbelScale, 1),
        gumbelPriorScale: finiteNonNegativeOrDefault(options.gumbelPriorScale, 0.25),
        gumbelValueScale: finiteNonNegativeOrDefault(options.gumbelValueScale, 1),
        gumbelNoise: Array.isArray(options.gumbelNoise) ? options.gumbelNoise : null,
        gumbelRandom: typeof options.gumbelRandom === "function" ? options.gumbelRandom : null,
        gumbelSeed: options.gumbelSeed ?? null,
        onIteration: (iterationCount) => {
          if (progressInterval > 0 && iterationCount % progressInterval === 0) {
            appendProgressSnapshot(progress, root, {
              iterations: iterationCount,
              elapsedMs: now() - startedAt,
              pvLimit,
              candidateLineLimit,
              progressLimit,
            });
          }
        },
      });
      completedIterations = gumbelResult.iterations;
      rootSelection = gumbelResult.evidence;
    }
  }

  if (!rootSelection) {
    for (let index = 0; index < iterations; index += 1) {
      if (timeBudgetMs > 0 && now() - startedAt >= timeBudgetMs) break;
      const path = selectPath(root, searchContext);
      const leaf = path[path.length - 1];
      const value = evaluateAlphaSearchValue(leaf.environment, { side, valueModel, valueWeights, hexGraphModel, cache });
      backpropagate(path, value);
      completedIterations += 1;
      if (progressInterval > 0 && completedIterations % progressInterval === 0) {
        appendProgressSnapshot(progress, root, {
          iterations: completedIterations,
          elapsedMs: now() - startedAt,
          pvLimit,
          candidateLineLimit,
          progressLimit,
        });
      }
    }
  }

  if (!root.expanded) {
    expandNode(root, searchContext);
  }

  if (progressInterval > 0) {
    appendProgressSnapshot(progress, root, {
      iterations: completedIterations,
      elapsedMs: now() - startedAt,
      pvLimit,
      candidateLineLimit,
      progressLimit,
      force: true,
    });
  }

  const policy = rootPolicy(root, rootSelection?.selectedActionKey || null);
  const best = policy[0] || null;
  const recommendation = rootRecommendation(policy);
  const elapsedMs = now() - startedAt;
  const situation = alphaSearchSituation(environment, { side, cache });
  const rootValue = evaluateAlphaSearchValue(environment, { side, valueModel, valueWeights, hexGraphModel, cache });
  const explanation = searchExplanation(environment, {
    side,
    situation,
    bestAction: best?.action || null,
    valueModel,
    policyModel,
    limit: Math.max(0, Number(options.explanationLimit ?? 6)),
  });

  return {
    schema: "zizi-el-alamein-alpha-analysis-v1",
    side,
    stateHash: stateHash(environment),
    rootValue,
    situation,
    ...(explanation ? { explanation } : {}),
    ...(options.includeStateSnapshot ? { initialState: cloneJsonLike(environment.state) } : {}),
    bestAction: best?.action || null,
    recommendation,
    policy,
    principalVariation: principalVariation(root, pvLimit),
    candidateLines: candidateLines(root, candidateLineLimit, pvLimit),
    ...(progress.length ? { progress } : {}),
    search: {
      iterations: completedIterations,
      rootVisits: root.visits,
      rootChildren: root.children.length,
      maxDepth,
      actionLimit,
      preApplyLimit,
      elapsedMs,
      priorSideMode,
      phasePlan: phasePlan ? {
        action: phasePlan.actions?.[0] || null,
        actions: phasePlan.actions?.length || 0,
        remainingActions: cloneJsonLike(phasePlan.actions || []),
        reused: Boolean(phasePlan.reused),
        score: finiteNumberOrNull(phasePlan.projectedScore ?? phasePlan.score),
        projectionReason: phasePlan.projection?.reason || null,
        searchedNodes: finiteNumberOrNull(phasePlan.searchedNodes),
      } : null,
      cache: alphaSearchCacheSummary(cache),
      rootNoise: Number(options.rootNoiseWeight || 0) > 0
        ? {
          weight: Number(options.rootNoiseWeight || 0),
          alpha: Number(options.rootDirichletAlpha || DEFAULT_ROOT_DIRICHLET_ALPHA),
        }
        : null,
      rootSelection: rootSelection
        ? {
          mode: ROOT_SELECTION_GUMBEL,
          initialCandidates: rootSelection.initialCandidates,
          rounds: rootSelection.rounds,
          gumbelScale: rootSelection.gumbelScale,
          priorScale: rootSelection.priorScale,
          valueScale: rootSelection.valueScale,
          selectedAction: rootSelection.selectedAction,
        }
        : { mode: ROOT_SELECTION_PUCT },
    },
    requiresChance: isChanceOnlyRoot(root),
  };
}

export function chooseAlphaAction(environment, options = {}) {
  const analysis = analyzePosition(environment, options);
  return analysis.requiresChance ? null : analysis.bestAction;
}

export function makeSearchTrainingSample(analysis, outcomeSide = null) {
  const policyVisits = (analysis.policy || []).reduce((sum, item) => sum + Number(item.visits || 0), 0);
  const policyPrior = (analysis.policy || []).reduce((sum, item) => sum + Number(item.prior || 0), 0);
  return {
    schema: "zizi-el-alamein-alpha-training-sample-v1",
    stateHash: analysis.stateHash,
    side: analysis.side,
    turn: analysis.situation?.turn ?? null,
    phaseId: analysis.situation?.phaseId || null,
    ...(analysis.initialState ? { initialState: cloneJsonLike(analysis.initialState) } : {}),
    features: { ...(analysis.situation?.features || {}) },
    featureContract: alphaTrainingSampleFeatureContract(),
    rootValue: analysis.rootValue,
    outcome: outcomeSide ? outcomeValue(outcomeSide, analysis.side) : null,
    policy: (analysis.policy || []).map((item) => ({
      action: item.action,
      visitShare: policyTargetShare(item, {
        visits: policyVisits,
        prior: policyPrior,
        count: analysis.policy?.length || 0,
      }),
      visits: item.visits,
      q: item.q,
      prior: item.prior,
    })),
  };
}

function policyTargetShare(item, totals) {
  if (totals.visits > 0) return Number((Number(item.visits || 0) / totals.visits).toFixed(6));
  if (totals.prior > 0) return Number((Number(item.prior || 0) / totals.prior).toFixed(6));
  return totals.count > 0 ? Number((1 / totals.count).toFixed(6)) : 0;
}

export function actionKey(action) {
  if (!action) return "";
  const compact = compactAction(action);
  const keys = Object.keys(compact).sort();
  return keys.map((key) => `${key}:${stableValue(compact[key])}`).join("|");
}

export function matchingAlphaPhasePlanHint(cached, environment, side, legalActions) {
  if (!cached || cached.key !== alphaMovementPhasePlanKey(environment, side)) return null;
  const actions = Array.isArray(cached.actions) ? cached.actions : [];
  if (!actions.length) return null;
  const firstKey = actionKey(actions[0]);
  const legalAction = (legalActions || []).find((action) => actionKey(action) === firstKey);
  if (!legalAction) return null;
  return {
    actions: [legalAction, ...cloneJsonLike(actions.slice(1))],
    score: cached.score ?? null,
    projectedScore: cached.projectedScore ?? null,
    projection: cached.projection || null,
  };
}

export function nextAlphaReusablePhasePlan(analysis, selectedAction, environment, side) {
  const plan = analysis?.search?.phasePlan;
  const actions = Array.isArray(plan?.remainingActions) ? plan.remainingActions : [];
  if (!selectedAction || !actions.length || actionKey(actions[0]) !== actionKey(selectedAction)) return null;
  const remaining = actions.slice(1);
  if (!remaining.length) return null;
  return {
    key: alphaMovementPhasePlanKey(environment, side),
    actions: cloneJsonLike(remaining),
    score: plan.score ?? null,
    projectedScore: plan.score ?? null,
    projection: plan.projectionReason ? { reason: plan.projectionReason } : null,
  };
}

export function alphaMovementPhasePlanKey(environment, side) {
  const phaseIndex = Number(environment?.state?.phaseIndex || 0);
  const phase = environment?.rules?.phases?.[phaseIndex] || null;
  if (phase?.type !== "movement" || phase?.side !== side) return null;
  return `${Number(environment?.state?.turn || 1)}:${phaseIndex}:${side}`;
}

export function mixAlphaRootPriors(priors, noise, weight = 0.25) {
  const base = normalizeProbabilityVector(priors);
  if (!base.length) return [];
  const blendWeight = clamp(Number(weight || 0), 0, 1);
  if (!(blendWeight > 0)) return base;
  const perturbation = normalizeProbabilityVector(padVector(noise, base.length));
  if (!perturbation.length) return base;
  return normalizeProbabilityVector(base.map((prior, index) => (
    prior * (1 - blendWeight) + perturbation[index] * blendWeight
  )));
}

export function generateAlphaRootNoise(count, alpha = DEFAULT_ROOT_DIRICHLET_ALPHA, random = null) {
  const length = Math.max(0, Math.floor(Number(count || 0)));
  if (!length) return [];
  if (typeof random !== "function") return Array.from({ length }, () => 1 / length);
  const concentration = Math.max(0.001, Number(alpha || DEFAULT_ROOT_DIRICHLET_ALPHA));
  const raw = Array.from({ length }, () => sampleGamma(concentration, random));
  return normalizeProbabilityVector(raw);
}

function createNode({ environment, side, depth, prior, action, parent, seedValue = null }) {
  return {
    environment,
    side,
    depth,
    prior,
    action,
    parent,
    seedValue: seedValue ?? evaluateSituation(environment, { side }),
    valueSum: 0,
    visits: 0,
    children: [],
    expanded: false,
    terminal: Boolean(environment.state?.winner),
  };
}

function selectPath(root, options) {
  const path = [root];
  let node = root;
  while (!node.terminal && node.depth < options.maxDepth) {
    if (!node.expanded) {
      expandNode(node, options);
      break;
    }
    if (!node.children.length) break;
    node = selectChild(node, options);
    path.push(node);
  }
  return path;
}

function runGumbelSequentialHalving(root, options) {
  const budget = Math.max(1, Math.floor(Number(options.iterations || 1)));
  const initialCount = gumbelInitialCandidateCount(root.children.length, budget);
  const candidates = root.children.map((child, index) => ({
    child,
    index,
    gumbel: rootGumbelValue(root, child, index, options),
  }));
  let active = rankGumbelCandidates(candidates, options).slice(0, initialCount);
  let completed = 0;
  const rounds = [];

  while (active.length > 1 && completed < budget && !gumbelTimeExpired(options)) {
    const roundsRemaining = Math.max(1, Math.ceil(Math.log2(active.length)));
    const availablePerCandidate = Math.floor((budget - completed) / active.length);
    if (availablePerCandidate < 1) break;
    const visitsPerCandidate = Math.max(
      1,
      Math.min(availablePerCandidate, Math.floor((budget - completed) / (active.length * roundsRemaining)) || 1),
    );
    for (const candidate of active) {
      for (let visit = 0; visit < visitsPerCandidate; visit += 1) {
        if (completed >= budget || gumbelTimeExpired(options)) break;
        simulateForcedRootChild(root, candidate.child, options);
        completed += 1;
        options.onIteration?.(completed);
      }
    }
    const ranked = rankGumbelCandidates(active, options);
    const survivorCount = Math.max(1, Math.ceil(ranked.length / 2));
    active = ranked.slice(0, survivorCount);
    rounds.push({
      candidates: ranked.length,
      visitsPerCandidate,
      survivors: active.length,
      completedIterations: completed,
    });
  }

  active = rankGumbelCandidates(active.length ? active : candidates, options);
  const winner = active[0] || null;
  while (winner && completed < budget && !gumbelTimeExpired(options)) {
    simulateForcedRootChild(root, winner.child, options);
    completed += 1;
    options.onIteration?.(completed);
  }
  return {
    iterations: completed,
    evidence: {
      mode: ROOT_SELECTION_GUMBEL,
      initialCandidates: initialCount,
      rounds,
      gumbelScale: options.gumbelScale,
      priorScale: options.gumbelPriorScale,
      valueScale: options.gumbelValueScale,
      selectedActionKey: actionKey(winner?.child?.action),
      selectedAction: winner?.child?.action ? cloneJsonLike(winner.child.action) : null,
    },
  };
}

function simulateForcedRootChild(root, child, options) {
  const path = [root, child];
  let node = child;
  while (!node.terminal && node.depth < options.maxDepth) {
    if (!node.expanded) {
      expandNode(node, options);
      break;
    }
    if (!node.children.length) break;
    node = selectChild(node, options);
    path.push(node);
  }
  const leaf = path[path.length - 1];
  const value = evaluateAlphaSearchValue(leaf.environment, {
    side: options.side,
    valueModel: options.valueModel,
    valueWeights: options.valueWeights,
    hexGraphModel: options.hexGraphModel,
    cache: options.cache,
  });
  backpropagate(path, value);
}

function rankGumbelCandidates(candidates, options) {
  return (candidates || []).slice().sort((left, right) => (
    gumbelCandidateScore(right, options) - gumbelCandidateScore(left, options)
    || actionKey(left.child.action).localeCompare(actionKey(right.child.action))
  ));
}

function gumbelCandidateScore(candidate, options) {
  const child = candidate.child;
  const q = child.visits ? child.valueSum / child.visits : child.seedValue;
  return Number(candidate.gumbel || 0)
    + Number(options.gumbelPriorScale || 0) * Math.log(Math.max(1e-12, Number(child.prior || 0)))
    + Number(options.gumbelValueScale || 0) * Number(q || 0);
}

function rootGumbelValue(root, child, index, options) {
  const explicit = Number(options.gumbelNoise?.[index]);
  if (Number.isFinite(explicit)) return explicit * options.gumbelScale;
  let unit = null;
  if (typeof options.gumbelRandom === "function") unit = Number(options.gumbelRandom());
  else if (options.gumbelSeed !== null && options.gumbelSeed !== undefined) {
    unit = deterministicUnitInterval(`${options.gumbelSeed}:${stateHash(root.environment)}:${actionKey(child.action)}`);
  }
  if (!Number.isFinite(unit)) return 0;
  return sampleGumbel(unit) * options.gumbelScale;
}

function gumbelInitialCandidateCount(childCount, budget) {
  const maximum = Math.max(1, Math.min(Math.floor(Number(childCount || 0)), Math.floor(Number(budget || 1))));
  let count = 1;
  while (count * 2 <= maximum) {
    const candidate = count * 2;
    if (candidate * Math.ceil(Math.log2(candidate)) > budget) break;
    count = candidate;
  }
  return count;
}

function gumbelTimeExpired(options) {
  return Number(options.timeBudgetMs || 0) > 0
    && now() - Number(options.startedAt || 0) >= Number(options.timeBudgetMs);
}

function sampleGumbel(value) {
  const unit = clamp(Number(value || 0), 1e-9, 1 - 1e-9);
  return -Math.log(-Math.log(unit));
}

function deterministicUnitInterval(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 0.5) / 4294967296;
}

function normalizeRootSelectionMode(value) {
  return String(value || ROOT_SELECTION_PUCT).trim().toLowerCase() === ROOT_SELECTION_GUMBEL
    ? ROOT_SELECTION_GUMBEL
    : ROOT_SELECTION_PUCT;
}

function expandNode(node, options) {
  if (node.expanded || node.terminal || node.depth >= options.maxDepth) {
    node.expanded = true;
    return;
  }

  const legalActions = generateLegalActions(node.environment, { includeChanceActions: true });
  const priorSide = priorSideForNode(node, options);
  const priorOptions = {
    ...options,
    side: priorSide,
    nodeDepth: node.depth,
  };
  const candidateActions = preselectActions(node.environment, legalActions, priorOptions);
  const currentValue = evaluateAlphaSearchValue(node.environment, {
    side: priorSide,
    valueModel: options.valueModel,
    valueWeights: options.valueWeights || null,
    hexGraphModel: options.hexGraphPreselection === true ? options.hexGraphModel : null,
    cache: options.cache,
  });
  const candidates = [];
  for (const action of candidateActions) {
    const applied = applyEnvironmentAction(node.environment, action, quietApplyOptions());
    if (!applied.ok) continue;
    const priorScore = actionPriorScore(node.environment, action, {
      ...priorOptions,
      side: priorSide,
      currentValue,
      appliedEnvironment: applied.environment,
    });
    candidates.push({
      action: applied.action,
      environment: applied.environment,
      priorScore,
    });
  }

  const limited = candidates
    .sort((a, b) => b.priorScore - a.priorScore || actionKey(a.action).localeCompare(actionKey(b.action)));
  // A combat die is a probability distribution, not a decision menu. Never
  // let the decision action budget remove legal chance outcomes.
  const selected = legalActions.length > 0 && legalActions.every(isChanceAction)
    ? limited
    : limited.slice(0, Number(options.actionLimit || DEFAULT_ACTION_LIMIT));
  const priors = rootAdjustedPriors(
    normalizePriors(selected.map((candidate) => candidate.priorScore)),
    node,
    options,
  );
  node.children = selected.map((candidate, index) => {
    const seedValue = evaluateAlphaSearchValue(candidate.environment, {
      side: options.side,
      valueModel: options.valueModel,
      valueWeights: options.valueWeights || null,
      hexGraphModel: options.hexGraphModel,
      cache: options.cache,
    });
    return createNode({
      environment: candidate.environment,
      side: options.side,
      depth: node.depth + 1,
      prior: priors[index],
      action: candidate.action,
      parent: node,
      seedValue,
    });
  });
  node.expanded = true;
}

function priorSideForNode(node, options) {
  return activeSide(node.environment) || options.side;
}

function selectChild(node, options) {
  if (isChanceNode(node)) {
    return node.children
      .slice()
      .sort((a, b) => a.visits - b.visits || actionKey(a.action).localeCompare(actionKey(b.action)))[0];
  }

  const maximizing = activeSide(node.environment) === options.side;
  let best = null;
  for (const child of node.children) {
    const q = child.visits ? child.valueSum / child.visits : child.seedValue;
    const exploration = options.exploration * child.prior * Math.sqrt(node.visits + 1) / (1 + child.visits);
    const score = maximizing ? q + exploration : -q + exploration;
    if (!best || score > best.score) best = { child, score };
  }
  return best.child;
}

function actionPriorScore(environment, action, options) {
  if (isChanceAction(action)) return 0;
  const afterValue = evaluateAlphaSearchValue(options.appliedEnvironment, {
    side: options.side,
    valueModel: options.valueModel,
    valueWeights: options.valueWeights || null,
    hexGraphModel: options.hexGraphPreselection === true ? options.hexGraphModel : null,
    cache: options.cache,
  });
  let score = (afterValue - options.currentValue) * 4;
  if (options.appliedEnvironment.state.winner?.side === options.side) score += 8;
  else if (options.appliedEnvironment.state.winner) score -= 8;

  return score + preActionPriorScore(environment, action, options);
}

function evaluateAlphaSearchValue(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const evaluatorScope = alphaSearchValueEvaluatorScope(options, environment);
  const cached = alphaSearchScopedCacheGet(options.cache?.values, environment, side, evaluatorScope);
  if (cached.hit) {
    options.cache.stats.valueHits += 1;
    return cached.value;
  }
  if (options.cache) options.cache.stats.valueMisses += 1;
  let value;
  const winner = environment.state?.winner;
  if (winner?.side === side) value = 1;
  else if (winner && winner.side !== side) value = -1;
  if (value === undefined && options.hexGraphModel) {
    const graph = alphaSearchHexGraphContext(environment, side, options.hexGraphModel, options.cache);
    const graphValue = graph
      ? scoreAlphaHexGraphValue(graph.stateEncoding, graph.contract, options.hexGraphModel, graph.forward)
      : null;
    if (Number.isFinite(graphValue)) value = graphValue;
  }
  if (value === undefined && options.valueModel?.weights && Object.keys(options.valueModel.weights).length) {
    const situation = alphaSearchSituation(environment, { side, cache: options.cache });
    value = scoreAlphaValueSample({
      side,
      turn: situation.turn,
      phaseId: situation.phaseId,
      features: situation.features,
    }, options.valueModel);
  } else if (value === undefined) {
    const situation = alphaSearchSituation(environment, { side, cache: options.cache });
    value = evaluateSituation(environment, {
      side,
      weights: options.valueWeights || null,
      analysis: situation,
    });
  }
  alphaSearchScopedCacheSet(options.cache?.values, environment, side, evaluatorScope, value);
  return value;
}

function alphaSearchValueEvaluatorScope(options, environment = null) {
  if (environment?.state?.winner) return "terminal";
  if (options.hexGraphModel) return "hex-graph";
  if (options.valueModel?.weights && Object.keys(options.valueModel.weights).length) return "value-model";
  return "heuristic";
}

function preselectActions(environment, legalActions, options) {
  if (legalActions.every(isChanceAction)) return legalActions;
  return legalActions
    .map((action) => ({
      action,
      score: preActionPriorScore(environment, action, options),
    }))
    .sort((a, b) => b.score - a.score || actionKey(a.action).localeCompare(actionKey(b.action)))
    .slice(0, Number(options.preApplyLimit || DEFAULT_PRE_APPLY_LIMIT))
    .map((candidate) => candidate.action);
}

function preActionPriorScore(environment, action, options) {
  let score = 0;
  if (action.type === ENV_ACTION.MOVE_UNIT) score += movePriorScore(environment, action, options.side);
  else if (action.type === ENV_ACTION.DECLARE_COMBAT) score += combatPriorScore(environment, action, options);
  else if (action.type === ENV_ACTION.END_PHASE) score -= 0.15;
  else if (action.type === ENV_ACTION.FINISH_DECLARATIONS) score -= 0.05;
  else if (action.type === ENV_ACTION.ADVANCE_UNIT) score += advancePriorScore(environment, action, options);
  else if (action.type === ENV_ACTION.SKIP_ADVANCE) score -= 0.1;
  const phasePlanBonus = options.nodeDepth === 0
    && options.rootPhaseActionKey
    && actionKey(action) === options.rootPhaseActionKey
    ? Number(options.phasePlanWeight || 0)
    : 0;
  return score + modelPolicyPriorScore(environment, action, options) + phasePlanBonus;
}

function searchPhasePlan(environment, side, options) {
  const weight = Math.max(0, Number(options.phasePlanWeight || 0));
  const phase = environment?.rules?.phases?.[Number(environment?.state?.phaseIndex || 0)] || null;
  if (!(weight > 0) || phase?.type !== "movement" || phase?.side !== side) return null;
  const reusable = reusablePhasePlanHint(environment, options.phasePlanHint);
  if (reusable) return reusable;
  const beamWidth = Number(options.phasePlanBeamWidth || 12);
  const searched = beamSearchMovementPhase(environment, {
    side,
    beamWidth,
    candidateLimit: Number(options.phasePlanCandidateLimit || 24),
    maxActions: Number(options.phasePlanMaxActions || 16),
    nodeLimit: Number(options.phasePlanNodeLimit || 120),
    timeBudgetMs: Number(options.phasePlanTimeBudgetMs || 0),
    minNodes: Number(options.phasePlanMinNodes || 8),
    projectionBeamLimit: Number(options.phasePlanProjectionBeams || Math.min(6, beamWidth)),
  });
  return searched ? { ...searched, reused: false } : null;
}

function reusablePhasePlanHint(environment, hint) {
  const actions = Array.isArray(hint?.actions) ? hint.actions.filter(Boolean) : [];
  if (!actions.length) return null;
  const firstKey = actionKey(actions[0]);
  const legalAction = generateLegalActions(environment, { includeChanceActions: false })
    .find((action) => actionKey(action) === firstKey);
  if (!legalAction) return null;
  return {
    actions: [legalAction, ...cloneJsonLike(actions.slice(1))],
    score: finiteNumberOrNull(hint.score),
    projectedScore: finiteNumberOrNull(hint.projectedScore),
    projection: hint.projection && typeof hint.projection === "object"
      ? cloneJsonLike(hint.projection)
      : null,
    searchedNodes: 0,
    reused: true,
  };
}

function movePriorScore(environment, action, side) {
  const unit = unitById(environment.state.units, action.unitId);
  if (!unit) return 0;
  const objectives = axisObjectiveHexes(environment);
  const exitHexes = environment.scenario?.objectives?.alliedWestExitEdge || [];
  const targetHexes = unit.side === "axis" ? objectives : exitHexes;
  const currentDistance = nearestDistanceToAny(environment, unit.hexId, targetHexes);
  const nextDistance = nearestDistanceToAny(environment, action.toHexId, targetHexes);
  const progress = finiteProgress(currentDistance, nextDistance);
  let score = progress * 0.34 + Number(action.route?.remaining || 0) * 0.025;
  if (unit.side === "axis" && objectives.includes(action.toHexId)) score += 4.5;
  if (unit.side === "allied" && exitHexes.includes(action.toHexId)) score += 3.2;
  if (unit.side !== side) score *= -1;
  return score;
}

function combatPriorScore(environment, action, options) {
  const side = options.side;
  const defender = unitById(environment.state.units, action.defenderId);
  const attackers = (action.attackerIds || []).map((id) => unitById(environment.state.units, id)).filter(Boolean);
  if (!defender || !attackers.length) return 0;
  const odds = calculateOdds({
    board: environment.board,
    scenario: environment.scenario,
    rules: environment.rules,
    units: environment.state.units,
    state: environment.state,
  }, attackers, defender);
  const attackerSide = attackers[0]?.side || activeSide(environment);
  const targetValue = Number(defender.combat || 0) * 0.12 + Number(defender.movement || 0) * 0.035;
  const overcommit = Math.max(0, attackers.length - 2) * 0.12;
  const profile = combatEliminationProfile(environment, action);
  const breakthroughTargetBonus = attackerSide === "axis"
    && alliedImmediateBreakthroughUnitIds(environment, options.cache?.phaseThreats).includes(defender.id)
    ? 200
    : 0;
  const screenRisk = attackerSide === "axis" && Number(profile?.attackerAdverseRolls || 0) > 0
    ? axisBreakthroughScreenRisk(environment, attackers.map((unit) => unit.id), options.cache?.phaseThreats)
    : { increase: 0 };
  const screenRiskPenalty = Number(screenRisk.increase || 0) * Number(profile?.attackerAdverseRolls || 0) * 40;
  const score = odds.columnIndex * 0.22 + targetValue + breakthroughTargetBonus - overcommit - screenRiskPenalty;
  return attackerSide === side ? score : -score;
}

function advancePriorScore(environment, action, options) {
  const applied = applyEnvironmentAction(environment, action, {
    enrichEvents: false,
    previousState: false,
    cloneResultState: false,
  });
  if (!applied.ok) return -100;
  const before = alliedImmediateBreakthroughUnitIds(environment, options.cache?.phaseThreats).length;
  const after = alliedImmediateBreakthroughUnitIds(applied.environment, options.cache?.phaseThreats).length;
  return 0.25 - Math.max(0, after - before) * 200;
}

function modelPolicyPriorScore(environment, action, options) {
  if ((!options.policyModel && !options.hexGraphModel) || !options.policyWeight) return 0;
  if (options.hexGraphModel) {
    const graph = alphaSearchHexGraphContext(environment, options.side, options.hexGraphModel, options.cache);
    if (graph) {
      const actionEncoding = encodeAlphaSpatialActionSparse(action, {
        scenario: environment.scenario,
        board: environment.board,
        state: environment.state,
      });
      const graphLogit = scoreAlphaHexGraphSparsePolicy(
        graph.stateEncoding,
        actionEncoding,
        graph.contract,
        options.hexGraphModel,
        graph.forward,
      );
      if (Number.isFinite(graphLogit)) return clamp(graphLogit, -8, 8) * options.policyWeight;
    }
  }
  if (!options.policyModel) return 0;
  const situation = alphaSearchSituation(environment, {
    side: options.side,
    cache: options.cache,
  });
  const logit = scoreAlphaPolicyLogit(
    actionPolicyFeatures(action, {
      side: options.side,
      turn: situation.turn,
      phaseId: situation.phaseId,
      features: situation.features,
    }, environment.scenario, environment),
    options.policyModel,
  );
  return clamp(logit, -8, 8) * options.policyWeight;
}

function createAlphaSearchCache() {
  return {
    situations: new WeakMap(),
    values: new WeakMap(),
    hexGraphs: new WeakMap(),
    phaseThreats: new Map(),
    stats: {
      situationHits: 0,
      situationMisses: 0,
      valueHits: 0,
      valueMisses: 0,
    },
  };
}

function alphaSearchHexGraphContext(environment, side, model, cache = null) {
  if (!environment?.scenario || !environment?.state || !side || !model) return null;
  const bySide = cache?.hexGraphs?.get(environment);
  if (bySide?.has(side)) return bySide.get(side);
  const contract = alphaSpatialFeatureContract(environment.scenario, environment.board);
  const stateEncoding = encodeAlphaSpatialState({
    scenario: environment.scenario,
    rules: environment.rules,
    board: environment.board,
    state: environment.state,
    side,
  });
  const forward = alphaHexGraphForward(stateEncoding, contract, model);
  const context = forward ? { contract, stateEncoding, forward } : null;
  if (cache?.hexGraphs) {
    let nextBySide = bySide;
    if (!nextBySide) {
      nextBySide = new Map();
      cache.hexGraphs.set(environment, nextBySide);
    }
    nextBySide.set(side, context);
  }
  return context;
}

function alphaSearchSituation(environment, options = {}) {
  const side = options.side || activeSide(environment);
  const cached = alphaSearchCacheGet(options.cache?.situations, environment, side);
  if (cached.hit) {
    options.cache.stats.situationHits += 1;
    return cached.value;
  }
  if (options.cache) options.cache.stats.situationMisses += 1;
  const situation = analyzeSituation(environment, { side });
  alphaSearchCacheSet(options.cache?.situations, environment, side, situation);
  return situation;
}

function alphaSearchCacheGet(cache, environment, side) {
  if (!cache || !environment || typeof environment !== "object") return { hit: false, value: null };
  const bySide = cache.get(environment);
  if (!bySide?.has(side)) return { hit: false, value: null };
  return { hit: true, value: bySide.get(side) };
}

function alphaSearchCacheSet(cache, environment, side, value) {
  if (!cache || !environment || typeof environment !== "object") return;
  let bySide = cache.get(environment);
  if (!bySide) {
    bySide = new Map();
    cache.set(environment, bySide);
  }
  bySide.set(side, value);
}

function alphaSearchScopedCacheGet(cache, environment, side, scope) {
  if (!cache || !environment || typeof environment !== "object") return { hit: false, value: null };
  const bySide = cache.get(environment);
  const byScope = bySide?.get(side);
  if (!byScope?.has(scope)) return { hit: false, value: null };
  return { hit: true, value: byScope.get(scope) };
}

function alphaSearchScopedCacheSet(cache, environment, side, scope, value) {
  if (!cache || !environment || typeof environment !== "object") return;
  let bySide = cache.get(environment);
  if (!bySide) {
    bySide = new Map();
    cache.set(environment, bySide);
  }
  let byScope = bySide.get(side);
  if (!byScope) {
    byScope = new Map();
    bySide.set(side, byScope);
  }
  byScope.set(scope, value);
}

function alphaSearchCacheSummary(cache) {
  if (!cache) {
    return {
      scope: "analysis",
      enabled: false,
      situationHits: 0,
      situationMisses: 0,
      valueHits: 0,
      valueMisses: 0,
    };
  }
  return {
    scope: "analysis",
    enabled: true,
    ...cache.stats,
  };
}

function backpropagate(path, value) {
  for (const node of path) {
    node.visits += 1;
    node.valueSum += value;
  }
}

function policyEntry(child, totalVisits = 0) {
  return {
    action: child.action,
    prior: Number(child.prior.toFixed(6)),
    visits: child.visits,
    visitShare: policyVisitShare(child, totalVisits),
    q: Number((child.visits ? child.valueSum / child.visits : child.seedValue).toFixed(6)),
    value: Number(child.seedValue.toFixed(6)),
  };
}

function rootPolicy(root, preferredActionKey = null) {
  const totalChildVisits = root.children.reduce((sum, child) => sum + Number(child.visits || 0), 0);
  return root.children
    .map((child) => policyEntry(child, totalChildVisits))
    .sort((a, b) => (
      Number(actionKey(b.action) === preferredActionKey) - Number(actionKey(a.action) === preferredActionKey)
      || b.visits - a.visits
      || b.q - a.q
      || b.prior - a.prior
      || actionKey(a.action).localeCompare(actionKey(b.action))
    ));
}

function appendProgressSnapshot(progress, root, options) {
  if (!Array.isArray(progress) || !(Number(options.progressLimit || 0) > 0)) return;
  const snapshot = searchProgressSnapshot(root, options);
  const lastIndex = progress.length - 1;
  if (lastIndex >= 0 && progress[lastIndex].iterations === snapshot.iterations) {
    progress[lastIndex] = snapshot;
    return;
  }
  if (progress.length >= options.progressLimit) {
    if (options.force) progress[lastIndex] = snapshot;
    return;
  }
  progress.push(snapshot);
}

function searchProgressSnapshot(root, options) {
  const policy = rootPolicy(root);
  return {
    schema: "zizi-el-alamein-alpha-progress-v1",
    iterations: Math.max(0, Math.floor(Number(options.iterations || 0))),
    elapsedMs: Math.max(0, Math.round(Number(options.elapsedMs || 0))),
    rootVisits: root.visits,
    rootChildren: root.children.length,
    bestAction: policy[0]?.action || null,
    recommendation: rootRecommendation(policy),
    topPolicy: policy.slice(0, 4),
    principalVariation: principalVariation(root, options.pvLimit),
    candidateLines: candidateLines(root, options.candidateLineLimit, options.pvLimit),
  };
}

function rootRecommendation(policy) {
  if (!Array.isArray(policy) || !policy.length) return null;
  const best = policy[0];
  const runnerUp = policy[1] || null;
  const distribution = policyDistribution(policy);
  const entropy = normalizedEntropy(distribution);
  const bestVisitShare = finiteNumber(best.visitShare, distribution[0] ?? 0);
  const runnerUpVisitShare = runnerUp ? finiteNumber(runnerUp.visitShare, distribution[1] ?? 0) : 0;
  const visitMargin = bestVisitShare - runnerUpVisitShare;
  const qMargin = runnerUp ? finiteNumber(best.q, 0) - finiteNumber(runnerUp.q, 0) : null;
  const priorMargin = runnerUp ? finiteNumber(best.prior, 0) - finiteNumber(runnerUp.prior, 0) : null;
  const agreement = clamp(1 - entropy, 0, 1);
  const confidence = policy.length === 1
    ? 1
    : clamp((bestVisitShare * 0.5) + (Math.max(0, visitMargin) * 0.35) + (agreement * 0.15), 0, 1);
  return {
    schema: "zizi-el-alamein-alpha-recommendation-v1",
    action: best.action,
    confidence: rounded(confidence),
    label: recommendationLabel(confidence, visitMargin, policy.length),
    bestVisitShare: rounded(bestVisitShare),
    runnerUpVisitShare: rounded(runnerUpVisitShare),
    visitMargin: rounded(visitMargin),
    qMargin: qMargin === null ? null : rounded(qMargin),
    priorMargin: priorMargin === null ? null : rounded(priorMargin),
    entropy: rounded(entropy),
    choices: policy.length,
  };
}

function searchExplanation(environment, options = {}) {
  const sample = {
    side: options.side,
    turn: options.situation?.turn ?? null,
    phaseId: options.situation?.phaseId || null,
    features: options.situation?.features || {},
  };
  const value = options.valueModel?.weights
    ? compactContributionExplanation(alphaValueFeatureContributions(sample, options.valueModel), options.limit)
    : null;
  const policy = options.policyModel?.weights && options.bestAction
    ? {
      ...compactContributionExplanation(
        alphaPolicyFeatureContributions(
          actionPolicyFeatures(options.bestAction, sample, environment.scenario, environment),
          options.policyModel,
        ),
        options.limit,
      ),
      action: options.bestAction,
    }
    : null;
  if (!value && !policy) return null;
  return {
    schema: "zizi-el-alamein-alpha-search-explanation-v1",
    value,
    policy,
  };
}

function compactContributionExplanation(explanation, limit = 6) {
  if (!explanation) return null;
  return {
    ...explanation,
    entries: (explanation.entries || [])
      .filter((entry) => Number(entry.contribution || 0) !== 0)
      .slice(0, Math.max(0, Number(limit || 0))),
  };
}

function recommendationLabel(confidence, visitMargin, choices) {
  if (choices <= 1) return "forced";
  if (confidence >= 0.65 && visitMargin >= 0.2) return "strong";
  if (confidence >= 0.45 && visitMargin >= 0.08) return "stable";
  return "contested";
}

function policyDistribution(policy) {
  if (!policy.length) return [];
  const visitTotal = policy.reduce((sum, entry) => sum + Math.max(0, finiteNumber(entry.visits, 0)), 0);
  if (visitTotal > 0) {
    return policy.map((entry) => Math.max(0, finiteNumber(entry.visits, 0)) / visitTotal);
  }
  const priorTotal = policy.reduce((sum, entry) => sum + Math.max(0, finiteNumber(entry.prior, 0)), 0);
  if (priorTotal > 0) {
    return policy.map((entry) => Math.max(0, finiteNumber(entry.prior, 0)) / priorTotal);
  }
  return policy.map(() => 1 / policy.length);
}

function normalizedEntropy(distribution) {
  if (!distribution.length || distribution.length === 1) return 0;
  const entropy = distribution.reduce((sum, probability) => (
    probability > 0 ? sum - probability * Math.log(probability) : sum
  ), 0);
  return clamp(entropy / Math.log(distribution.length), 0, 1);
}

function principalVariation(root, limit) {
  return variationFromNode(root, limit, false);
}

function candidateLines(root, limit, variationLimit) {
  const lineCount = Math.max(0, Math.floor(Number(limit || 0)));
  if (!lineCount || !root.children.length) return [];
  const totalVisits = root.children.reduce((sum, child) => sum + Number(child.visits || 0), 0);
  return root.children
    .slice()
    .sort((a, b) => b.visits - a.visits || b.seedValue - a.seedValue || b.prior - a.prior || actionKey(a.action).localeCompare(actionKey(b.action)))
    .slice(0, lineCount)
    .map((child) => ({
      ...policyEntry(child, totalVisits),
      principalVariation: variationFromNode(child, variationLimit, true),
    }));
}

function variationFromNode(start, limit, includeStart) {
  const variation = [];
  let node = start;
  if (includeStart && node.action && variation.length < limit) {
    variation.push(variationEntry(node));
  }
  while (node.children.length && variation.length < limit) {
    node = node.children
      .slice()
      .sort((a, b) => b.visits - a.visits || b.seedValue - a.seedValue || actionKey(a.action).localeCompare(actionKey(b.action)))[0];
    variation.push(variationEntry(node));
  }
  return variation;
}

function variationEntry(node) {
  return {
    action: node.action,
    visits: node.visits,
    q: Number((node.visits ? node.valueSum / node.visits : node.seedValue).toFixed(6)),
  };
}

function policyVisitShare(child, totalVisits) {
  if (Number(totalVisits || 0) > 0) {
    return Number((Number(child.visits || 0) / Number(totalVisits || 1)).toFixed(6));
  }
  return Number(child.prior.toFixed(6));
}

function rounded(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Number(next.toFixed(6));
}

function finiteNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function finitePositiveOrDefault(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function finiteNonNegativeOrDefault(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 ? next : fallback;
}

function finiteNumberOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function isChanceNode(node) {
  return node.children.length > 0 && node.children.every((child) => isChanceAction(child.action));
}

function isChanceOnlyRoot(root) {
  return root.children.length > 0 && root.children.every((child) => isChanceAction(child.action));
}

function isChanceAction(action) {
  return action?.type === ENV_ACTION.RESOLVE_COMBAT && Number.isInteger(Number(action.dieRoll));
}

function normalizePriors(scores) {
  if (!scores.length) return [];
  const max = Math.max(...scores);
  const raw = scores.map((score) => Math.exp(Math.max(-8, Math.min(8, score - max))));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => value / total);
}

function rootAdjustedPriors(priors, node, options) {
  if (node.depth !== 0 || !(Number(options.rootNoiseWeight || 0) > 0)) return priors;
  const noise = Array.isArray(options.rootNoise)
    ? options.rootNoise
    : generateAlphaRootNoise(priors.length, options.rootDirichletAlpha, options.rootNoiseRandom);
  return mixAlphaRootPriors(priors, noise, options.rootNoiseWeight);
}

function normalizeProbabilityVector(values) {
  const clean = Array.isArray(values)
    ? values.map((value) => Math.max(0, Number(value || 0)))
    : [];
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (!clean.length) return [];
  if (!(total > 0)) return clean.map(() => 1 / clean.length);
  return clean.map((value) => value / total);
}

function padVector(values, length) {
  if (!Array.isArray(values) || !length) return [];
  return Array.from({ length }, (_, index) => values[index] ?? 0);
}

function sampleGamma(shape, random) {
  if (shape < 1) {
    const boost = sampleGamma(shape + 1, random);
    return boost * (clampOpenUnit(random()) ** (1 / shape));
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const x = sampleStandardNormal(random);
    const base = 1 + c * x;
    if (!(base > 0)) continue;
    const candidate = base ** 3;
    const accept = clampOpenUnit(random());
    if (accept < 1 - 0.0331 * (x ** 4)) return d * candidate;
    if (Math.log(accept) < 0.5 * x * x + d * (1 - candidate + Math.log(candidate))) {
      return d * candidate;
    }
  }
  return -Math.log(clampOpenUnit(random()));
}

function sampleStandardNormal(random) {
  const u1 = clampOpenUnit(random());
  const u2 = clampOpenUnit(random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clampOpenUnit(value) {
  return clamp(Number(value || 0), 1e-12, 0.999999999999);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function quietApplyOptions() {
  return {
    enrichEvents: false,
    previousState: false,
    cloneResultState: false,
  };
}

function finiteProgress(currentDistance, nextDistance) {
  if (!Number.isFinite(currentDistance) || !Number.isFinite(nextDistance)) return 0;
  return currentDistance - nextDistance;
}

function outcomeValue(outcomeSide, side) {
  if (outcomeSide === side) return 1;
  if (outcomeSide === OPPOSITE_SIDE[side]) return -1;
  return 0;
}

function stableValue(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

function cloneJsonLike(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function now() {
  return Date.now();
}

function defaultPreApplyLimit(actionLimit) {
  return Math.min(96, Math.max(DEFAULT_PRE_APPLY_LIMIT, Number(actionLimit || DEFAULT_ACTION_LIMIT) * 3));
}
