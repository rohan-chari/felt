# Deploy

Felt's server runs as a Docker container on a DigitalOcean droplet. **Deploys happen on the droplet itself** — you SSH in, `git pull`, `docker build`, swap the container. No DOCR round-trip, no cross-machine push.

The web client builds to static files; deploy `apps/web/dist` separately (Vercel, nginx static, etc).

## Where things live

- **Droplet:** `stock-sentiment` (`167.172.225.16`), region `nyc3`. The name is historical — felt runs here. Only droplet in the DO account.
- **Repo on droplet:** `/var/www/felt` (also the working directory you start in).
- **Running container:** `felt-server` (always that exact name — `docker run`, not compose).
- **Image:** `registry.digitalocean.com/felt-rohan/felt-server:latest` (DOCR registry name: `felt-rohan`).
- **Managed Postgres:** `stock-sentiment-do-user-...ondigitalocean.com:25060/felt`, connection string in `/var/www/felt/.env`. Uses `do-ca.crt` for TLS verification.
- **Frontend:** hosted separately; nothing to do here for web-only changes.

`docker-compose.yml` in the repo is for **local dev only** (it bundles a Postgres container). Production uses managed Postgres and a bare `docker run`.

## Standard release (~2 minutes)

Run this on the droplet, from `/var/www/felt`:

```sh
cd /var/www/felt
git pull

# Tag the currently running image as a rollback point BEFORE building.
OLD=$(docker inspect felt-server --format '{{.Image}}')
docker tag $OLD registry.digitalocean.com/felt-rohan/felt-server:rollback-pre-$(date +%Y%m%d-%H%M%S)

# Build new image (we're on linux/amd64 — no --platform flag needed).
SHA=$(git rev-parse --short HEAD)
IMAGE=registry.digitalocean.com/felt-rohan/felt-server
docker build -t $IMAGE:$SHA -t $IMAGE:latest .

# Swap the container. ~3s of WS downtime.
docker stop felt-server && docker rm felt-server
docker run -d --name felt-server --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  --env-file /var/www/felt/.env \
  -v /var/www/felt/do-ca.crt:/etc/ssl/do-ca.crt:ro \
  $IMAGE:latest

# Verify.
sleep 2 && docker logs --tail 30 felt-server
# Expect: "server up on :8080 (persistence: postgres)"
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://127.0.0.1:8080/ws
# Expect: 101
```

The `rollback-pre-<timestamp>` tag keeps the prior image alive locally even after `:latest` is overwritten. Without that tag, the old layers get GC'd on the next `docker image prune` and rollback gets painful.

### Why we skip DOCR push

The doctl token on this droplet has **read-only** registry scope — `doctl registry login` works, but `docker push` fails with `registry:update permission is required`. Since the build happens on the droplet itself, there's nothing to push *to* anyway: the new `:latest` image is already on the host that needs to run it. The `rollback-pre-*` local tag is the rollback mechanism.

If you ever need true DOCR rollback history (e.g. for a fresh droplet), re-init doctl with a read-write token and append `docker push $IMAGE:$SHA && docker push $IMAGE:latest` after the build.

## Rollback

```sh
docker stop felt-server && docker rm felt-server
docker run -d --name felt-server --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  --env-file /var/www/felt/.env \
  -v /var/www/felt/do-ca.crt:/etc/ssl/do-ca.crt:ro \
  registry.digitalocean.com/felt-rohan/felt-server:rollback-pre-<TIMESTAMP>
```

List rollback tags: `docker images registry.digitalocean.com/felt-rohan/felt-server | grep rollback`.

## What changed determines what you redeploy

- **`apps/server` / `packages/engine` / `packages/shared`** — full flow above.
- **`apps/web` only** — no container rebuild. `pnpm --filter @felt/web build` and ship `apps/web/dist` to your static host. The Dockerfile copies only server workspaces, so frontend changes never invalidate the image.
- **`.env` only** — no rebuild; `docker stop felt-server && docker start felt-server` re-reads the env file. (Or `docker restart felt-server` — same effect since `--env-file` is read at container start.)

## Environment variables

Server reads these at boot from `/var/www/felt/.env`:

| Var | Required | Notes |
|---|---|---|
| `PORT` | no | Defaults to `8080`. Don't change without updating the `-p` flag and nginx upstream. |
| `CORS_ORIGIN` | yes | Lock to the web origin in prod, e.g. `https://felt.example.com`. `*` is fine for early testing. |
| `DATABASE_URL` | yes | Managed Postgres connection string. Must include `?sslmode=require`. |
| `NODE_EXTRA_CA_CERTS` | yes | Must be `/etc/ssl/do-ca.crt` — matches the `-v` mount. Without this, TLS to managed Postgres fails. |
| `NODE_ENV` | yes | `production`. |
| `OPENAI_API_KEY` | for bots | Without it, bots check/fold every turn. |

`.env` is gitignored; the droplet copy is the source of truth. Never commit it.

## Provably-fair audit trail

The seed → seedHash chain depends on `HandRecord` rows in Postgres. After a deploy, play a hand and check the `hand_records` table is being written. If Postgres is down the server still runs but history is silently lost.

## Gotchas

- **`exec format error` on container start** — you built on Apple Silicon and pushed an arm64 image. Rebuild on the droplet (or with `--platform linux/amd64`). Doesn't happen with the on-droplet flow above.
- **Bots silently check/fold after deploy** — `OPENAI_API_KEY` missing from `/var/www/felt/.env`, or the in-memory daily cap (`5000` calls) was hit. Restart the container to reset the counter.
- **WebSockets dropping after ~1 minute** — nginx in front needs `proxy_read_timeout 3600s` and the `Upgrade`/`Connection` upgrade headers. See `CLAUDE.md` → "Phase ordering hazards".
- **`tsconfig.tsbuildinfo` blocking `git pull`** — it's a build artifact that ends up tracked. Discard it: `git checkout -- apps/web/tsconfig.tsbuildinfo && git pull`.
- **`doctl registry login` "permission required"** — the token is read-only by design. You don't need a successful login for the on-droplet flow; ignore.
- **Container starts but server doesn't boot** — check `docker logs felt-server` for `PG` / TLS errors. Usually means `NODE_EXTRA_CA_CERTS` is missing from `.env` or `do-ca.crt` is missing from `/var/www/felt/`.
- **Port `8080` is loopback-only (`127.0.0.1:8080`)** — nginx on the droplet proxies to it. If you ever change the bind to `0.0.0.0`, you're exposing the WS server directly; lock down the firewall first.
