/**
 * Looks up movement and defense data for a hex terrain type.
 *
 * @param {object} rules Loaded rules JSON.
 * @param {object|null} hex Scenario hex object.
 * @returns {object} Terrain rule, falling back to desert when possible.
 */
export function terrainRule(rules, hex) {
  return rules?.terrain?.[hex?.terrain] || rules?.terrain?.desert || {};
}

/**
 * Reports whether a hex can be entered by normal movement or retreat.
 *
 * @param {object} rules Loaded rules JSON.
 * @param {object|null} hex Scenario hex object.
 * @returns {boolean}
 */
export function isPassableTerrain(rules, hex) {
  return terrainRule(rules, hex).passable !== false;
}
