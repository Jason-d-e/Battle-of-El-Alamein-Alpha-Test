export const MAP_ZOOM_LEVELS = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2]);
export const DEFAULT_MAP_ZOOM = 1;
export const FIT_MAP_ZOOM = "fit";
export const MAP_ZOOM_CLICK_STEP = 0.05;
export const MAP_ZOOM_HOLD_STEP = 0.01;
export const ALPHA_MAP_ZOOM_STORAGE_KEY = "zizi-el-alamein-alpha-map-zoom-v3";

const MIN_RENDERED_MAP_ZOOM = 0.5;
const MAX_RENDERED_MAP_ZOOM = 4;

/**
 * Clamps a persisted manual percentage without snapping smooth adjustments.
 *
 * @param {unknown} value Candidate zoom value.
 * @returns {number} Supported zoom multiplier.
 */
export function normalizeMapZoom(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_MAP_ZOOM;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAP_ZOOM;
  return clampMapZoom(numeric);
}

export function clampMapZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAP_ZOOM;
  return Math.max(MAP_ZOOM_LEVELS[0], Math.min(MAP_ZOOM_LEVELS[MAP_ZOOM_LEVELS.length - 1], numeric));
}

export function normalizeMapZoomPreference(value) {
  if (value === null || value === undefined || value === "" || value === FIT_MAP_ZOOM) return FIT_MAP_ZOOM;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? normalizeMapZoom(numeric) : FIT_MAP_ZOOM;
}

export function readAlphaMapZoomPreference(storage) {
  try {
    return normalizeMapZoomPreference(storage?.getItem?.(ALPHA_MAP_ZOOM_STORAGE_KEY));
  } catch (_) {
    return FIT_MAP_ZOOM;
  }
}

export function writeAlphaMapZoomPreference(storage, preference) {
  const normalized = normalizeMapZoomPreference(preference);
  try {
    storage?.setItem?.(ALPHA_MAP_ZOOM_STORAGE_KEY, String(normalized));
    return true;
  } catch (_) {
    return false;
  }
}

export function calculateFitMapZoom({ viewportWidth, viewportHeight, mapWidth, mapHeight } = {}) {
  const availableWidth = finiteNumber(viewportWidth);
  const availableHeight = finiteNumber(viewportHeight);
  const naturalWidth = finiteNumber(mapWidth);
  const naturalHeight = finiteNumber(mapHeight);
  if (availableWidth <= 0 || availableHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return DEFAULT_MAP_ZOOM;
  }
  return clampMapZoom(Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight));
}

export function calculateMapZoomForPreference({ fitZoom, preference } = {}) {
  const fitted = clampMapZoom(fitZoom);
  if (normalizeMapZoomPreference(preference) === FIT_MAP_ZOOM) return fitted;
  return clampRenderedMapZoom(fitted * normalizeMapZoom(preference));
}

export function adjustMapZoomPreference(current, direction, step = MAP_ZOOM_CLICK_STEP) {
  const value = normalizeMapZoomPreference(current) === FIT_MAP_ZOOM
    ? DEFAULT_MAP_ZOOM
    : normalizeMapZoom(current);
  const delta = Math.abs(Number(step)) || MAP_ZOOM_CLICK_STEP;
  const signedDelta = Number(direction) < 0 ? -delta : Number(direction) > 0 ? delta : 0;
  return roundMapZoom(clampMapZoom(value + signedDelta));
}

export function stepMapZoom(current, direction) {
  return adjustMapZoomPreference(current, direction, MAP_ZOOM_CLICK_STEP);
}

export function formatMapZoom(value) {
  return `${Math.round(clampMapZoom(value) * 100)}%`;
}

export function mapZoomStageSize({ width, height, zoom } = {}) {
  const normalized = clampRenderedMapZoom(zoom);
  return {
    width: Math.max(0, Math.round(finiteNumber(width) * normalized)),
    height: Math.max(0, Math.round(finiteNumber(height) * normalized)),
  };
}

/**
 * Calculates scroll offsets that keep the same map coordinate at the center
 * after the map surface changes scale.
 */
export function preserveMapViewportCenter({
  scrollLeft = 0,
  scrollTop = 0,
  clientWidth = 0,
  clientHeight = 0,
  currentZoom = DEFAULT_MAP_ZOOM,
  nextZoom = DEFAULT_MAP_ZOOM,
} = {}) {
  const current = clampRenderedMapZoom(currentZoom);
  const next = clampRenderedMapZoom(nextZoom);
  const width = finiteNumber(clientWidth);
  const height = finiteNumber(clientHeight);
  const centerX = (finiteNumber(scrollLeft) + width / 2) / current;
  const centerY = (finiteNumber(scrollTop) + height / 2) / current;
  return {
    scrollLeft: Math.max(0, centerX * next - width / 2),
    scrollTop: Math.max(0, centerY * next - height / 2),
  };
}

export function clampRenderedMapZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MAP_ZOOM;
  return Math.max(MIN_RENDERED_MAP_ZOOM, Math.min(MAX_RENDERED_MAP_ZOOM, numeric));
}

function roundMapZoom(value) {
  return Math.round(value * 10000) / 10000;
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
