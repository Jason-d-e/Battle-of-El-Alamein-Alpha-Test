(function installElAlameinProductProfile(root) {
  "use strict";

  const profiles = Object.freeze({
    foundation: freezeProfile("foundation", false, false, false, "zizi-el-alamein-foundation-map-zoom-v3"),
    alpha: freezeProfile("alpha", true, false, true, "zizi-el-alamein-alpha-map-zoom-v3"),
    online: freezeProfile("online", false, true, false, "zizi-el-alamein-online-map-zoom-v3"),
  });
  const configuredId = normalizeProfileId(root.document?.currentScript?.dataset?.profile);
  const localOverride = isLocalHost(root.location?.hostname)
    ? normalizeProfileId(new URLSearchParams(root.location?.search || "").get("profile"))
    : null;
  const current = profiles[localOverride || configuredId || "foundation"];

  if (root.document?.documentElement?.dataset) {
    root.document.documentElement.dataset.productProfile = current.id;
  }
  root.ElAlameinProductProfile = Object.freeze({
    ids: Object.freeze(Object.keys(profiles)),
    profiles,
    current,
    resolve(value) {
      return profiles[normalizeProfileId(value) || "foundation"];
    },
  });

  function freezeProfile(id, alphaRuntime, onlineFriendMatch, humanLabCaptureIntegrity, mapZoomStorageKey) {
    return Object.freeze({
      id,
      features: Object.freeze({
        scriptedAi: true,
        hotseat: true,
        trainingCapture: true,
        alphaRuntime,
        humanLabCaptureIntegrity,
        onlineFriendMatch,
      }),
      storage: Object.freeze({ mapZoomStorageKey }),
    });
  }

  function normalizeProfileId(value) {
    const id = String(value || "").trim().toLowerCase();
    return Object.hasOwn(profiles, id) ? id : null;
  }

  function isLocalHost(hostname) {
    return ["127.0.0.1", "localhost", "::1"].includes(String(hostname || "").toLowerCase());
  }
})(globalThis);
