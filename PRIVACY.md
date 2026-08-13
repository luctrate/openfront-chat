# OpenFront Chat (Community) — Privacy Policy

_Effective: 2026-08-13_

OpenFront Chat (Community) ("the extension") is a browser add-on that adds a free-text chat overlay to games on [openfront.io](https://openfront.io). This document describes the data the extension reads, transmits, and stores.

## Data the extension reads from your browser

- **In-game username** — read from `localStorage["username"]` set by OpenFront itself. Used as the chat display name.
- **Clan tag** (optional) — read from `localStorage["clanTag"]` set by OpenFront itself. Displayed alongside the username if present.
- **Current URL** — the extension inspects the tab URL to detect the current game (worker + game ID) and select the correct chat room.
- **In-game state** — a probe reads the OpenFront game view (game mode, your team, single-player flag) from the page's JavaScript context. This runs only on `openfront.io` and only to decide whether/how to connect a chat room.

## Data the extension transmits

Chat messages travel over a WebSocket to a relay server operated by the extension's author (`wss://relay.asp.now`). Each message carries:

- Your in-game username and optional clan tag
- Your assigned team (in team games) or `null` (in FFA / global)
- Your typed message text
- The game URL, so the relay can verify the game exists via the public OpenFront API
- The room you are chatting in (game ID or `__global__` for the main page)

**The relay does not persist chat messages.** Messages exist only in the memory of connected recipients and disappear the moment the socket closes.

The relay is only reachable over TLS (`wss://`). See [PUBLISH.md](./PUBLISH.md) for deployment details.

## Data the extension stores

- **Extension configuration** — the relay URL and shared secret are baked into the extension bundle at build time. Nothing is stored in `chrome.storage` or `localStorage` outside what OpenFront itself already stores.
- **Chat history** — kept only in the visible chat overlay of your browser tab (capped at 500 messages) and cleared on tab close or room change.

## Third parties

The extension talks to:
- **openfront.io** (the game host) — the page you are already on.
- **openfront.io game-verification API** — the relay queries `openfront.io/wN/api/game/<id>/exists` to confirm a game ID is real before opening a room. No personal data is sent in this request beyond the game ID.

No analytics, tracking pixels, or advertising SDKs are included.

## Contact

Questions or concerns: open an issue at **https://github.com/luctrate/openfront-chat/issues**.

## Changes

Material changes to this policy will bump the extension version and update the "Effective" date above.
