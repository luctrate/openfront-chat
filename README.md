# OpenFront Chat (Community)

Community chat for [openfront.io](https://openfront.io) players. Adds a small chat panel that appears on the site — Global Chat in the lobby / on the main page, Team Chat in team matches, Game Chat in FFA. Solo games are detected and chat stays off.

Works in Chrome (MV3 service worker) and Firefox (MV3 event page). Talks to a small Node/WebSocket relay you run yourself.

## Layout

```
manifest.chrome.json          prod, Chrome MV3     wss://relay.asp.now
manifest.firefox.json         prod, Firefox MV3    wss://relay.asp.now
manifest.dev-chrome.json      dev,  Chrome MV3     ws://localhost:8080
manifest.dev-firefox.json     dev,  Firefox MV3    ws://localhost:8080
config.prod.js                relay URL + baked secret (prod)
config.dev.js                 relay URL + empty secret (dev, localhost)
config.js                     active copy (chosen by use.sh)
manifest.json                 active copy (chosen by use.sh)

background.js                 service worker / event page — owns the WebSocket
content.js / content.css      injected overlay + game-state probe glue
popup.html / popup.js         read-only info popup

icons/*.png                   16/32/48/128 PNGs rasterised from source.svg
relay-example/server.js       Node relay (WS + team-scoped fanout + API verify)
deploy/k8s/                   k3s manifests + build/apply script for the relay
scripts/build-store.sh        packages Chrome + Firefox zips for store upload
```

## Load unpacked

Pick the target with `use.sh` (swaps `manifest.json` and `config.js` in one shot):

```bash
./use.sh chrome        # prod Chrome
./use.sh firefox       # prod Firefox
./use.sh dev-chrome    # local dev (Chrome) — points at ws://localhost:8080
./use.sh dev-firefox   # local dev (Firefox)
```

### Chrome
`chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder. Click ↻ to reload after changes.

### Firefox (temporary install)
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json`. Removed on Firefox restart. For persistent install: package + sign at addons.mozilla.org — see [PUBLISH.md](./PUBLISH.md).

## What the extension does

- **Global Chat** (main page, `openfront.io/`) — anyone with the extension can chat, no verification.
- **Team Chat** (team-mode games) — auto-joins the current game's team channel; only teammates see messages.
- **Game Chat** (FFA / non-team multiplayer) — everyone in the specific game shares one channel.
- **Solo** (single-player) — detected via the game's `gameType`; chat stays disabled with a system notice.

Nickname is read from OpenFront's own `localStorage["username"]`. Team is scraped from the running game's Lit-managed HUD via a `world:"MAIN"` probe. No settings screen; no separate account.

Hotkey **V** focuses the chat input. Click the collapsed panel to expand; arrow to minimise.

## Relay

The relay is a tiny Node/`ws` server. Source: `relay-example/server.js`.

Local test:
```bash
cd relay-example && npm install && node server.js
# extension: ./use.sh dev-chrome (or dev-firefox), then reload
```

Production deployment onto k3s: `./deploy/k8s/deploy.sh`. Details in `deploy/k8s/`.

### Wire format

```
client → server  {type:"hello",  room, mode, worker, nickname, team, ...}
client → server  {type:"chat",   text, ...}
client → server  {type:"ping",   ts}     # app-level heartbeat every 30s
server → client  {type:"pong",   ts}
server → client  {type:"chat",   nickname, team, text, ts}
server → client  {type:"system", text}
```

Rate limits (server env-configurable): `MSG_PER_SEC=1`, `MSG_BURST=3`, `MSG_PER_MIN=10`, `CONN_PER_MIN_PER_IP=20`. Room caps: `MAX_ROOM_SIZE=12` (games), `GLOBAL_MAX_ROOM_SIZE=200`.

Access control (relay side):
- **Origin allowlist**: `ALLOWED_ORIGINS` — comma-separated list of extension origins (`chrome-extension://<id>`, `moz-extension://`). Empty = dev mode (any origin).
- **Shared secret**: `SHARED_SECRET` — clients must pass `?key=<secret>` on the WS URL. Baked into `config.prod.js`.
- **Game verification**: relay hits `openfront.io/wN/api/game/<id>/exists` before opening a game room. Cached (6h positive, 60s negative). Deduped across concurrent joiners.

## Docs

- [PUBLISH.md](./PUBLISH.md) — Chrome Web Store + Firefox Add-ons walkthrough.
- [PRIVACY.md](./PRIVACY.md) — privacy policy (host at an https URL for store submission).
- [STORE-LISTING.md](./STORE-LISTING.md) — copy for the store forms.

## Rotate the shared secret

```bash
./scripts/rotate-secret.sh
./use.sh chrome     # (or firefox) — rebuilds config.prod.js from the new .env
# then reload the extension in the browser
```

`rotate-secret.sh` reads GCP target details (project, instance, zone) from `.env`, deletes and recreates the `relay-secret` Kubernetes Secret with a fresh random value, restarts the relay pod, and writes the new value back into your local `.env`.
