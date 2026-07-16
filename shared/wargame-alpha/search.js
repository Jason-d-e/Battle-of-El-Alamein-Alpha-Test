import {
  NODE_KIND,
  applyChanceOutcome,
  applyLegalAction,
  canonicalSerialize,
  createNamespacedStateKey,
  readEnvironmentNode,
  validateEnvironmentAdapter,
  withValidatedLegalActionScope,
} from "./environment-contract.js";

export const ALPHA_SEARCH_SCHEMA = "wargame-alpha-search/v1";

export class AlphaSearchError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = "AlphaSearchError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new AlphaSearchError(code, message);
}

function measureStage(instrumentation, stage, operation, metadata = null) {
  return typeof instrumentation?.measure === "function"
    ? instrumentation.measure(stage, operation, metadata)
    : operation();
}

function cloneJson(value, instrumentation = null) {
  return measureStage(
    instrumentation,
    "stateCloning",
    () => JSON.parse(JSON.stringify(value)),
  );
}

function compareCanonicalText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finiteInteger(value, label, minimum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    fail("INVALID_SEARCH_OPTION", `${label} must be an integer greater than or equal to ${minimum}`);
  }
  return number;
}

function normalizeActionLimit(value) {
  if (value === undefined || value === null || value === Infinity) return Infinity;
  return finiteInteger(value, "actionLimit", 1);
}

function playerIndex(adapter, playerId) {
  const key = canonicalSerialize(playerId, "playerId");
  return adapter.players.findIndex((candidate) => canonicalSerialize(candidate) === key);
}

function zeroValues(adapter) {
  return adapter.players.map(() => 0);
}

function addWeightedValues(total, compensation, values, weight) {
  for (let index = 0; index < values.length; index += 1) {
    const weighted = values[index] * weight;
    const adjusted = weighted - compensation[index];
    const next = total[index] + adjusted;
    compensation[index] = (next - total[index]) - adjusted;
    total[index] = next;
  }
}

function normalizeValues(adapter, values, label) {
  if (!Array.isArray(values) || values.length !== adapter.players.length) {
    fail("INVALID_EVALUATOR_VALUES", `${label} must contain exactly one value per adapter player`);
  }
  const normalized = zeroValues(adapter);
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const entry = values[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("INVALID_EVALUATOR_VALUES", `${label}[${index}] must be an object`);
    }
    const target = playerIndex(adapter, entry.playerId);
    if (target < 0 || seen.has(target) || !Number.isFinite(entry.value)) {
      fail("INVALID_EVALUATOR_VALUES", `${label} must cover each adapter player once with a finite value`);
    }
    seen.add(target);
    normalized[target] = Number(entry.value);
  }
  return normalized;
}

function terminalValues(adapter, result) {
  return normalizeValues(adapter, result.payoffs, "terminal payoffs");
}

function valuesForOutput(adapter, values, instrumentation = null) {
  return adapter.players.map((playerId, index) => ({
    playerId: cloneJson(playerId, instrumentation),
    value: values[index],
  }));
}

function normalizePolicy(legalActions, policy) {
  if (policy !== undefined && !Array.isArray(policy)) {
    fail("INVALID_EVALUATOR_POLICY", "evaluator policy must be an array when provided");
  }
  const legalByKey = new Map(legalActions.map((entry) => [canonicalSerialize(entry.key), entry]));
  const supplied = new Map();
  for (const [index, entry] of (policy || []).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail("INVALID_EVALUATOR_POLICY", `policy[${index}] must be an object`);
    }
    const key = canonicalSerialize(entry.actionKey, `policy[${index}].actionKey`);
    if (!legalByKey.has(key)) fail("POLICY_ACTION_NOT_LEGAL", `policy[${index}] does not identify a legal action`);
    if (supplied.has(key)) fail("DUPLICATE_POLICY_ACTION", `policy contains a duplicate action at index ${index}`);
    if (!Number.isFinite(entry.prior) || entry.prior < 0) {
      fail("INVALID_EVALUATOR_POLICY", `policy[${index}].prior must be finite and nonnegative`);
    }
    supplied.set(key, Number(entry.prior));
  }

  const weighted = legalActions.map((entry) => ({
    entry,
    key: canonicalSerialize(entry.key),
    prior: supplied.get(canonicalSerialize(entry.key)) || 0,
  }));
  const total = weighted.reduce((sum, item) => sum + item.prior, 0);
  if (total > 0) {
    for (const item of weighted) item.prior /= total;
  } else {
    const uniform = 1 / Math.max(1, weighted.length);
    for (const item of weighted) item.prior = uniform;
  }
  return weighted;
}

function createNode(state, depth, edge = null) {
  return {
    state,
    stateKey: null,
    depth,
    edge,
    environmentNode: null,
    expanded: false,
    children: [],
    visits: 0,
    valueSums: null,
    leafValues: null,
  };
}

function inspectNode(context, node) {
  const role = node.depth === 0 ? "root_node_read" : "selected_child_node_read";
  node.environmentNode ||= measureStage(
    context.instrumentation,
    "environmentContractValidation",
    () => readEnvironmentNode(context.adapter, node.state, {
      instrumentation: context.instrumentation,
    }),
    {
      role,
      operation: "readEnvironmentNode",
      depth: node.depth,
    },
  );
  return node.environmentNode;
}

function recordVisit(context, node, values) {
  node.valueSums ||= zeroValues(context.adapter);
  for (let index = 0; index < values.length; index += 1) node.valueSums[index] += values[index];
  node.visits += 1;
  return values;
}

function meanValues(context, node) {
  if (!node.visits) return node.leafValues ? node.leafValues.slice() : zeroValues(context.adapter);
  return node.valueSums.map((value) => value / node.visits);
}

function evaluateDecision(context, node, environmentNode) {
  node.stateKey ??= measureStage(
    context.instrumentation,
    "environmentContractValidation",
    () => createNamespacedStateKey(context.adapter, node.state, {
      instrumentation: context.instrumentation,
    }),
    {
      role: node.depth === 0 ? "root_evaluator_state_key" : "selected_child_evaluator_state_key",
      operation: "createNamespacedStateKey",
      depth: node.depth,
      stateHash: environmentNode.stateHash,
      nodeKind: environmentNode.nodeKind,
      legalActionCount: environmentNode.legalActions.length,
    },
  );
  const result = context.evaluate({
    adapter: context.adapter,
    state: cloneJson(node.state, context.instrumentation),
    stateKey: node.stateKey,
    depth: node.depth,
    currentPlayer: cloneJson(environmentNode.currentPlayer, context.instrumentation),
    legalActions: cloneJson(environmentNode.legalActions, context.instrumentation),
  });
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("INVALID_EVALUATOR_RESULT", "evaluator must return an object");
  }
  return {
    values: normalizeValues(context.adapter, result.values, "evaluator values"),
    policy: measureStage(
      context.instrumentation,
      "policyNormalizationSort",
      () => normalizePolicy(environmentNode.legalActions, result.policy),
    ),
  };
}

function expandDecision(context, node, environmentNode) {
  const evaluation = evaluateDecision(context, node, environmentNode);
  const candidates = measureStage(
    context.instrumentation,
    "policyNormalizationSort",
    () => evaluation.policy
      .slice()
      .sort((left, right) => right.prior - left.prior || compareCanonicalText(left.key, right.key)),
  );
  const selected = context.actionLimit === Infinity
    ? candidates
    : candidates.slice(0, context.actionLimit);
  const selectedTotal = selected.reduce((sum, item) => sum + item.prior, 0);
  const fallbackPrior = 1 / Math.max(1, selected.length);
  const buildChildren = (tryApply) => selected.map((item) => ({
      key: cloneJson(item.entry.key, context.instrumentation),
      action: cloneJson(item.entry.action, context.instrumentation),
      prior: selectedTotal > 0 ? item.prior / selectedTotal : fallbackPrior,
      node: createNode(
        measureStage(
          context.instrumentation,
          "actionApplyRevalidation",
          () => {
            const reused = tryApply?.(item.entry, item.entry.key) || null;
            return reused?.applied
              ? reused.state
              : applyLegalAction(context.adapter, node.state, item.entry.key);
          },
        ),
        node.depth + 1,
        { nodeKind: NODE_KIND.DECISION, key: cloneJson(item.entry.key, context.instrumentation) },
      ),
    }));
  node.children = context.reuseValidatedLegalEntries
    ? withValidatedLegalActionScope({
        adapter: context.adapter,
        state: node.state,
        environmentNode,
        stateKey: node.stateKey,
      }, buildChildren)
    : buildChildren(null);
  node.leafValues = evaluation.values;
  node.expanded = true;
  return evaluation.values;
}

function expandChance(context, node, environmentNode) {
  node.children = environmentNode.chanceOutcomes.map((entry) => ({
    key: cloneJson(entry.key, context.instrumentation),
    outcome: cloneJson(entry.outcome, context.instrumentation),
    probability: entry.probability,
    node: entry.probability > 0
      ? createNode(
          measureStage(
            context.instrumentation,
            "actionApplyRevalidation",
            () => applyChanceOutcome(context.adapter, node.state, entry.key),
          ),
          node.depth,
          { nodeKind: NODE_KIND.CHANCE, key: cloneJson(entry.key, context.instrumentation) },
        )
      : null,
  }));
  node.expanded = true;
}

function enterChanceState(context, node, chanceStack) {
  const stateKey = createNamespacedStateKey(context.adapter, node.state);
  if (chanceStack.has(stateKey)) fail("CHANCE_CYCLE", "chance-only transition cycle detected");
  const next = new Set(chanceStack);
  next.add(stateKey);
  return next;
}

function evaluateAtCutoff(context, node, chanceStack = new Set()) {
  const environmentNode = inspectNode(context, node);
  if (environmentNode.nodeKind === NODE_KIND.TERMINAL) {
    return recordVisit(context, node, terminalValues(context.adapter, environmentNode.terminalResult));
  }
  if (environmentNode.nodeKind === NODE_KIND.DECISION) {
    return recordVisit(context, node, evaluateDecision(context, node, environmentNode).values);
  }
  if (!node.expanded) expandChance(context, node, environmentNode);
  const nextChanceStack = enterChanceState(context, node, chanceStack);
  const expected = zeroValues(context.adapter);
  const compensation = zeroValues(context.adapter);
  for (const child of node.children) {
    if (child.probability <= 0) continue;
    const values = evaluateAtCutoff(context, child.node, nextChanceStack);
    addWeightedValues(expected, compensation, values, child.probability);
  }
  return recordVisit(context, node, expected);
}

function selectDecisionChild(context, node, environmentNode) {
  const currentPlayer = playerIndex(context.adapter, environmentNode.currentPlayer);
  if (currentPlayer < 0) fail("INVALID_CURRENT_PLAYER", "decision node current player is not an adapter player");
  const parentScale = Math.sqrt(Math.max(1, node.visits));
  return node.children
    .map((child) => {
      const values = meanValues(context, child.node);
      const q = child.node.visits ? values[currentPlayer] : 0;
      const exploration = context.exploration * child.prior * parentScale / (1 + child.node.visits);
      return { child, score: q + exploration, key: canonicalSerialize(child.key) };
    })
    .sort((left, right) => right.score - left.score || compareCanonicalText(left.key, right.key))[0].child;
}

function simulate(context, node, chanceStack = new Set()) {
  return measureStage(context.instrumentation, "treeTraversal", () => {
    const environmentNode = inspectNode(context, node);
    if (environmentNode.nodeKind === NODE_KIND.TERMINAL) {
      return recordVisit(context, node, terminalValues(context.adapter, environmentNode.terminalResult));
    }

    if (environmentNode.nodeKind === NODE_KIND.CHANCE) {
      if (!node.expanded) expandChance(context, node, environmentNode);
      const nextChanceStack = enterChanceState(context, node, chanceStack);
      const expected = zeroValues(context.adapter);
      const compensation = zeroValues(context.adapter);
      for (const child of node.children) {
        if (child.probability <= 0) continue;
        const values = node.depth >= context.maxDepth
          ? evaluateAtCutoff(context, child.node, nextChanceStack)
          : simulate(context, child.node, nextChanceStack);
        addWeightedValues(expected, compensation, values, child.probability);
      }
      return recordVisit(context, node, expected);
    }

    const rootNeedsAction = node.depth === 0 && context.maxDepth === 0;
    if (!node.expanded && (node.depth < context.maxDepth || rootNeedsAction)) {
      return recordVisit(context, node, expandDecision(context, node, environmentNode));
    }
    if (!node.expanded) {
      return recordVisit(context, node, evaluateDecision(context, node, environmentNode).values);
    }
    if (node.depth >= context.maxDepth) {
      return recordVisit(context, node, node.leafValues || evaluateDecision(context, node, environmentNode).values);
    }
    const child = selectDecisionChild(context, node, environmentNode);
    return recordVisit(context, node, simulate(context, child.node, new Set()));
  });
}

function edgeValues(context, child) {
  if (!child.node) return null;
  return valuesForOutput(context.adapter, meanValues(context, child.node), context.instrumentation);
}

function decisionPolicyOutput(context, root) {
  const ordered = measureStage(
    context.instrumentation,
    "policyNormalizationSort",
    () => root.children
      .slice()
      .sort((left, right) => compareCanonicalText(canonicalSerialize(left.key), canonicalSerialize(right.key))),
  );
  return ordered.map((child) => ({
      actionKey: cloneJson(child.key, context.instrumentation),
      action: cloneJson(child.action, context.instrumentation),
      prior: child.prior,
      visits: child.node.visits,
      values: edgeValues(context, child),
    }));
}

function chanceOutput(context, root) {
  return root.children.map((child) => ({
    outcomeKey: cloneJson(child.key, context.instrumentation),
    outcome: cloneJson(child.outcome, context.instrumentation),
    probability: child.probability,
    visits: child.node?.visits || 0,
    values: edgeValues(context, child),
  }));
}

function selectedDecision(context, root, environmentNode) {
  if (!root.children.length) return null;
  const currentPlayer = playerIndex(context.adapter, environmentNode.currentPlayer);
  return measureStage(
    context.instrumentation,
    "policyNormalizationSort",
    () => root.children
      .map((child) => ({
        child,
        visits: child.node.visits,
        value: meanValues(context, child.node)[currentPlayer],
        key: canonicalSerialize(child.key),
      }))
      .sort((left, right) => (
        right.visits - left.visits
        || right.value - left.value
        || right.child.prior - left.child.prior
        || compareCanonicalText(left.key, right.key)
      ))[0].child,
  );
}

export function runAlphaSearch({
  adapter,
  state,
  evaluate,
  instrumentation = null,
  simulations = 64,
  maxDepth = 32,
  actionLimit = Infinity,
  exploration = 1.5,
  reuseValidatedLegalEntries = true,
} = {}) {
  measureStage(
    instrumentation,
    "environmentContractValidation",
    () => validateEnvironmentAdapter(adapter, { instrumentation }),
    {
      role: "search_adapter_preflight",
      operation: "validateEnvironmentAdapter",
      depth: null,
    },
  );
  if (typeof evaluate !== "function") fail("INVALID_EVALUATOR", "evaluate must be a synchronous function");
  const normalizedSimulations = finiteInteger(simulations, "simulations", 1);
  const normalizedDepth = finiteInteger(maxDepth, "maxDepth", 0);
  const normalizedActionLimit = normalizeActionLimit(actionLimit);
  if (!Number.isFinite(exploration) || exploration < 0) {
    fail("INVALID_SEARCH_OPTION", "exploration must be finite and nonnegative");
  }
  if (typeof reuseValidatedLegalEntries !== "boolean") {
    fail("INVALID_SEARCH_OPTION", "reuseValidatedLegalEntries must be a boolean");
  }

  const context = {
    adapter,
    evaluate,
    maxDepth: normalizedDepth,
    actionLimit: normalizedActionLimit,
    exploration: Number(exploration),
    reuseValidatedLegalEntries,
    instrumentation,
  };
  const root = createNode(cloneJson(state, instrumentation), 0);
  for (let index = 0; index < normalizedSimulations; index += 1) simulate(context, root);

  const environmentNode = inspectNode(context, root);
  const selected = environmentNode.nodeKind === NODE_KIND.DECISION
    ? selectedDecision(context, root, environmentNode)
    : null;
  return {
    schema: ALPHA_SEARCH_SCHEMA,
    rootStateKey: measureStage(
      instrumentation,
      "environmentContractValidation",
      () => createNamespacedStateKey(adapter, state, { instrumentation }),
      {
        role: "final_root_output_state_key",
        operation: "createNamespacedStateKey",
        depth: 0,
        stateHash: environmentNode.stateHash,
        nodeKind: environmentNode.nodeKind,
        legalActionCount: environmentNode.legalActions.length,
      },
    ),
    nodeKind: environmentNode.nodeKind,
    simulations: normalizedSimulations,
    maxDepth: normalizedDepth,
    actionLimit: normalizedActionLimit === Infinity ? null : normalizedActionLimit,
    rootValues: valuesForOutput(adapter, meanValues(context, root), instrumentation),
    selectedActionKey: selected ? cloneJson(selected.key, instrumentation) : null,
    selectedAction: selected ? cloneJson(selected.action, instrumentation) : null,
    policy: environmentNode.nodeKind === NODE_KIND.DECISION ? decisionPolicyOutput(context, root) : [],
    chanceOutcomes: environmentNode.nodeKind === NODE_KIND.CHANCE ? chanceOutput(context, root) : [],
  };
}
