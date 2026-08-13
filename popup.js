document.getElementById("wsUrl").textContent = OFTC_CONFIG.wsUrl || "(unset)";
const s = OFTC_CONFIG.secret || "";
document.getElementById("secretMask").textContent =
  s ? `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)` : "(none)";
