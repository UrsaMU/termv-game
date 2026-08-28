# Terminal Velocity (game host)

UrsaMU game server for **Sprawl Goons: Upgraded** — the backend for [termv.ursamu.io](https://termv.ursamu.io).

| Piece | Host |
|-------|------|
| Web client (Vercel) | `https://termv.ursamu.io` |
| Game API / site / admin | `https://game.termv.ursamu.io` |
| WebSocket | `wss://game.termv.ursamu.io/ws` |
| Telnet | `game.termv.ursamu.io:4201` |

## Ports (local process)

| Protocol | Port |
|----------|------|
| Telnet | 4201 |
| WebSocket | 4202 |
| HTTP API | 4203 |

## Run

```bash
cp config/config.sample.json config/config.json
deno task daemon   # production
# or
deno task start    # foreground + watch
```

## Deploy

1. `git pull` on the host under `~/termv`
2. Ensure `config/config.json` exists (not overwritten)
3. `sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy`
4. `deno task restart`

Sprawl plugin: `jsr:@ursamu/sprawl-plugin@1.0.1` (local `vendor/sprawl` kept as offline fallback).
