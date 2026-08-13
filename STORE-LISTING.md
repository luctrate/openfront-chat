# Store listing copy

Reference text for Chrome Web Store and Firefox Add-ons submissions.

## Name
`OpenFront Chat (Community)`

## Short summary (≤ 132 chars — Chrome uses ≤ 132; Firefox ≤ 250)
`Free-text team chat overlay for OpenFront.io — coordinate with your teammates without leaving the browser.`

## Category
Chrome Web Store: **Communication**
Firefox Add-ons: **Other**

## Detailed description (~500–1000 chars)

```
OpenFront Chat (Community) adds a free-text chat window to matches on openfront.io. The
built-in emoji and quick-chat are limited; this extension lets teammates type
proper sentences to coordinate strategy — the equivalent of team voice chat, but
without needing Discord or a mic.

How it works
- On the main page, you land in Global Chat where anyone with the extension can
  say hi and organise a match.
- In a team match, you are auto-joined into a private team channel — only your
  teammates see your messages.
- In FFA / multiplayer games without teams, everyone in that specific game
  shares one chat.
- Solo (single-player) games are detected and chat stays off.

The chat panel sits in the corner of the game and can be minimised. Press V to
focus the input. Press Escape to blur. Nickname and team come from your existing
OpenFront settings; no separate account or sign-up.

Privacy
- No chat history is stored on the server; messages exist only in the memory
  of connected clients.
- No analytics, no ads, no tracking.
- See our privacy policy for details.

Community project — not affiliated with, endorsed by, or maintained by the OpenFront.io team.
```

## Screenshots to prepare (1280×800 or 640×400)

Chrome requires at least one; up to five. Firefox lets you upload multiple.

1. Chat panel in an active team game, showing a few messages and the "connected · team Red" status.
2. Same but collapsed, showing how compact it is.
3. Global Chat on the openfront.io landing page.
4. Popup showing the baked relay URL + masked secret.
5. (Optional) In-game Team Chat with the panel open near the bottom-right of the map.

## Promotional images (Chrome only, optional)

- Small promo tile: 440×280 PNG
- Marquee (only for featured listings): 1400×560

Skip these for a beta / unlisted release.

## Support URL
`https://github.com/luctrate/openfront-chat`

## Homepage URL
`https://github.com/luctrate/openfront-chat`

## Privacy Policy URL
Publish `PRIVACY.md` at a stable URL, e.g. `https://asp.now/openfront-team-chat/privacy`.
The store submission form requires an https:// URL, not a local file.

## Permissions justification (Chrome requires per-permission rationale)

| Permission | Why it's needed |
|---|---|
| `storage` | Reserved for future user preferences; currently unused at runtime. |
| `activeTab` | Interact with the active openfront.io tab (opening the chat overlay). |
| `scripting` | Execute a small probe in the page's main world to read the game state (team, mode, single-player flag) from Lit-managed custom elements — content scripts can't read those directly. |
| `host_permissions` for openfront.io | Inject the chat overlay only on openfront.io. |
| `host_permissions` for wss://relay.asp.now | Open the WebSocket to the chat relay. |

Everything else is scoped to those two hosts.
