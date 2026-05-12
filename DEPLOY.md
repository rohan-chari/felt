# Deploy

Felt's server runs as a Docker image on a DigitalOcean droplet, pulled from DigitalOcean Container Registry (DOCR). The web client builds to static files; deploy them however you like (Vercel, nginx static, etc).

This doc covers shipping a new server build to production.

## Prerequisites (one-time)

- `doctl` installed and authenticated: `doctl auth init`
- Docker Desktop running locally
- SSH access to the droplet
- `OPENAI_API_KEY` set in the droplet's environment (required for bots; without it bots fall back to check/fold)

Set these shell vars once so the commands below are copy-paste:

```sh
export DOCR_REGISTRY=registry.digitalocean.com/<your-registry-name>
export IMAGE=$DOCR_REGISTRY/felt-server
export DROPLET=user@your.droplet.ip
```

## Standard release

### 1. Push code to `main`

```sh
git add apps/ packages/
git commit -m "feat: <summary>"
git push origin main
```

### 2. Build + push the image to DOCR

```sh
doctl registry login

# --platform linux/amd64 is REQUIRED on Apple Silicon — without it you
# push an arm64 image the droplet (amd64) can't run.
SHA=$(git rev-parse --short HEAD)
docker build --platform linux/amd64 -t $IMAGE:$SHA -t $IMAGE:latest .
docker push $IMAGE:$SHA
docker push $IMAGE:latest
```

The dual-tag (`:$SHA` + `:latest`) lets you roll back to any prior commit by retagging.

### 3. Pull + restart on the droplet

SSH in and pull the new image:

```sh
ssh $DROPLET
cd /path/to/felt   # wherever docker-compose.yml lives on the droplet
docker compose pull server
docker compose up -d server
docker compose logs -f server   # confirm it boots cleanly, then ctrl-C
```

If you're running the server as a bare `docker run` instead of compose, swap step 3 for:

```sh
docker pull $IMAGE:latest
docker stop felt-server && docker rm felt-server
docker run -d --name felt-server --restart unless-stopped \
  -p 8080:8080 \
  --env-file /path/to/felt.env \
  $IMAGE:latest
```

## What changed determines what you redeploy

- **Server / `packages/engine` / `packages/shared`** — rebuild + push the image (full flow above).
- **`apps/web` only** — no new image. Rebuild the frontend (`pnpm --filter @felt/web build`) and ship `apps/web/dist` to wherever you host static files. The Dockerfile only copies server workspaces, so frontend changes never invalidate the image.

## Environment variables

The server reads these at boot. Set them in the droplet's `.env` (or compose env, or systemd unit — whatever you're using):

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8080` | Server listen port |
| `CORS_ORIGIN` | yes (prod) | `*` | Lock to your web origin, e.g. `https://felt.example.com` |
| `DATABASE_URL` | yes | — | Postgres connection string. Used for hand history + room snapshots |
| `OPENAI_API_KEY` | for bots | — | Without this, bots check/fold every turn |

Never commit any of these. The droplet's env is the source of truth.

## Rolling back

DOCR keeps every tag you push. To revert to the previous commit's image:

```sh
ssh $DROPLET
# Find the previous SHA you want (DOCR UI or `doctl registry repository list-tags felt-server`)
docker compose pull server   # if you re-tagged :latest
# Or pin compose to an explicit SHA tag and `up -d server`
```

## Provably-fair note

The seed → seedHash audit trail relies on persisted `HandRecord` rows. After any deploy, verify Postgres is healthy and the `hand_records` table is still being written to (open a room, play a hand, check the DB). If Postgres is down the server still runs but history is lost.

## Common gotchas

- **WebSockets dropping after ~1 minute** — your nginx in front of the server needs `proxy_read_timeout 3600s` and the `Upgrade`/`Connection` upgrade headers. See `CLAUDE.md` → "Phase ordering hazards".
- **`exec format error` on the droplet** — you pushed an arm64 image. Rebuild with `--platform linux/amd64`.
- **Bots silently check/fold after deploy** — `OPENAI_API_KEY` wasn't set in the droplet env, or the daily call cap (`5000` by default, in-memory) was hit. Restart the container to reset the counter.
- **`doctl registry login` expired** — DOCR creds expire periodically; just rerun.
