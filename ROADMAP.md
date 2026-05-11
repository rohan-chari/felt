# Felt — Implementation Roadmap

A web-based Texas Hold'em room for playing with friends. Built as a TypeScript monorepo with a Node.js + µWebSockets game server, React + Vite client, Postgres for durability, Redis for routing, and Firebase Auth (later).

This document is the build plan. Each phase ends in something concrete and testable end-to-end. Don't skip the "definition of done" for a phase — it's the gate that keeps later phases from collapsing on a shaky foundation.

## Guiding principles

- **Server is authoritative for everything.** Clients render what the server says.
- **The poker engine is a pure function.** No I/O, no timers, no sockets. It takes a state and an event, returns a new state.
- **Shared types between client and server.** One source of truth in `packages/shared`.
- **Every phase ends playable.** Even if ugly, even if missing features — you can demo it.
- **Tests grow with the engine, not after it.** Property-based tests from day one.

---

## Phase 0 — Foundations

**Goal:** the repo exists, both apps boot, you can see "hello world" from each.

- Initialize the monorepo: pnpm workspaces, base tsconfig, shared lint/format config.
- Scaffold `packages/shared` (empty for now, exports nothing).
- Scaffold `apps/server` — Node + TypeScript, prints "server up" on start.
- Scaffold `apps/web` — Vite + React + TypeScript, renders a single page with the project name.
- Set up local dev: one command (`pnpm dev`) runs both apps concurrently.
- Commit, push to GitHub.

**Done when:** `pnpm dev` starts both apps, web page loads at localhost, server logs to terminal.

---

## Phase 1 — Rooms and presence

**Goal:** create a room, share the link, see other people in it. No poker yet — just "we're in the same room."

- HTTP endpoint: `POST /rooms` creates a room, returns `{ roomId }`.
- WebSocket endpoint: client connects, sends a `room.join` message with `roomId` and `displayName`.
- Server keeps an in-memory `Map<roomId, Room>`. Each room tracks connected players (no seats yet, just a list of names).
- Server broadcasts `room.snapshot` on join and `room.delta` when someone joins or leaves.
- Client: a "Create Room" button → navigates to `/r/:roomId`. A room page that prompts for a display name, connects via WebSocket, shows a list of who's currently in the room.
- Anonymous identity only. A device-local UUID is the player's identity for now.

**Done when:** open two browser tabs, create a room in one, paste the link into the other, both show each other in the player list. Close one tab, the other sees them leave.

---

## Phase 2 — Seats and the lobby

**Goal:** the table exists visually. People can sit down and stand up. Still no cards.

- Add `seats` to room state. Configurable max (default 8). Each seat is empty or holds a player with a stack number.
- New messages: `seat.take` (with a chosen seat index and buy-in amount), `seat.leave`.
- Server validates: seat is empty, player isn't already seated, buy-in is within range.
- Render a felt-shaped table on the client with seat slots around it. Empty seats show a "Sit here" button. Occupied seats show name + stack.
- Add a "Start game" button visible only to the host (first player to join is host for now). Disabled until 2+ seats are filled. Clicking it does nothing yet — just flips a `gameStarted` boolean in room state.
- Add a basic chat in a side panel.

**Done when:** two tabs, both join a room, both sit down at different seats, both see each other's seats and stacks, host clicks "Start game," both clients reflect that the game is "started" (even though nothing happens yet). Chat works.

---

## Phase 3 — The poker engine, in isolation

**Goal:** a working Texas Hold'em engine, fully tested, with zero networking. This is purely `packages/engine` work.

- Card types, deck, seeded crypto shuffle.
- Hand evaluator (use pokersolver or similar — don't write this yourself).
- Hand state machine: `apply(state, event) → { state, effects }`.
- Betting round logic: turn order, min-raise, all-ins, side pots.
- Streets: pre-flop, flop, turn, river, showdown.
- Test DSL — a tiny fluent API for writing scenarios:
  ```
  scenario.seats(2).blinds(1,2).stacks(100,100).deal()
    .check().bet(10).fold()
    .expect.winner(1).expect.stacks(103, 97)
  ```
- Property tests with fast-check: chip conservation, valid turn order, terminal state always distributes all chips, side pots sum to total committed.
- Hand-replay: given a seed and an action log, replay produces identical state at every step.

**Done when:** the engine can play a full hand from any seed and action log, all property tests pass, and you have at least 30 hand-coded scenarios covering common cases (heads-up, three-way all-in with side pots, run-down to river, fold-around).

This phase has no UI deliverable. The "test" is `pnpm test` in `packages/engine`. Resist the temptation to wire it up early.

---

## Phase 4 — Wire the engine into a single hand

**Goal:** play exactly one hand, end-to-end, with real cards. Hand ends, nothing happens after. No timers yet, no pre-actions, no animations.

- Server: when host clicks "Start game," instantiate an engine state for the room. Start a hand.
- Server emits effects from the engine: deal hole cards (privately, only to each seat owner), broadcast street changes, broadcast `turn.changed`.
- Client: render hole cards face-up to their owner, backs to others. Render community cards as they arrive.
- Action panel for the active player only: Fold / Check / Call / Bet / Raise (plain number input, no slider).
- On showdown, server broadcasts the result: winning seat(s), winning hand name, pot amounts. Client displays it.
- After the hand ends, room sits idle. No auto-deal yet.

**Done when:** two tabs play one full hand of Hold'em with a real flop, turn, and river. Showdown shows the correct winner. Stacks update correctly. Everyone's hole cards remain hidden from the other player until showdown.

---

## Phase 5 — Continuous play

**Goal:** hands keep coming. The game feels like a game.

- Auto-advance: after a hand ends, brief pause, then start the next hand.
- Dealer button rotates correctly.
- Blinds posted automatically by the right seats.
- Heads-up edge case: small blind is the dealer, acts first pre-flop.
- Players sitting out are skipped; they post nothing.
- New player joining mid-session can either "wait for big blind" or "post immediately."
- Player sitting out by leaving their seat mid-hand auto-folds.
- Bust handling: stack at 0 → seat marked busted, prompt to rebuy.

**Done when:** two tabs play five hands in a row without intervention. Dealer button moves, blinds rotate, busts are handled.

---

## Phase 6 — Turn timers and pre-actions

**Goal:** hands play at a reasonable pace even when someone goes AFK.

- Server-authoritative turn timer. `turn.changed` includes a `deadline` timestamp.
- Client renders a countdown ring around the active seat's avatar.
- On expiry: auto-fold if facing a bet, auto-check otherwise.
- Time bank: each player gets a small reserve, usable once per hand on request.
- Pre-action UI: when it's not your turn, show checkboxes for Fold / Check / Check-fold / Call any. Server queues them, applies the moment action reaches you.
- Cancelling a queued action before it fires.

**Done when:** a player can walk away mid-hand and the game continues without them. Pre-actions visibly fire instantly when action reaches the queuing player.

---

## Phase 7 — Reconnects and snapshots

**Goal:** the game survives bad WiFi, page reloads, and the occasional server restart.

- Client persists its session ID. On reconnect, sends `auth` with the stored ID.
- Server recognizes the returning session, sends a fresh `room.snapshot`, including the current hand state if mid-hand.
- Hole cards are re-sent privately to the reconnecting player if they own a seat.
- Disconnect protection: configurable. Default — disconnected mid-hand player is treated as all-in for what they've committed.
- Server snapshots room state to Postgres every N seconds. On restart, hot rooms are restored.

**Done when:** kill a tab mid-hand, reopen the link, you're back at your seat with your hole cards visible and the correct turn state. Restart the server, hot rooms recover.

---

## Phase 8 — Hand history and ledger

**Goal:** you can review every hand played and see who's up or down.

- Persist every completed hand to Postgres: seed, action log, board, hole cards (revealed only for shown hands), pot results.
- Hand history view: list of hands in the current session. Click a hand → step-through replay using the same UI.
- Ledger view: per-player buy-ins, current stack, projected net. Updates in real time.
- Session end: highlighted final ledger, copyable as text.
- Provably-fair hashes: server publishes `seedHash` at hand start, `seed` at hand end. Both stored.

**Done when:** play 10 hands, open hand history, replay any one of them step by step. Open ledger, see correct net for each player.

---

## Phase 9 — UI polish

**Goal:** the app stops looking like a developer prototype.

- Real felt design: refined typography, controlled palette, snappy chip animations (~200ms).
- Card design that's readable at small sizes.
- Active seat highlight + countdown ring.
- Side pot rendering when applicable, clearly labeled.
- Action log as a tabbed right rail with chat and hand history.
- Mobile layout: bottom-sheet right rail, larger touch targets, simplified seat tiles.
- Sounds (optional, default on, easy to mute).
- Reactions: tap a seat to send an emoji that floats up.

**Done when:** the app passes the "would you send this to your group chat" test on both desktop and mobile.

---

## Phase 10 — Host controls and room settings — **DONE** (straddle deferred to Beyond v1)

**Goal:** hosts can actually run a game without restarting the room.

- ✅ Host menu: kick player, pause/resume, adjust blinds, end session.
- ✅ All host actions are logged in the action log so players can see them (system chat entries).
- ✅ Settings configurable at room creation: blinds, starting stack, buy-in range, max seats, turn timer, time bank, auto-deal toggle, show-one-show-both. **Straddle: deferred.**
- ✅ Mid-game settings changes (where safe) take effect at the next hand boundary (blinds); auto-deal toggle gates the inter-hand timer immediately.
- ✅ Host transfer: explicit handoff, plus auto-promotion (lowest seat index) if host is gone past the disconnect grace period.
- ✅ Show-one-show-both: fold-around winners can opt to reveal via `seat.showCards`.

---

## Phase 11 — Production deploy on DigitalOcean

**Goal:** the app runs on the internet, not just localhost.

- Dockerfile for the server. Multi-stage build, slim runtime image.
- `docker-compose.yml` on the droplet with two services:
  - **server** — your Node.js game server
  - **redis** — in a container; promote to managed Redis only when you need it
- **Postgres** — your existing DigitalOcean Managed Database. Connect via the connection string in env vars. Use the **VPC private network** so traffic between the droplet and the DB doesn't go over the public internet (free, faster, more secure — sub-millisecond latency vs ~1–5ms public).
- **Trusted sources** on the managed DB: restrict access to only your droplet's IP (or the whole VPC). Don't leave it open to the world.
- **Connection pooling.** Managed Postgres has a per-plan connection limit (basic tier caps around 22). Use `pg.Pool` with `max: 10` as a starting point. If you ever hit the cap, flip on DigitalOcean's built-in PgBouncer in the dashboard — no app changes needed.
- **Nginx** as a reverse proxy in front of the server. Critical settings for WebSockets:
  - `proxy_http_version 1.1`
  - `proxy_set_header Upgrade $http_upgrade`
  - `proxy_set_header Connection "upgrade"`
  - `proxy_read_timeout 3600s` (so idle WS connections don't get killed)
- **HTTPS via Let's Encrypt** using Certbot. Free, auto-renewing.
- **Domain** pointed at the droplet's IP via an A record. Set up a **Floating IP** day one so you can reprovision without DNS changes.
- **Web client** deployed separately to Cloudflare Pages or DigitalOcean App Platform static hosting. Don't serve the SPA from the droplet — it just adds load and complicates caching.
- **Process management** via Docker's restart policies.
- **Basic observability:**
  - Server logs to stdout, captured by Docker, optionally shipped to a log service
  - Health check endpoint: `GET /health` returns connection count, active rooms, uptime, DB connectivity
  - Sentry for error tracking (free tier is plenty)
- **Firewall:** DigitalOcean Cloud Firewall on the droplet — allow only 80/443 inbound, 22 from your IP. Block everything else.
- **Backups:** managed DB handles its own automated backups (verify retention — default is usually 7 days, extendable). Plus enable DigitalOcean's weekly droplet snapshots for the server itself.

**Sizing notes:**
- $12/mo droplet (2GB RAM, 1 vCPU): handles ~1k concurrent connections, ~150 active rooms. Fine for the first year.
- $24/mo droplet (4GB RAM, 2 vCPU): comfortable headroom for 5k+ connections.
- Beyond that: scale vertically first, then move to Phase 13.

**Done when:** you share a real URL with a friend, they create a room from their phone, you join from yours, and you play a hand without seeing localhost.

---

## Phase 12 — Firebase Auth

**Goal:** optional accounts, without breaking anonymous play.

- Firebase project setup, Google + Apple sign-in providers.
- Server verifies Firebase ID tokens on the WebSocket auth message.
- Identity layer accepts either anonymous session ID or Firebase UID — both treated equally as seat owners.
- Signed-in users get persistent display names, avatars, cross-session ledger history.
- "Sign in" is a button on the home page, never a wall in front of joining a room.

**Done when:** you can join a room anonymously, or sign in with Google and have your name stick across sessions. Both flows coexist.

---

## Phase 13 — Multi-instance scaling

**Goal:** the app survives one server box being full.

- Redis stores `roomId → instanceId` mapping.
- Edge layer (or a thin router) directs incoming WebSocket connections to the right instance.
- New rooms created on the least-loaded instance.
- Cross-instance pub/sub for lobby-level events (room list, friends online).
- Graceful shutdown: an instance draining moves its rooms to others by sending a "migrate" message.

This phase is only needed when you have real load. Don't build it speculatively. The earlier phases all run on a single instance just fine.

**Done when:** you can run two server instances behind a router, create rooms on each, and they both function. Killing one instance migrates its rooms cleanly.

---

## Beyond v1

These are deliberately deferred. Adding them earlier creates scope creep that delays a playable product:

- Run it twice
- Tournaments (multi-table, blind levels, payouts)
- Other variants (Omaha, Stud)
- Voice chat
- Friends list and presence
- Streaming HUD integrations
- Native mobile apps

---

## Suggested pacing

For solo work in evenings/weekends, a reasonable rhythm is **one phase per week**, with phases 3 and 9 likely taking two weeks each. That puts you at a deployed, polished, friend-shareable v1 in roughly 3 months. Faster if you're full-time on it.

The most important phase to not rush is **Phase 3**. A flaky engine poisons everything downstream and is painful to fix once it's wired into the network layer. Spend the time, write the tests, then move on with confidence.
