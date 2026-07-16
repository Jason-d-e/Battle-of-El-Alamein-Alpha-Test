import { handleAlphaRuntimeMessage } from "./ai-alpha-runtime.js?v=20260714-validated-entry-reuse-1";

self.addEventListener("message", (event) => {
  self.postMessage(handleAlphaRuntimeMessage(event.data));
});
