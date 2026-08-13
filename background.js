// Background service worker (Chrome) / event page (Firefox).
// Owns the WebSocket. Runs outside the page's CSP.
// One socket per (tab, room). Content scripts talk to it via chrome.runtime messages.

if (typeof importScripts === "function") importScripts("config.js");

const api = typeof browser !== "undefined" ? browser : chrome;

// tabId -> { ws, roomId, reconnectTimer, backoff, identity }
const sessions = new Map();

function getSettings() {
  return { wsUrl: OFTC_CONFIG.wsUrl, secret: OFTC_CONFIG.secret };
}

function closeSession(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
  if (s.heartbeatTimer) clearInterval(s.heartbeatTimer);
  if (s.ws && s.ws.readyState <= 1) {
    try { s.ws.close(1000, "tab left"); } catch (_) {}
  }
  sessions.delete(tabId);
}

function startHeartbeat(session) {
  if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
  session.lastPongTs = Date.now();
  session.heartbeatTimer = setInterval(() => {
    if (!session.ws || session.ws.readyState !== 1) return;
    // Force reconnect if no pong seen recently — connection is likely dead.
    if (Date.now() - session.lastPongTs > PONG_TIMEOUT_MS) {
      console.warn("[oftc bg] pong timeout — forcing reconnect");
      try { session.ws.close(4000, "pong timeout"); } catch (_) {}
      return;
    }
    try { session.ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); }
    catch (_) {}
  }, HEARTBEAT_MS);
}

function sendToTab(tabId, msg) {
  api.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab probably gone. Clean up.
    closeSession(tabId);
  });
}

const MAX_RECONNECT_ATTEMPTS = 10;   // for genuine network hiccups
const HEARTBEAT_MS = 30_000;          // app-level ping cadence
const PONG_TIMEOUT_MS = 60_000;       // if no pong within this, force reconnect

// Close codes we treat as permanent (don't retry — user must click ↻).
const PERMANENT_CLOSE_CODES = new Set([
  1000, // normal (we sent leave)
  1008, // policy: "game not found", "unauthorized", "no worker", "room full"
]);

async function connect(tabId, roomId, identity, opts) {
  opts = opts || {};
  const existing = sessions.get(tabId);
  if (existing && existing.roomId === roomId && existing.ws && existing.ws.readyState === 1) {
    // Already connected to this room, just refresh identity and tell content.
    if (identity) existing.identity = identity;
    sendToTab(tabId, { type: "status", status: "open" });
    return;
  }
  // Preserve the retry counter across scheduled reconnects; reset on fresh join.
  const preservedAttempts = opts.preserveAttempts && existing ? existing.reconnectAttempts : 0;
  if (existing) closeSession(tabId);

  const { wsUrl, secret } = getSettings();
  if (!wsUrl) {
    sendToTab(tabId, { type: "status", status: "error", error: "No WS URL configured." });
    return;
  }

  const session = {
    ws: null, roomId, reconnectTimer: null,
    backoff: 1000,
    reconnectAttempts: preservedAttempts,
    wsUrl,
    identity: identity || {},
  };
  sessions.set(tabId, session);

  const qs = secret ? `?key=${encodeURIComponent(secret)}` : "";
  const url = `${wsUrl.replace(/\/$/, "")}/room/${encodeURIComponent(roomId)}${qs}`;
  console.log("[oftc] connecting", { tabId, url });
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("[oftc] WebSocket constructor threw", err);
    sendToTab(tabId, { type: "status", status: "error", error: `constructor: ${String(err)}` });
    scheduleReconnect(tabId);
    return;
  }
  session.ws = ws;

  sendToTab(tabId, { type: "status", status: "connecting", url });

  ws.addEventListener("open", () => {
    session.backoff = 1000;
    session.reconnectAttempts = 0;
    sendToTab(tabId, { type: "status", status: "open" });
    // Team comes from scraped HUD (<team-stats>), never a user setting.
    ws.send(JSON.stringify({
      type: "hello",
      room: roomId,
      mode: session.identity.mode || null,
      worker: session.identity.worker || null,
      nickname: session.identity.username || "anon",
      clanTag: session.identity.clanTag || null,
      team: session.identity.team || null,
      href: session.identity.href || null,
      ts: Date.now(),
    }));
    startHeartbeat(session);
  });

  ws.addEventListener("message", (evt) => {
    let payload;
    try { payload = JSON.parse(evt.data); }
    catch (e) { payload = { type: "raw", text: String(evt.data) }; }
    // Intercept app-level pong to keep the connection considered alive.
    if (payload && payload.type === "pong") {
      session.lastPongTs = Date.now();
      return;
    }
    sendToTab(tabId, { type: "incoming", payload });
  });

  ws.addEventListener("close", (evt) => {
    console.log("[oftc] close", { code: evt.code, reason: evt.reason, wasClean: evt.wasClean, url });
    if (session.heartbeatTimer) { clearInterval(session.heartbeatTimer); session.heartbeatTimer = null; }
    let reason = evt.reason;
    if (!reason) {
      if (evt.code === 1015) reason = `TLS handshake failed — Firefox HTTPS-Only Mode probably upgraded ws:// to wss://. Disable HTTPS-Only Mode for openfront.io or use wss:// with a real cert.`;
      else if (evt.code === 1006) reason = `connection dropped (${url})`;
      else if (evt.code === 4000) reason = `heartbeat timed out — reconnecting`;
      else reason = `closed (${url})`;
    }
    sendToTab(tabId, { type: "status", status: "closed", code: evt.code, reason });

    if (sessions.get(tabId) !== session) return;
    // Server-sent permanent close (like 1008 "game not found") → give up immediately.
    if (PERMANENT_CLOSE_CODES.has(evt.code) && evt.code !== 4000) {
      console.log("[oftc bg] permanent close code", evt.code, "— not reconnecting");
      sendToTab(tabId, {
        type: "status", status: "gave-up", attempts: 0,
        reason: reason || `closed (${evt.code})`,
      });
      return;
    }
    scheduleReconnect(tabId);
  });

  ws.addEventListener("error", (evt) => {
    console.error("[oftc] ws error event", evt, "url=", url);
    sendToTab(tabId, { type: "status", status: "error", error: `WS error connecting to ${url}` });
    // close will fire next with a code.
  });
}

function scheduleReconnect(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.reconnectAttempts = (s.reconnectAttempts || 0) + 1;
  if (s.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.warn("[oftc bg] giving up after", s.reconnectAttempts, "attempts");
    sendToTab(tabId, {
      type: "status", status: "gave-up",
      attempts: s.reconnectAttempts,
      reason: "cannot connect — click ↻ to try again",
    });
    return;
  }
  const delay = Math.min(s.backoff, 15000);
  s.backoff = Math.min(s.backoff * 2, 15000);
  const identity = s.identity;
  const roomId = s.roomId;
  s.reconnectTimer = setTimeout(
    () => connect(tabId, roomId, identity, { preserveAttempts: true }),
    delay
  );
}

async function sendChat(tabId, text, identity) {
  const s = sessions.get(tabId);
  if (!s || !s.ws || s.ws.readyState !== 1) {
    sendToTab(tabId, { type: "status", status: "error", error: "Not connected" });
    return;
  }
  if (identity) s.identity = { ...s.identity, ...identity };
  const msg = {
    type: "chat",
    room: s.roomId,
    mode: s.identity.mode || null,
    worker: s.identity.worker || null,
    nickname: s.identity.username || "anon",
    clanTag: s.identity.clanTag || null,
    team: s.identity.team || null,
    href: s.identity.href || null,
    hudPresent: !!s.identity.hudPresent,
    text: String(text).slice(0, 2000),
    ts: Date.now(),
  };
  s.ws.send(JSON.stringify(msg));
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  console.log("[oftc bg] onMessage", { type: msg?.type, tabId, msg });
  if (!tabId && msg.type !== "settings-updated") {
    console.warn("[oftc bg] ignoring message without tabId", msg);
    return;
  }

  (async () => {
    switch (msg.type) {
      case "join":
        console.log("[oftc bg] join request", { tabId, roomId: msg.roomId, mode: msg.mode, worker: msg.worker, username: msg.username, team: msg.team });
        await connect(tabId, msg.roomId, {
          mode: msg.mode,
          worker: msg.worker,
          username: msg.username,
          clanTag: msg.clanTag,
          team: msg.team,
          href: msg.href,
        });
        break;
      case "leave":
        closeSession(tabId);
        sendToTab(tabId, { type: "status", status: "closed", code: 1000, reason: "left" });
        break;
      case "send":
        console.log("[oftc bg] send request", { tabId, hasSession: sessions.has(tabId), username: msg.username, team: msg.team, mode: msg.mode });
        await sendChat(tabId, msg.text, {
          mode: msg.mode,
          worker: msg.worker,
          username: msg.username,
          clanTag: msg.clanTag,
          team: msg.team,
          href: msg.href,
          hudPresent: msg.hudPresent,
        });
        break;
      case "settings-updated":
        console.log("[oftc bg] settings-updated, reconnecting all", [...sessions.keys()]);
        for (const [tid, s] of sessions.entries()) {
          const roomId = s.roomId;
          const identity = s.identity;
          closeSession(tid);
          connect(tid, roomId, identity);
        }
        break;
      default:
        console.warn("[oftc bg] unknown message type", msg.type);
    }
  })();

  return false;
});

console.log("[oftc bg] background loaded");

api.tabs.onRemoved.addListener((tabId) => closeSession(tabId));

// Read game state from the page's main world. Content scripts can't see
// Lit properties set on custom elements (game view is stored on
// <team-stats>.game / <player-stats>.game / <game-left-sidebar>.game),
// so we execute a probe in world:"MAIN" and return the result.
async function probeGameState(tabId) {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        function callSafely(fn) {
          try { return typeof fn === "function" ? fn() : null; } catch (e) { return null; }
        }
        function tryGet(el) {
          if (!el) return null;
          var g = el.game;
          if (!g) return null;
          var team = null, mode = null, gameType = null, alive = null, id = null, humanName = null;
          var mp = callSafely(g.myPlayer && g.myPlayer.bind(g));
          if (mp) {
            team = callSafely(mp.team && mp.team.bind(mp));
            alive = callSafely(mp.isAlive && mp.isAlive.bind(mp));
            humanName = callSafely(mp.name && mp.name.bind(mp));
          }
          var cfg = callSafely(g.config && g.config.bind(g));
          if (cfg) {
            var gcfg = callSafely(cfg.gameConfig && cfg.gameConfig.bind(cfg));
            if (gcfg) {
              if (gcfg.gameMode) mode = gcfg.gameMode;
              if (gcfg.gameType) gameType = gcfg.gameType;
            }
          }
          id = callSafely(g.gameID && g.gameID.bind(g));
          return { team: team, mode: mode, gameType: gameType, alive: alive, id: id, humanName: humanName };
        }
        var els = [
          document.querySelector("game-left-sidebar"),
          document.querySelector("team-stats"),
          document.querySelector("player-stats"),
          document.querySelector("control-panel"),
          document.querySelector("leaderboard-player-list"),
        ];
        for (var i = 0; i < els.length; i++) {
          var s = tryGet(els[i]);
          if (s && (s.mode || s.team || s.id || s.gameType)) {
            var tag = els[i].tagName ? els[i].tagName.toLowerCase() : null;
            return { ok: true, sourceTag: tag, team: s.team, mode: s.mode, gameType: s.gameType, alive: s.alive, id: s.id, humanName: s.humanName };
          }
        }
        return { ok: false, reason: "no element with .game property found" };
      },
    });
    const first = results && results[0];
    return (first && first.result) || { ok: false, reason: "no result" };
  } catch (e) {
    console.warn("[oftc bg] probeGameState failed", e);
    return { ok: false, reason: String(e) };
  }
}

// Additional handler in the message listener above.
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "probe-game-state") return false;
  const tabId = sender.tab?.id;
  if (!tabId) return false;
  probeGameState(tabId).then((state) => {
    sendResponse(state);
  });
  return true; // keep the channel open for async sendResponse
});
