const DEFAULT_HOLD_DELAY_MS = 320;
const DEFAULT_REPEAT_INTERVAL_MS = 60;

export function nextMapZoomMenuIndex(currentIndex, key, itemCount) {
  const count = Math.max(0, Number(itemCount) || 0);
  if (!count) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (Math.max(0, currentIndex) + 1) % count;
  if (key === "ArrowUp") return (currentIndex <= 0 ? count : currentIndex) - 1;
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
  holdDelay = DEFAULT_HOLD_DELAY_MS,
  repeatInterval = DEFAULT_REPEAT_INTERVAL_MS,
} = {}) {
  if (typeof onStep !== "function") throw new TypeError("Press-and-hold requires an onStep callback");
  let holdTimer = null;
  let repeatTimer = null;
  let suppressPointerClick = false;

  const stopTimers = () => {
    if (holdTimer !== null) scheduler.clearTimeout(holdTimer);
    if (repeatTimer !== null) scheduler.clearInterval(repeatTimer);
    holdTimer = null;
    repeatTimer = null;
  };

  const releasePointer = (event) => {
    const target = event?.currentTarget;
    if (target?.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    stopTimers();
  };

  return {
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      stopTimers();
      suppressPointerClick = true;
      onStep("click");
      holdTimer = scheduler.setTimeout(() => {
        holdTimer = null;
        repeatTimer = scheduler.setInterval(() => onStep("hold"), repeatInterval);
      }, holdDelay);
    },
    onPointerUp: releasePointer,
    onPointerCancel: releasePointer,
    onLostPointerCapture() { stopTimers(); },
    onClick(event) {
      if (event.detail !== 0 && suppressPointerClick) {
        event.preventDefault();
        suppressPointerClick = false;
        return;
      }
      suppressPointerClick = false;
      onStep("click");
    },
    destroy() {
      suppressPointerClick = false;
      stopTimers();
    },
  };
}

export function wirePressAndHoldButton(button, onStep, options = {}) {
  const controller = createPressAndHoldController({ onStep, ...options });
  button.addEventListener("pointerdown", controller.onPointerDown);
  button.addEventListener("pointerup", controller.onPointerUp);
  button.addEventListener("pointercancel", controller.onPointerCancel);
  button.addEventListener("lostpointercapture", controller.onLostPointerCapture);
  button.addEventListener("click", controller.onClick);
  return () => {
    button.removeEventListener("pointerdown", controller.onPointerDown);
    button.removeEventListener("pointerup", controller.onPointerUp);
    button.removeEventListener("pointercancel", controller.onPointerCancel);
    button.removeEventListener("lostpointercapture", controller.onLostPointerCapture);
    button.removeEventListener("click", controller.onClick);
    controller.destroy();
  };
}
