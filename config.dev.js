// Dev configuration — points at a local relay.
// Activated by `./use.sh dev`.

const OFTC_CONFIG = {
  wsUrl: "ws://localhost:8080",
  // Match whatever SHARED_SECRET the local relay was launched with,
  // or leave empty if the local relay has no secret configured.
  secret: "",
};

if (typeof self !== "undefined") self.OFTC_CONFIG = OFTC_CONFIG;
