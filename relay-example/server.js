// OpenFront team-chat relay.
//   npm i && node server.js   (requires Node 18+ for global fetch)
//
// Env vars:
//   PORT                 default 8080
//   ALLOWED_ORIGINS      comma-separated list of Origin values allowed to connect.
//                        Supports exact matches and prefix patterns (e.g.
//                        "chrome-extension://abcdef..., moz-extension://").
//                        Empty = allow any origin (dev mode).
//   SHARED_SECRET        if set, clients must send it as ?key=<secret>. Empty = off.
//   MAX_ROOM_SIZE        default 12  (game rooms)
//   GLOBAL_MAX_ROOM_SIZE default 200 (lobby / non-game room)
//   MSG_PER_SEC          per-connection message rate limit, default 1
//   MSG_BURST            per-connection burst allowance, default 3
//   MSG_PER_MIN          per-connection sliding-window minute cap, default 10
//   CONN_PER_MIN_PER_IP  default 20
//   FAIL_OPEN_ON_API_ERR "1" to allow when OpenFront API errors, default 0 (closed)

import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
const SHARED_SECRET = process.env.SHARED_SECRET || "";
const MAX_ROOM_SIZE = Number(process.env.MAX_ROOM_SIZE || 12);
const GLOBAL_MAX_ROOM_SIZE = Number(process.env.GLOBAL_MAX_ROOM_SIZE || 200);
const GLOBAL_ROOM = "__global__";
const MSG_PER_SEC = Number(process.env.MSG_PER_SEC || 1);
const MSG_BURST = Number(process.env.MSG_BURST || 3);
const MSG_PER_MIN = Number(process.env.MSG_PER_MIN || 10);
const CONN_PER_MIN_PER_IP = Number(process.env.CONN_PER_MIN_PER_IP || 20);
const FAIL_OPEN_ON_API_ERR = process.env.FAIL_OPEN_ON_API_ERR === "1";

// ---- state -----------------------------------------------------------------

const rooms = new Map();          // roomId -> Set<ws>
const verifiedRooms = new Map();  // roomId -> { ok, ts }
const inFlight = new Map();       // roomId -> Promise<boolean>
const ipConns = new Map();        // ip -> [connectTs, ...] (sliding window)

const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 60 * 1000;
const IP_WINDOW_MS = 60_000;

// ---- helpers ---------------------------------------------------------------

function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true; // dev-mode
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(entry =>
    entry.endsWith("/") || entry.endsWith("://")
      ? origin.startsWith(entry)                // prefix match
      : origin === entry                        // exact match
  );
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function checkIpRate(ip) {
  const now = Date.now();
  let arr = ipConns.get(ip) || [];
  arr = arr.filter(ts => now - ts < IP_WINDOW_MS);
  if (arr.length >= CONN_PER_MIN_PER_IP) { ipConns.set(ip, arr); return false; }
  arr.push(now);
  ipConns.set(ip, arr);
  return true;
}

function joinRoom(roomId, ws) {
  let set = rooms.get(roomId);
  if (!set) { set = new Set(); rooms.set(roomId, set); }
  set.add(ws);
  ws._roomId = roomId;
}

function leaveRoom(ws) {
  const set = rooms.get(ws._roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(ws._roomId);
}

function broadcastTeam(roomId, team, msg, except) {
  const set = rooms.get(roomId);
  if (!set) return 0;
  const data = JSON.stringify(msg);
  let sent = 0;
  for (const client of set) {
    if (client === except) continue;
    if (client.readyState !== 1) continue;
    if (team !== null && client._team !== team) continue;
    client.send(data);
    sent++;
  }
  return sent;
}

function extractWorker(href) {
  try {
    const u = new URL(href);
    if (!/(^|\.)openfront\.io$/.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 3 && parts[1] === "game" && /^w\d+$/.test(parts[0])) return parts[0];
    return null;
  } catch { return null; }
}

async function verifyGame(roomId, worker) {
  const cached = verifiedRooms.get(roomId);
  if (cached) {
    const ttl = cached.ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.ok;
  }
  if (inFlight.has(roomId)) return inFlight.get(roomId);

  const promise = (async () => {
    if (!worker) return false;
    const url = `https://openfront.io/${worker}/api/game/${encodeURIComponent(roomId)}/exists`;
    try {
      const res = await fetch(url, { headers: { "user-agent": "openfront-team-chat-relay" } });
      if (!res.ok) {
        console.warn(`[relay] verify HTTP ${res.status} for ${url}`);
        return FAIL_OPEN_ON_API_ERR;
      }
      const body = await res.json();
      const ok = body && body.exists === true;
      verifiedRooms.set(roomId, { ok, ts: Date.now() });
      console.log(`[relay] verified ${roomId} via ${worker}: ${ok}`);
      return ok;
    } catch (err) {
      console.warn(`[relay] verify failed for ${roomId}:`, err.message);
      return FAIL_OPEN_ON_API_ERR;
    } finally {
      inFlight.delete(roomId);
    }
  })();

  inFlight.set(roomId, promise);
  return promise;
}

// Per-socket rate limiter: token bucket for short-term burst control, plus a
// sliding one-minute window to discourage sustained spamming.
function makeLimiter() {
  return { tokens: MSG_BURST, last: Date.now(), minuteHits: [] };
}
function consumeToken(lim) {
  const now = Date.now();
  const refill = ((now - lim.last) / 1000) * MSG_PER_SEC;
  lim.tokens = Math.min(MSG_BURST, lim.tokens + refill);
  lim.last = now;
  if (lim.tokens < 1) return { ok: false, reason: `too fast — max ${MSG_PER_SEC}/s (burst ${MSG_BURST})` };

  lim.minuteHits = lim.minuteHits.filter(t => now - t < 60_000);
  if (lim.minuteHits.length >= MSG_PER_MIN) {
    return { ok: false, reason: `too many messages — max ${MSG_PER_MIN}/min` };
  }

  lim.tokens -= 1;
  lim.minuteHits.push(now);
  return { ok: true };
}

// ---- server ----------------------------------------------------------------

// verifyClient runs at handshake time. Reject early → no upgrade, no socket.
const wss = new WebSocketServer({
  port: PORT,
  verifyClient: (info, cb) => {
    const { origin } = info;
    if (!originAllowed(origin)) {
      console.warn(`[relay] rejected origin: ${origin}`);
      return cb(false, 403, "forbidden origin");
    }
    const ip = clientIp(info.req);
    if (!checkIpRate(ip)) {
      console.warn(`[relay] rate-limited ip: ${ip}`);
      return cb(false, 429, "rate limit");
    }
    if (SHARED_SECRET) {
      const u = new URL(info.req.url, "http://localhost");
      const key = u.searchParams.get("key") || "";
      if (key !== SHARED_SECRET) {
        console.warn(`[relay] bad secret from ${ip}`);
        return cb(false, 401, "unauthorized");
      }
    }
    cb(true);
  },
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const m = url.pathname.match(/^\/room\/([^/]+)/);
  const roomId = m ? decodeURIComponent(m[1]) : null;
  if (!roomId) { ws.close(1008, "missing room"); return; }

  // Enforce per-room size cap (different cap for global vs game rooms).
  const existing = rooms.get(roomId);
  const cap = roomId === GLOBAL_ROOM ? GLOBAL_MAX_ROOM_SIZE : MAX_ROOM_SIZE;
  if (existing && existing.size >= cap) {
    ws.send(JSON.stringify({ type: "system", text: `room full (max ${cap})` }));
    ws.close(1008, "room full");
    return;
  }

  joinRoom(roomId, ws);
  ws._team = null;
  ws._nickname = "anon";
  ws._verified = false;
  ws._limiter = makeLimiter();
  ws._ip = clientIp(req);
  ws._isGlobal = roomId === GLOBAL_ROOM;
  ws._isAlive = true;
  ws.on("pong", () => { ws._isAlive = true; });

  const greeting = ws._isGlobal
    ? `joined Global Chat`
    : `joined room ${roomId}`;
  ws.send(JSON.stringify({ type: "system", text: greeting }));

  ws.on("message", async (buf) => {
    // Cheap message-size cap.
    if (buf.length > 4096) {
      ws.send(JSON.stringify({ type: "system", text: "message too large" }));
      return;
    }

    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    // App-level heartbeat: browser JS can't observe WS-level pongs, so the
    // extension sends {type:"ping"} and we echo {type:"pong"}.
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", ts: msg.ts }));
      ws._isAlive = true;
      return;
    }

    // Rate-limit only chat messages (hello etc. are protocol overhead).
    if (msg.type === "chat") {
      const gate = consumeToken(ws._limiter);
      if (!gate.ok) {
        ws.send(JSON.stringify({ type: "system", text: gate.reason }));
        return;
      }
    }

    if (msg.type === "hello") {
      const team = msg.team ? String(msg.team) : null;
      const nickname = String(msg.nickname || "anon").slice(0, 40);
      const href = msg.href ? String(msg.href) : "";
      // Prefer explicit worker from client, fall back to href parsing.
      const worker = (msg.worker && /^w\d+$/.test(msg.worker)) ? msg.worker : extractWorker(href);

      ws._team = team;
      ws._nickname = nickname;

      // Global room: no API verification, no team scoping.
      if (ws._isGlobal) {
        ws._verified = true;
        ws._team = null;
        broadcastTeam(roomId, null, {
          type: "system",
          text: `${nickname} joined Global Chat`,
        }, ws);
        ws.send(JSON.stringify({
          type: "system",
          text: `you are in Global Chat — everyone in this room sees your messages`,
        }));
        return;
      }

      // Game room: verify the game exists via the OpenFront API. Skip if the
      // room already has other verified members (they verified when it opened).
      let ok = rooms.get(roomId) && rooms.get(roomId).size > 1;
      if (!ok) {
        if (!worker) {
          ws.send(JSON.stringify({ type: "system", text: "cannot verify game: no worker" }));
          ws.close(1008, "no worker"); return;
        }
        ok = await verifyGame(roomId, worker);
      }
      if (!ok) {
        ws.send(JSON.stringify({ type: "system", text: `game ${roomId} does not exist on ${worker}` }));
        ws.close(1008, "game not found"); return;
      }
      ws._verified = true;

      if (team) {
        // Team game: team-scoped fanout, notice only within team.
        broadcastTeam(roomId, team, {
          type: "system",
          text: `${nickname} joined team ${team}`,
        }, ws);
        ws.send(JSON.stringify({
          type: "system",
          text: `you are on team ${team} — messages visible only to your team`,
        }));
      } else {
        // FFA / non-team game: full-room fanout.
        broadcastTeam(roomId, null, {
          type: "system",
          text: `${nickname} joined the game chat`,
        }, ws);
        ws.send(JSON.stringify({
          type: "system",
          text: `you are in Game Chat — everyone in this game sees your messages`,
        }));
      }
      return;
    }

    if (msg.type === "chat" && typeof msg.text === "string") {
      if (!ws._verified) return void ws.send(JSON.stringify({ type: "system", text: "message dropped: not verified" }));
      // Reject if client claims a different team than what we recorded at hello time.
      if (ws._team && msg.team && msg.team !== ws._team) {
        return void ws.send(JSON.stringify({ type: "system", text: `message dropped: team mismatch (${msg.team} vs ${ws._team})` }));
      }
      // If ws._team is null → full-room fanout (global or FFA).
      // If ws._team is set → team-scoped fanout.
      broadcastTeam(roomId, ws._team, {
        type: "chat",
        nickname: ws._nickname,
        team: ws._team,
        text: msg.text.slice(0, 2000),
        ts: Date.now(),
      });
      return;
    }
  });

  ws.on("close", () => {
    if (ws._verified && ws._roomId) {
      const noticeScope = ws._team; // null for global/FFA → whole room
      const where = ws._isGlobal
        ? "Global Chat"
        : ws._team ? `team ${ws._team}` : "the game chat";
      broadcastTeam(ws._roomId, noticeScope, {
        type: "system",
        text: `${ws._nickname} left ${where}`,
      }, ws);
    }
    leaveRoom(ws);
  });
});

// WS-level heartbeat: ping each client every 30s, drop those who miss a pong.
const HEARTBEAT_MS = 30_000;
setInterval(() => {
  for (const set of rooms.values()) {
    for (const ws of set) {
      if (ws.readyState !== 1) continue;
      if (ws._isAlive === false) {
        console.log("[relay] dropping dead socket:", ws._nickname || "?", ws._roomId);
        try { ws.terminate(); } catch (_) {}
        continue;
      }
      ws._isAlive = false;
      try { ws.ping(); } catch (_) {}
    }
  }
}, HEARTBEAT_MS).unref?.();

console.log(`relay listening on ws://localhost:${PORT}`);
console.log(`  origins:   ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(", ") : "* (dev)"}`);
console.log(`  secret:    ${SHARED_SECRET ? "required" : "off"}`);
console.log(`  limits:    game-room<=${MAX_ROOM_SIZE}, global-room<=${GLOBAL_MAX_ROOM_SIZE}, ${MSG_PER_SEC} msg/s (burst ${MSG_BURST}), ${MSG_PER_MIN} msg/min, ${CONN_PER_MIN_PER_IP} conn/min/ip`);
console.log(`  heartbeat: ${HEARTBEAT_MS / 1000}s`);
