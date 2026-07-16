const DEFAULT_HOLD_DELAY = 320;
const DEFAULT_REPEAT_INTERVAL = 60;

export function nextMapZoomMenuIndex(currentIndex, key, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return null;
  const normalizedIndex = Number.isInteger(currentIndex) && currentIndex >= 0 ? currentIndex : 0;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowDown") return (normalizedIndex + 1) % itemCount;
  if (key === "ArrowUp") return (normalizedIndex - 1 + itemCount) % itemCount;
  return null;
}

export function closeMapZoomMenuElement(menu, menuButton, { restoreFocus = false } = {}) {
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) menuButton.focus();
}

export function createPressAndHoldController({
  onStep,
  scheduler = globalThis,
  holdDelay = DEFAULT_HOLD_DELAY,
  repeatInterval = DEFAULT_REPEAT_INTERVAL,
} = {}) {
  if (typeof onStep !== "function") throw new TypeError("onStep must be a function");

  let holdTimer = null;
  let repeatTimer = null;
  let suppressPointerClick = false;

  const stop = () => {
    if (holdTimer !== null) scheduler.clearTimeout(holdTimer);
    if (repeatTimer !== null) scheduler.clearInterval(repeatTimer);
    holdTimer = null;
    repeatTimer = null;
  };

  const release = (event = {}) => {
    const target = event.currentTarget;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    stop();
  };

  return {
    onPointerDown(event = {}) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault?.();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      stop();
      suppressPointerClick = true;
      onStep("click");
      holdTimer = scheduler.setTimeout(() => {
        holdTimer = null;
        repeatTimer = scheduler.setInterval(() => onStep("hold"), repeatInterval);
      }, holdDelay);
    },
    onPointerUp: release,
    onPointerCancel: release,
    onClick(event = {}) {
      if (event.detail !== 0 && suppressPointerClick) {
        suppressPointerClick = false;
        event.preventDefault?.();
        return;
      }
      suppressPointerClick = false;
      onStep("click");
    },
    destroy: stop,
  };
}

export function wirePressAndHoldButton(button, onStep, options = {}) {
  const controller = createPressAndHoldController({ onStep, ...options });
  const listeners = {
    pointerdown: controller.onPointerDown,
    pointerup: controller.onPointerUp,
    pointercancel: controller.onPointerCancel,
    lostpointercapture: controller.onPointerCancel,
    click: controller.onClick,
  };
  Object.entries(listeners).forEach(([type, listener]) => button.addEventListener(type, listener));
  return () => {
    controller.destroy();
    Object.entries(listeners).forEach(([type, listener]) => button.removeEventListener(type, listener));
  };
}
