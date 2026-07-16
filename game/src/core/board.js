const ODD_ROW_OFFSETS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

const EVEN_ROW_OFFSETS = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

function coordKey(col, row) {
  return `${col},${row}`;
}

/**
 * Builds immutable lookup helpers from scenario board data.
 *
 * @param {object} scenario Loaded scenario JSON.
 * @returns {{meta: object|null, hexes: object[], hexById: Map<string, object>, hexByCoord: Map<string, object>}}
 */
export function createBoard(scenario) {
  const hexes = scenario?.board?.hexes || [];
  const hexById = new Map(hexes.map((hex) => [hex.id, hex]));
  const hexByCoord = new Map(hexes.map((hex) => [coordKey(hex.col, hex.row), hex]));

  return {
    meta: scenario?.board || null,
    hexes,
    hexById,
    hexByCoord,
  };
}

/**
 * Returns a board hex by ID, or null when the ID is not on this scenario map.
 *
 * @param {object} board Board object returned by createBoard.
 * @param {string} hexId Scenario hex ID, such as "c12r03".
 * @returns {object|null}
 */
export function getHex(board, hexId) {
  return board?.hexById?.get(hexId) || null;
}

/**
 * Returns adjacent hex IDs using the scenario's odd-row offset coordinates.
 *
 * @param {object} board Board object returned by createBoard.
 * @param {string} hexId Center hex ID.
 * @returns {string[]} Adjacent in-map hex IDs.
 */
export function neighborsOf(board, hexId) {
  const hex = getHex(board, hexId);
  if (!hex) return [];

  const offsets = Math.abs(hex.row % 2) === 1 ? ODD_ROW_OFFSETS : EVEN_ROW_OFFSETS;
  return offsets
    .map(([dc, dr]) => board.hexByCoord.get(coordKey(hex.col + dc, hex.row + dr))?.id)
    .filter(Boolean);
}

/**
 * Computes shortest legal board distance in hex steps, ignoring terrain and units.
 *
 * @param {object} board Board object returned by createBoard.
 * @param {string} fromId Start hex ID.
 * @param {string} toId Target hex ID.
 * @returns {number} Hex distance, or Infinity if the target cannot be reached on the map graph.
 */
export function hexDistance(board, fromId, toId) {
  if (fromId === toId) return 0;

  const queue = [{ id: fromId, distance: 0 }];
  const seen = new Set([fromId]);

  while (queue.length) {
    const current = queue.shift();
    for (const next of neighborsOf(board, current.id)) {
      if (seen.has(next)) continue;
      if (next === toId) return current.distance + 1;
      seen.add(next);
      queue.push({ id: next, distance: current.distance + 1 });
    }
  }

  return Infinity;
}
