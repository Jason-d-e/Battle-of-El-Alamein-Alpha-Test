export const MAP_ZOOM_LEVELS = Object.freeze([0.75, 1, 1.25, 1.5, 1.75, 2]);
export const DEFAULT_MAP_ZOOM = 1;
export const FIT_MAP_ZOOM = "fit";
export const MAP_ZOOM_CLICK_STEP = 0.05;
export const MAP_ZOOM_HOLD_STEP = 0.01;
export const MAP_ZOOM_STORAGE_KEYS = Object.freeze({
  foundation: "zizi-el-alamein-foundation-map-zoom-v3",
  alpha: "zizi-el-alamein-alpha-map-zoom-v3",
  online: "zizi-el-alamein-online-map-zoom-v3",
});
export const FOUNDATION_MAP_ZOOM_STORAGE_KEY = MAP_ZOOM_STORAGE_KEYS.foundation;
export const ALPHA_MAP_ZOOM_STORAGE_KEY = MAP_ZOOM_STORAGE_KEYS.alpha;
export const ONLINE_MAP_ZOOM_STORAGE_KEY = MAP_ZOOM_STORAGE_KEYS.online;

const MAP_ZOOM_EPSILON = 1e-9;
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

/**
 * Keeps a continuous fitted zoom inside the same legal 75%-200% range.
 */
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

/**
 * Reads only a declared product namespace. The former shared v1 key is
 * intentionally ignored so Foundation, Alpha, and Online preferences cannot
 * leak together.
 */
export function readMapZoomPreference(storage, storageKey = MAP_ZOOM_STORAGE_KEYS.foundation) {
  try {
    return normalizeMapZoomPreference(storage?.getItem?.(normalizeStorageKey(storageKey)));
  } catch {
    return FIT_MAP_ZOOM;
  }
}

export function writeMapZoomPreference(storage, preference, storageKey = MAP_ZOOM_STORAGE_KEYS.foundation) {
  const normalized = normalizeMapZoomPreference(preference);
  try {
    storage?.setItem?.(normalizeStorageKey(storageKey), String(normalized));
    return true;
  } catch {
    return false;
  }
}

export function readFoundationMapZoomPreference(storage) {
  return readMapZoomPreference(storage, MAP_ZOOM_STORAGE_KEYS.foundation);
}

export function writeFoundationMapZoomPreference(storage, preference) {
  return writeMapZoomPreference(storage, preference, MAP_ZOOM_STORAGE_KEYS.foundation);
}

export function readOnlineMapZoomPreference(storage) {
  return readMapZoomPreference(storage, MAP_ZOOM_STORAGE_KEYS.online);
}

export function writeOnlineMapZoomPreference(storage, preference) {
  return writeMapZoomPreference(storage, preference, MAP_ZOOM_STORAGE_KEYS.online);
}

export function readAlphaMapZoomPreference(storage) {
  return readMapZoomPreference(storage, MAP_ZOOM_STORAGE_KEYS.alpha);
}

export function writeAlphaMapZoomPreference(storage, preference) {
  return writeMapZoomPreference(storage, preference, MAP_ZOOM_STORAGE_KEYS.alpha);
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

/**
 * Applies a manual percentage to the current fitted viewport baseline. Manual
 * 100% therefore occupies the same whole-map height as Fit at that viewport.
 */
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

/**
 * Applies at most two synchronous Fit passes so scrollbar removal from the
 * first pass cannot leave a stale viewport measurement behind.
 */
export function fitMapZoomWithStabilization({
  measureViewport,
  applyZoom,
  mapWidth,
  mapHeight,
  maxPasses = 2,
} = {}) {
  if (typeof measureViewport !== "function" || typeof applyZoom !== "function") {
    throw new TypeError("Fit stabilization requires measureViewport and applyZoom functions");
  }
  const passCount = Math.max(1, Math.min(4, Math.trunc(Number(maxPasses)) || 2));
  let appliedZoom = null;
  for (let pass = 0; pass < passCount; pass += 1) {
    const viewport = measureViewport() || {};
    const nextZoom = calculateFitMapZoom({
      viewportWidth: viewport.viewportWidth,
      viewportHeight: viewport.viewportHeight,
      mapWidth,
      mapHeight,
    });
    if (appliedZoom !== null && Math.abs(nextZoom - appliedZoom) <= MAP_ZOOM_EPSILON) return appliedZoom;
    applyZoom(nextZoom, pass);
    appliedZoom = nextZoom;
  }
  return appliedZoom ?? DEFAULT_MAP_ZOOM;
}

/**
 * Repeats the synchronous Fit calculation on the next rendering frame. Chrome
 * updates clientHeight only after painting when a zoom removes a scrollbar.
 */
export function fitMapZoomWithDeferredStabilization({ scheduler = globalThis, ...fitOptions } = {}) {
  fitMapZoomWithStabilization(fitOptions);
  if (typeof scheduler?.requestAnimationFrame !== "function") return () => {};
  let frameId = scheduler.requestAnimationFrame(() => {
    frameId = null;
    fitMapZoomWithStabilization(fitOptions);
  });
  return () => {
    if (frameId !== null) scheduler.cancelAnimationFrame?.(frameId);
    frameId = null;
  };
}

// Compatibility for older callers; the control now advances by 5%, not 25%.
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

function normalizeStorageKey(storageKey) {
  const key = String(storageKey || "").trim();
  if (!Object.values(MAP_ZOOM_STORAGE_KEYS).includes(key)) {
    throw new TypeError("Map zoom storage key must belong to a declared product profile");
  }
  return key;
}
