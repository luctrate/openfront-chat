// Content script: runs in the openfront.io page.
// Renders the chat overlay and forwards user input to the background WebSocket.
// Bound by the page's CSP for network calls — that's why the WS lives in background.js.

const api = typeof browser !== "undefined" ? browser : chrome;

const GLOBAL_ROOM = "__global__";

// ---- URL classification ----------------------------------------------------

// Returns:
//   { mode: "game",   roomId: "<id>",       worker: "wN" }
//   { mode: "global", roomId: "__global__", worker: null }
//   { mode: null }   — unrecognized route (e.g. /replay/…); do nothing.
function getRoomInfo() {
  try {
    const u = new URL(location.href);
    if (u.hostname !== "openfront.io" && !u.hostname.endsWith(".openfront.io")) {
      return { mode: null };
    }
    const parts = u.pathname.split("/").filter(Boolean);
    // /wN/game/<id>[/...]
    const gameIdx = parts.indexOf("game");
    if (gameIdx > 0 && parts[gameIdx + 1] && /^w\d+$/.test(parts[gameIdx - 1])) {
      return { mode: "game", roomId: parts[gameIdx + 1], worker: parts[gameIdx - 1] };
    }
    // Main page or any non-game route → global chat.
    return { mode: "global", roomId: GLOBAL_ROOM, worker: null };
  } catch {
    return { mode: null };
  }
}

// ---- identity from openfront localStorage -----------------------------------

function getGameUsername() {
  try { const raw = localStorage.getItem("username"); return raw ? String(raw).trim() : ""; }
  catch { return ""; }
}
function getGameClanTag() {
  try { const raw = localStorage.getItem("clanTag"); return raw ? String(raw).trim() : ""; }
  catch { return ""; }
}

// ---- HUD + game-state probing (only relevant when mode === "game") --------

const HUD_TAGS = ["control-panel", "leaderboard-player-list", "events-display", "team-stats", "chat-display"];
function isHudPresent() {
  for (const tag of HUD_TAGS) if (document.querySelector(tag)) return true;
  return false;
}

let latestGameState = null;
async function probeGameState() {
  try {
    const s = await api.runtime.sendMessage({ type: "probe-game-state" });
    latestGameState = s;
    console.log("[oftc cs] probe result", s);
    return s;
  } catch (e) {
    console.warn("[oftc cs] probe failed", e);
    return null;
  }
}

// ---- room sync --------------------------------------------------------------

let currentRoom = null;
let currentMode = null;   // "global" | "game"
let currentTeam = null;   // only set in team games
let joinPollTimer = null;

function stopPolling() {
  if (joinPollTimer) { clearInterval(joinPollTimer); joinPollTimer = null; }
}

function sendJoin({ mode, roomId, worker, team }) {
  const username = getGameUsername();
  api.runtime.sendMessage({
    type: "join",
    roomId,
    mode,
    worker,
    username,
    clanTag: getGameClanTag(),
    team,
    href: location.href,
  })
    .then(() => console.log("[oftc cs] join delivered"))
    .catch((e) => {
      console.error("[oftc cs] join failed", e);
      setStatus(`sendMessage failed: ${e?.message || e}`);
    });
  const teamStr = team ? ` · team ${team}` : "";
  setStatus(`joining ${roomId}${teamStr}…`);
}

let soloNoticeShown = false;
let chatDisabled = false;  // when true, status updates from background are ignored

async function tryJoinGame(info) {
  if (!isHudPresent()) {
    setStatus("waiting for HUD…");
    return false;
  }
  await probeGameState();
  const mode = latestGameState?.mode;
  const gameType = latestGameState?.gameType;

  // Solo game: runs entirely client-side, no server ID to verify → don't try to chat.
  if (gameType === "Singleplayer") {
    setTitle("Chat");
    if (!soloNoticeShown) {
      appendMessage({ system: true, text: "Solo game detected — chat is not available in single-player." });
      soloNoticeShown = true;
    }
    api.runtime.sendMessage({ type: "leave" }).catch(() => {});
    chatDisabled = true;
    setStatus("solo mode — disabled");
    return true; // resolved (as "not eligible")
  }

  if (!mode) { setStatus("waiting for game state…"); return false; }

  if (mode === "Team") {
    setTitle("Team Chat");
    const team = latestGameState.team;
    if (!team) { setStatus("detecting team…"); return false; }
    currentTeam = team;
    sendJoin({ mode: "game", roomId: info.roomId, worker: info.worker, team });
    return true;
  }
  // FFA / any non-team multiplayer — full-room fanout.
  setTitle("Game Chat");
  currentTeam = null;
  sendJoin({ mode: "game", roomId: info.roomId, worker: info.worker, team: null });
  return true;
}

function syncRoom() {
  const info = getRoomInfo();
  const username = getGameUsername();
  console.log("[oftc cs] syncRoom", { href: location.href, info, currentRoom, currentMode, username });

  if (info.mode === null) {
    // Not a recognized route — nothing to do.
    setStatus("idle");
    setTitle("Chat");
    stopPolling();
    return;
  }

  const roomChanged = info.roomId !== currentRoom || info.mode !== currentMode;
  if (roomChanged) {
    if (currentRoom) api.runtime.sendMessage({ type: "leave" }).catch(() => {});
    currentRoom = info.roomId;
    currentMode = info.mode;
    currentTeam = null;
    soloNoticeShown = false;
    chatDisabled = false;
    while (logEl.firstChild) logEl.removeChild(logEl.firstChild);
  }

  if (!username) {
    setStatus("no in-game username");
    appendMessage({ system: true, text: "Set a username in the OpenFront main menu, then reload." });
    stopPolling();
    return;
  }

  stopPolling();

  if (info.mode === "global") {
    setTitle("Global Chat");
    sendJoin({ mode: "global", roomId: info.roomId, worker: null, team: null });
    return;
  }

  // Game mode — poll until HUD is up and (for team games) team is known.
  tryJoinGame(info).then((done) => { if (done) return; });
  joinPollTimer = setInterval(async () => {
    if (await tryJoinGame(info)) stopPolling();
  }, 1500);
}

// SPA navigation — hook history AND poll href as a backstop in case the app
// replaces history.pushState after our content script loads.
["pushState", "replaceState"].forEach((k) => {
  const orig = history[k];
  history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(syncRoom); return r; };
});
window.addEventListener("popstate", syncRoom);

let lastPolledHref = location.href;
setInterval(() => {
  if (location.href !== lastPolledHref) {
    console.log("[oftc cs] href-poll detected navigation", { from: lastPolledHref, to: location.href });
    lastPolledHref = location.href;
    syncRoom();
  }
}, 1500);

// ---- overlay UI -------------------------------------------------------------

// Build the overlay DOM programmatically (no innerHTML) so Firefox lint is
// happy and there is zero risk of injecting untrusted markup.
function el(tag, opts = {}, ...children) {
  const n = document.createElement(tag);
  if (opts.id) n.id = opts.id;
  if (opts.className) n.className = opts.className;
  if (opts.type) n.type = opts.type;
  if (opts.role) n.setAttribute("role", opts.role);
  if (opts.title) n.title = opts.title;
  if (opts.ariaLabel) n.setAttribute("aria-label", opts.ariaLabel);
  if (opts.ariaLive) n.setAttribute("aria-live", opts.ariaLive);
  if (opts.autocomplete) n.autocomplete = opts.autocomplete;
  if (opts.maxLength) n.maxLength = opts.maxLength;
  if (opts.placeholder) n.placeholder = opts.placeholder;
  if (opts.text !== undefined) n.textContent = opts.text;
  for (const c of children) if (c) n.appendChild(c);
  return n;
}

const root = el("div", { id: "oftc-root" });
const panel = el("div", { id: "oftc-panel", className: "oftc-collapsed" });
const header = el("div", { id: "oftc-header" });
const titleEl = el("span", { id: "oftc-title", text: "Chat" });
const statusEl = el("span", { id: "oftc-status", title: "connection status", text: "idle" });
const reconnectBtn = el("button", { id: "oftc-reconnect", type: "button", ariaLabel: "reconnect", title: "reconnect", text: "↻" });
const toggleBtn = el("button", { id: "oftc-toggle", type: "button", ariaLabel: "toggle", text: "▾" });
header.append(titleEl, statusEl, reconnectBtn, toggleBtn);

const logEl = el("div", { id: "oftc-log", role: "log", ariaLive: "polite" });
const form = el("form", { id: "oftc-form" });
const input = el("input", {
  id: "oftc-input", type: "text", maxLength: 2000,
  placeholder: "Enter to send    (message shortcut: V)", autocomplete: "off",
});
form.appendChild(input);

panel.append(header, logEl, form);
root.appendChild(panel);
document.documentElement.appendChild(root);

function setStatus(text) { statusEl.textContent = text; }
function setTitle(text) { titleEl.textContent = text; }
function setCollapsed(collapsed) {
  panel.classList.toggle("oftc-collapsed", collapsed);
  toggleBtn.textContent = "▾";                 // only shown when expanded
  toggleBtn.title = "minimize";
}
// Arrow (visible only when expanded) minimizes.
toggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setCollapsed(true);
});
// Clicking anywhere on the collapsed panel expands it.
panel.addEventListener("click", (e) => {
  if (!panel.classList.contains("oftc-collapsed")) return;
  // Don't intercept clicks on the reconnect/toggle buttons inside the header.
  if (e.target.closest("button")) return;
  setCollapsed(false);
  input.focus();
});

reconnectBtn.addEventListener("click", () => {
  console.log("[oftc cs] manual reconnect");
  appendMessage({ system: true, text: `reconnecting…` });
  currentRoom = null;
  currentMode = null;
  soloNoticeShown = false;
  chatDisabled = false;
  syncRoom();
});

function appendMessage({ nickname, text, self, system, ts }) {
  const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const who = system ? "•" : (nickname || "anon");
  const row = el("div", {
    className: "oftc-row" + (self ? " oftc-self" : "") + (system ? " oftc-system" : ""),
  },
    el("span", { className: "oftc-time", text: time }),
    el("span", { className: "oftc-who", text: who }),
    el("span", { className: "oftc-text", text: text }),
  );
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 50) logEl.removeChild(logEl.firstChild);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const info = getRoomInfo();
  if (info.mode === null) {
    appendMessage({ system: true, text: "Cannot send: unrecognized page." });
    return;
  }
  const username = getGameUsername();
  if (!username) {
    appendMessage({ system: true, text: "Cannot send: no username in OpenFront settings." });
    return;
  }
  // In game mode, refresh state to keep team fresh if it just resolved.
  let team = null;
  if (info.mode === "game") {
    await probeGameState();
    if (latestGameState?.mode === "Team") {
      team = latestGameState.team || currentTeam;
      if (!team) {
        appendMessage({ system: true, text: "Cannot send: team not yet detected." });
        return;
      }
    }
  }
  api.runtime.sendMessage({
    type: "send",
    text,
    username,
    clanTag: getGameClanTag(),
    team,
    mode: info.mode,
    worker: info.worker,
    href: location.href,
    hudPresent: info.mode === "game" ? isHudPresent() : false,
  });
  input.value = "";
});

// Hotkey: V focuses the input (T is used by the game).
window.addEventListener("keydown", (e) => {
  if (e.key !== "v" && e.key !== "V") return;
  const t = e.target;
  const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  setCollapsed(false);
  input.focus();
});
input.addEventListener("keydown", (e) => { if (e.key === "Escape") input.blur(); });

// Refresh team every 5s (only matters in team games).
setInterval(async () => {
  if (currentMode === "game") {
    await probeGameState();
    const t = latestGameState?.team;
    if (t && t !== currentTeam) currentTeam = t;
  }
}, 5000);

// ---- background messages ----------------------------------------------------

api.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") {
    // Don't let stale WS close events overwrite "solo mode — disabled".
    if (chatDisabled) return;
    if (msg.status === "open") {
      const suffix = currentTeam ? ` · team ${currentTeam}` : "";
      setStatus(`connected${suffix}`);
    } else if (msg.status === "connecting") {
      setStatus("connecting…");
    } else if (msg.status === "closed") {
      setStatus(`closed (${msg.code || "?"})`);
      // Don't spam the log on transient close events — retries happen silently.
    } else if (msg.status === "error") {
      setStatus("error");
      // Same: silent in the log; the retry-cap event surfaces the real message.
    } else if (msg.status === "gave-up") {
      setStatus("disconnected");
      appendMessage({ system: true, text: msg.reason || "cannot connect — click ↻ to try again" });
    }
  } else if (msg.type === "incoming") {
    const p = msg.payload || {};
    if (p.type === "chat") appendMessage({ nickname: p.nickname, text: p.text, ts: p.ts });
    else if (p.type === "system" || p.type === "hello-ack") appendMessage({ system: true, text: p.text || JSON.stringify(p) });
  }
});

// ---- kick off ---------------------------------------------------------------

console.log("[oftc cs] content script loaded on", location.href);
setCollapsed(false);
syncRoom();
