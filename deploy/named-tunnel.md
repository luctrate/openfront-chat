# Named Cloudflare Tunnel (persistent URL)

The quick tunnel is fine for testing but its URL rotates every restart. For a stable `wss://relay.yourdomain.com` you want a **named tunnel** bound to a domain in your Cloudflare account.

## Prerequisites
- A domain on Cloudflare (DNS at Cloudflare).
- `cloudflared` installed.

## One-time setup

```bash
# 1. Auth. Opens a browser to pick which zone this tunnel can control.
cloudflared tunnel login

# 2. Create the tunnel. Prints its UUID and credentials file path.
cloudflared tunnel create openfront-relay

# 3. Route DNS to it. Replace with your subdomain.
cloudflared tunnel route dns openfront-relay relay.yourdomain.com
```

## Config file

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: openfront-relay
credentials-file: /Users/steven/.cloudflared/<UUID>.json   # printed by `create`
ingress:
  - hostname: relay.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
```

Cloudflare Tunnels support WebSocket upgrade natively — no extra flag needed.

## Run

Two processes:

```bash
# Terminal 1: the Node relay
cd relay-example
ALLOWED_ORIGINS="chrome-extension://<your-chrome-id>,moz-extension://" \
SHARED_SECRET="pick-something-long-and-random" \
node server.js

# Terminal 2: the tunnel
cloudflared tunnel run openfront-relay
```

## Configure the extension

In the popup:
- **Relay WebSocket URL**: `wss://relay.yourdomain.com`
- **Shared secret**: same string as `SHARED_SECRET` above

## Running as a background service

Instead of Terminal 2:
```bash
sudo cloudflared service install     # generates a launchd/systemd unit
```

For the Node relay itself: use `pm2`, `launchd`, or a `systemd` unit. Or run it in a `tmux` session on a small VPS if you don't want it tied to your laptop.

## Cost

Cloudflare Tunnel is free for personal use — no bandwidth or connection fees. You only pay if you attach features like Access.
