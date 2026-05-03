# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

Phases 0–4 complete. Engine wired into the room: clicking "Start game" creates an engine HandState, deals hole cards privately to each seat owner, and broadcasts `hand.snapshot` deltas. Players act via `hand.action` messages routed through `engine.applyAction`. UI renders the felt with community cards, hole cards (mine face-up, others face-down, all face-up at showdown), an action panel for the active player, and a showdown banner with winner + hand description. After the hand ends the room sits idle until the next "Start game" — auto-deal lands in Phase 5. 172 tests (68 server + 16 web + 88 engine).

## Project

**Felt** — a web-based Texas Hold'em room for playing with friends. TypeScript monorepo:

- `apps/server` — Node.js + µWebSockets game server (authoritative for all game state)
- `apps/web` — React + Vite client (pure renderer of server state)
- `packages/engine` — pure poker engine; no I/O, no timers, no sockets. `startHand(opts)` and `applyAction(state, seatIdx, action)` return `{state, effects}`. Side-pot calc returns orphaned-pot contributions so the engine can refund uncalled chips (caught by a property test). Test it via the scenario DSL in `src/scenario.ts`.
- `packages/shared` — types shared between client and server
- Postgres for durability, Redis for cross-instance routing (Phase 13 only), Firebase Auth (Phase 12)

## Feature workflow (non-negotiable)

For **every** feature — poker logic, room creation, joining games, seat management, chat, host controls, anything — work in this order:

1. **Tests first.** Write failing tests that describe the feature's behavior. For engine work, use the scenario DSL + property tests. For server features (rooms, seats, joining, etc.), write integration tests against the message handlers. For client features, write component/interaction tests.
2. **Backend next.** Implement server-side logic until the tests pass. The server is authoritative; the feature must be correct here before any UI exists.
3. **Frontend last.** Wire up the client to render and trigger the now-working backend. The UI is a thin layer over server state.

Do not invert this order — no "build the UI first to see what feels right" shortcuts, no "I'll add tests after." If a feature feels too vague to test, it's too vague to build; clarify the behavior first.

## Architectural invariants

These are non-negotiable and shape every phase:

1. **Server is authoritative for everything.** Clients render what the server says. Never put game logic in the client beyond display concerns.
2. **The poker engine is a pure function.** `apply(state, event) → { state, effects }`. No I/O, no timers, no sockets, no randomness outside a seeded shuffle. The server consumes the engine; the engine knows nothing about the server.
3. **Effects, not side effects.** The engine returns a list of effects (deal cards, broadcast, etc.); the server interprets them. This is what makes hand replay from `(seed, action log)` possible.
4. **Shared types live in `packages/shared`.** One source of truth for wire messages and domain types. Don't duplicate types across client and server.
5. **Provably-fair randomness.** Server publishes `seedHash` at hand start, reveals `seed` at hand end. Both are persisted (Phase 8).
6. **Every phase ends playable.** Don't start phase N+1 until phase N's "Done when" gate is met. Phase 3 (engine) explicitly has no UI deliverable — resist wiring it up early.

## Wire protocol shape

The server speaks WebSocket messages with a small vocabulary that grows by phase. Early messages: `room.join`, `room.snapshot`, `room.delta`, `seat.take`, `seat.leave`. Game messages added in Phase 4: `turn.changed` (with `deadline` once timers land in Phase 6), street/showdown broadcasts. Reconnect uses an `auth` message with a stored session ID (Phase 7).

Hole cards are sent **privately** to seat owners only; everyone else sees card backs until showdown.

## Development commands

From the repo root:

- `pnpm dev` — runs both `apps/server` (tsx watch) and `apps/web` (Vite) in parallel via `pnpm -r --parallel --stream --filter "./apps/*" run dev`
- `pnpm typecheck` — runs `tsc --noEmit` in every workspace
- `pnpm build` — builds every workspace
- `pnpm lint` — Biome check across the repo
- `pnpm format` — Biome auto-format
- `pnpm test` — runs vitest in every workspace (`packages/shared` passes with no tests)
- Per-workspace: `pnpm --filter @felt/server test`, etc.

Per-workspace commands work via `pnpm --filter @felt/server <script>` (or `@felt/web`, `@felt/shared`).

### Server runtime

- Default port: `8080` (override with `PORT`)
- CORS default: `*` (override with `CORS_ORIGIN`) — locked down at deploy in Phase 11
- WebSocket route: `/ws`. Sessions get a UUID assigned in `upgrade`, stored on `ws.getUserData().sessionId`. The `RoomManager` maps sessionId → {roomId, playerId} and emits `Effect[]` lists that the transport translates into `ws.send` calls. Same effects pattern that the engine will use in Phase 3.

### µWebSockets.js gotcha

`writeStatus(...)` MUST be called **before** any `writeHeader(...)`. Reverse order silently drops the status (defaults to 200). Easy to miss because there's no warning. See `apps/server/src/server.ts` OPTIONS handler for the correct ordering.

### pokersolver ESM/CJS gotcha

`pokersolver` is CommonJS. Vitest's interop accepts `import { Hand } from "pokersolver"` and tests pass, but **Node ESM at runtime crashes** with `does not provide an export named 'Hand'`. The working pattern (used in `packages/engine/src/evaluator.ts`):

```ts
import pokersolver, { type Hand as PokersolverHand } from "pokersolver";
const { Hand } = pokersolver;
```

Plus a small `pokersolver.d.ts` next to it that exports both the class type AND a `default` containing it. Triple-slash reference path makes the `.d.ts` discoverable to consumers (server) without putting it in `@types`.

### Environment gotcha (Windows)

`packageManager` is pinned to `pnpm@10.33.2`. The Node install ships corepack but **`corepack enable` requires admin** on Windows (writes to `C:\Program Files\nodejs`). The working alternative used here: `npm install -g pnpm@10.33.2` — npm's global prefix is `%AppData%\npm`, which is on PATH and user-writable. Don't `corepack enable` on this machine; use the npm-installed pnpm.

## Testing philosophy (Phase 3 onward)

The poker engine uses two testing styles in tandem:

- **Scenario DSL** — fluent test cases like `scenario.seats(2).blinds(1,2).stacks(100,100).deal().check().bet(10).fold().expect.winner(1)`. Hand-coded coverage of common situations (heads-up, three-way all-in with side pots, run-down to river, fold-around).
- **Property tests (fast-check)** — invariants that must hold for any seed/action sequence: chip conservation, valid turn order, terminal state distributes all chips, side pots sum to total committed.

Hand replay is a first-class test: `(seed, action log) → identical state at every step`. If replay diverges, the engine has hidden non-determinism — fix it before moving on.

## Phase ordering hazards

- **Don't skip Phase 3's isolation.** A flaky engine poisons everything downstream and is painful to fix once it's wired into the network layer.
- **Don't build Phase 13 (multi-instance) speculatively.** Single-instance carries the app comfortably for the first year per the roadmap's sizing notes.
- **Phase 11 deploy specifics matter** — the nginx config for WebSockets (`Upgrade`/`Connection` headers, `proxy_read_timeout 3600s`) and the Postgres VPC private network setup are easy to get wrong; follow the roadmap's checklist verbatim.

## When extending the roadmap

If a feature falls under "Beyond v1" in `ROADMAP.md` (tournaments, Omaha, voice, etc.), flag it as scope creep before implementing. The roadmap's pacing assumes a focused path to a deployable v1.
