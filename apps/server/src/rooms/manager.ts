import { randomUUID } from "node:crypto";
import {
  applyAction as engineApplyAction,
  forceFold as engineForceFold,
  type HandState,
  markSittingOut as engineMarkSittingOut,
  startHand,
} from "@felt/engine";
import type {
  Action,
  HandLogEntryView,
  HandRecord,
  PlayerId,
  PreAction,
  RoomConfig,
  RoomDelta,
  RoomId,
  ServerMessage,
} from "@felt/shared";
import type { RoomSnapshotBlob } from "../persistence/types.js";
import { buildHandFromRoom, sha256Hex, toHandView } from "./hand.js";
import {
  applyEvent,
  applyIntent,
  createRoom,
  type RoomState,
  toSnapshot as roomToSnapshot,
} from "./room.js";
import { validateRoomSettings } from "./settings.js";

export type SessionId = string;

export type Effect = {
  sessionId: SessionId;
  message: ServerMessage;
};

type SessionInfo = {
  roomId: RoomId;
  playerId: PlayerId;
};

type JoinArgs = {
  sessionId: SessionId;
  roomId: RoomId;
  playerId: PlayerId;
  displayName: string;
};

type IntentError = { error: { code: string; message: string } };

const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID_LENGTH = 6;
const DEFAULT_DISCONNECT_GRACE_MS = 60_000;

function generateRoomId(): RoomId {
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    const idx = Math.floor(Math.random() * ROOM_ID_ALPHABET.length);
    id += ROOM_ID_ALPHABET[idx];
  }
  return id;
}

function findSeatOf(state: RoomState, playerId: PlayerId): number {
  for (let i = 0; i < state.seats.length; i++) {
    const seat = state.seats[i];
    if (seat?.kind === "taken" && seat.playerId === playerId) return i;
  }
  return -1;
}

function eligibleSeatedSlots(room: RoomState): number[] {
  const out: number[] = [];
  for (let i = 0; i < room.seats.length; i++) {
    const seat = room.seats[i];
    if (seat?.kind === "taken" && !seat.busted) out.push(i);
  }
  return out;
}

function nextDealerAfter(room: RoomState, currentSlot: number): number {
  const eligible = eligibleSeatedSlots(room);
  if (eligible.length === 0) return currentSlot;
  for (let step = 1; step <= room.seats.length; step++) {
    const candidate = (currentSlot + step) % room.seats.length;
    if (eligible.includes(candidate)) return candidate;
  }
  return eligible[0] as number;
}

export class RoomManager {
  /** How long to hold a disconnected player's seat before evicting them. Server-wide, not per-room. */
  disconnectGraceMs = DEFAULT_DISCONNECT_GRACE_MS;

  private rooms = new Map<RoomId, RoomState>();
  private sessions = new Map<SessionId, SessionInfo>();
  private hands = new Map<RoomId, HandState>();
  private nextHandTimers = new Map<RoomId, ReturnType<typeof setTimeout>>();
  private turnTimers = new Map<RoomId, ReturnType<typeof setTimeout>>();
  private currentTurnDeadlines = new Map<RoomId, number>();
  /** Pre-actions queued per room → playerId. Cleared at hand end. */
  private preActions = new Map<RoomId, Map<PlayerId, PreAction>>();
  /** Pending eviction timers per room → playerId. Cancelled on rejoin. */
  private evictionTimers = new Map<RoomId, Map<PlayerId, ReturnType<typeof setTimeout>>>();
  /** Players whose hole cards are revealed for the current/just-finished hand. Cleared at hand start. */
  private currentHandReveals = new Map<RoomId, Set<PlayerId>>();
  private dispatcher: ((effects: Effect[]) => void) | null = null;
  private handSink: ((record: HandRecord) => void) | null = null;

  /** Server registers a callback the manager uses to dispatch async effects (e.g., timer-fired hand starts). */
  setDispatcher(fn: (effects: Effect[]) => void): void {
    this.dispatcher = fn;
  }

  /** Server registers a sink that receives a HandRecord whenever a hand completes. */
  setHandSink(fn: (record: HandRecord) => void): void {
    this.handSink = fn;
  }

  private dispatchAsync(effects: Effect[]): void {
    if (this.dispatcher && effects.length > 0) this.dispatcher(effects);
  }

  createRoom(settings?: Partial<RoomConfig>): RoomId {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    this.rooms.set(id, createRoom(id, settings));
    return id;
  }

  hasRoom(roomId: RoomId): boolean {
    return this.rooms.has(roomId);
  }

  getHand(roomId: RoomId): HandState | undefined {
    return this.hands.get(roomId);
  }

  getSessionInfo(sessionId: SessionId): { roomId: RoomId; playerId: PlayerId } | undefined {
    return this.sessions.get(sessionId);
  }

  private toSnapshotWithHand(room: RoomState) {
    const snap = roomToSnapshot(room);
    const hand = this.hands.get(room.roomId);
    if (hand)
      snap.hand = toHandView(
        hand,
        this.currentTurnDeadlines.get(room.roomId) ?? null,
        undefined,
        this.currentHandReveals.get(room.roomId),
      );
    return snap;
  }

  private sessionsInRoom(roomId: RoomId, except?: SessionId): SessionId[] {
    const out: SessionId[] = [];
    for (const [sid, info] of this.sessions) {
      if (info.roomId !== roomId) continue;
      if (sid === except) continue;
      out.push(sid);
    }
    return out;
  }

  private sessionsForPlayerInRoom(roomId: RoomId, playerId: PlayerId): SessionId[] {
    const out: SessionId[] = [];
    for (const [sid, info] of this.sessions) {
      if (info.roomId === roomId && info.playerId === playerId) out.push(sid);
    }
    return out;
  }

  private playerHasOtherSessions(roomId: RoomId, playerId: PlayerId): boolean {
    for (const info of this.sessions.values()) {
      if (info.roomId === roomId && info.playerId === playerId) return true;
    }
    return false;
  }

  private broadcastDelta(roomId: RoomId, delta: RoomDelta, except?: SessionId): Effect[] {
    const message: ServerMessage = { type: "room.delta", roomId, delta };
    return this.sessionsInRoom(roomId, except).map((sessionId) => ({ sessionId, message }));
  }

  private broadcastHandSnapshot(roomId: RoomId, hand: HandState): Effect[] {
    return this.broadcastDelta(roomId, {
      kind: "hand.snapshot",
      hand: toHandView(
        hand,
        this.currentTurnDeadlines.get(roomId) ?? null,
        undefined,
        this.currentHandReveals.get(roomId),
      ),
    });
  }

  // ---------- Turn timer ----------

  private clearTurnTimer(roomId: RoomId): void {
    const t = this.turnTimers.get(roomId);
    if (t) clearTimeout(t);
    this.turnTimers.delete(roomId);
    this.currentTurnDeadlines.delete(roomId);
  }

  private armTurnTimer(roomId: RoomId, hand: HandState): void {
    this.clearTurnTimer(roomId);
    if (hand.street === "complete" || hand.currentSeatIdx === null) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    const turnTimerMs = room.config.turnTimerMs;
    const deadline = Date.now() + turnTimerMs;
    this.currentTurnDeadlines.set(roomId, deadline);
    const timer = setTimeout(() => {
      this.fireTurnExpiry(roomId);
    }, turnTimerMs);
    this.turnTimers.set(roomId, timer);
  }

  private fireTurnExpiry(roomId: RoomId): void {
    this.turnTimers.delete(roomId);
    this.currentTurnDeadlines.delete(roomId);
    const hand = this.hands.get(roomId);
    if (!hand || hand.street === "complete" || hand.currentSeatIdx === null) return;
    const seat = hand.seats[hand.currentSeatIdx];
    if (!seat) return;
    const need = hand.toMatch - seat.committedThisRound;
    const action: Action = need > 0 ? { kind: "fold" } : { kind: "check" };
    const effects = this.applyAndPropagate(roomId, seat.playerId, action);
    this.dispatchAsync(effects);
  }

  // ---------- Disconnect grace + eviction ----------

  private scheduleEviction(roomId: RoomId, playerId: PlayerId): void {
    this.cancelEviction(roomId, playerId);
    let map = this.evictionTimers.get(roomId);
    if (!map) {
      map = new Map();
      this.evictionTimers.set(roomId, map);
    }
    const timer = setTimeout(() => {
      this.evictionTimers.get(roomId)?.delete(playerId);
      const effects = this.evictPlayer(roomId, playerId);
      this.dispatchAsync(effects);
    }, this.disconnectGraceMs);
    map.set(playerId, timer);
  }

  private cancelEviction(roomId: RoomId, playerId: PlayerId): void {
    const map = this.evictionTimers.get(roomId);
    const t = map?.get(playerId);
    if (t) {
      clearTimeout(t);
      map?.delete(playerId);
    }
  }

  /** Drop a player from the room: vacate any seat they hold, remove from player list. */
  private evictPlayer(roomId: RoomId, playerId: PlayerId): Effect[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    // If a session was reattached for this player while the timer was pending, abort.
    if (this.playerHasOtherSessions(roomId, playerId)) return [];
    const effects: Effect[] = [];
    effects.push(...this.vacateSeat(roomId, playerId));
    const r2 = this.rooms.get(roomId);
    if (!r2) return effects;
    let r3 = applyEvent(r2, { kind: "playerLeft", playerId });
    this.rooms.set(roomId, r3);
    effects.push(...this.broadcastDelta(roomId, { kind: "playerLeft", playerId }));

    // If the evicted player was the host, auto-promote a successor so the room is
    // never host-less. Preference: lowest-seat-index seated player, else any
    // other room member.
    if (r3.hostId === playerId) {
      const nextHost = this.pickNextHost(r3, playerId);
      r3 = applyEvent(r3, { kind: "hostChanged", hostId: nextHost });
      this.rooms.set(roomId, r3);
      effects.push(...this.broadcastDelta(roomId, { kind: "hostChanged", hostId: nextHost }));
      if (nextHost) {
        const newName = r3.players.get(nextHost)?.displayName ?? "a player";
        effects.push(...this.emitSystemChat(roomId, `${newName} is now the host.`));
      }
    }
    return effects;
  }

  /**
   * Remove a player from their seat, recording the seat's stack as a cash-out
   * in the ledger. Safe to call when the player isn't seated (no-op). Used by
   * voluntary stand-up, disconnect eviction, and host kick.
   */
  private vacateSeat(roomId: RoomId, playerId: PlayerId): Effect[] {
    let room = this.rooms.get(roomId);
    if (!room) return [];
    const slot = findSeatOf(room, playerId);
    if (slot === -1) return [];
    const seat = room.seats[slot];
    if (!seat || seat.kind !== "taken") return [];
    const effects: Effect[] = [];
    if (seat.stack > 0) {
      room = applyEvent(room, {
        kind: "cashedOutIncreased",
        playerId,
        amount: seat.stack,
      });
      const total = room.cashedOuts.get(playerId) ?? seat.stack;
      effects.push(
        ...this.broadcastDelta(roomId, { kind: "cashedOutUpdated", playerId, cashedOut: total }),
      );
    }
    room = applyEvent(room, { kind: "seatLeft", seatIndex: slot });
    this.rooms.set(roomId, room);
    effects.push(
      ...this.broadcastDelta(roomId, { kind: "seatLeft", seatIndex: slot, playerId }),
    );
    return effects;
  }

  // ---------- Pre-actions ----------

  private clearPreActions(roomId: RoomId): void {
    this.preActions.delete(roomId);
  }

  private queuedPreAction(roomId: RoomId, playerId: PlayerId): PreAction | undefined {
    return this.preActions.get(roomId)?.get(playerId);
  }

  private dropPreAction(roomId: RoomId, playerId: PlayerId): void {
    this.preActions.get(roomId)?.delete(playerId);
  }

  private translatePreAction(
    pre: PreAction,
    hand: HandState,
    seatIdx: number,
  ): Action | null {
    const seat = hand.seats[seatIdx];
    if (!seat) return null;
    const need = hand.toMatch - seat.committedThisRound;
    switch (pre.kind) {
      case "fold":
        return { kind: "fold" };
      case "checkFold":
        return need <= 0 ? { kind: "check" } : { kind: "fold" };
      case "callAny":
        return need <= 0 ? { kind: "check" } : { kind: "call" };
    }
  }

  // ---------- Unified action application ----------

  /**
   * Apply a player action through the engine, broadcast the resulting deltas,
   * arm the next turn timer, then check whether the next actor has a queued
   * pre-action and recursively fire it if so. Returns all the effects to
   * dispatch.
   */
  private applyAndPropagate(roomId: RoomId, playerId: PlayerId, action: Action): Effect[] {
    const hand = this.hands.get(roomId);
    if (!hand) return [];
    const seatIdx = hand.seats.findIndex((s) => s.playerId === playerId);
    if (seatIdx === -1) return [];
    const result = engineApplyAction(hand, seatIdx, action);
    if (!result.ok) return [];
    this.hands.set(roomId, result.state);

    let chipsCommitted = 0;
    let isAllIn = false;
    for (const eff of result.effects) {
      if (eff.kind === "actionTaken" && eff.seatIdx === seatIdx) {
        chipsCommitted = eff.chipsCommitted;
        isAllIn = eff.isAllIn;
      }
    }

    // Update turn timer state BEFORE broadcasting so the snapshot includes the new deadline.
    if (result.state.street === "complete") {
      this.clearTurnTimer(roomId);
      this.clearPreActions(roomId);
    } else {
      this.armTurnTimer(roomId, result.state);
    }

    const effects: Effect[] = [];
    effects.push(
      ...this.broadcastDelta(roomId, {
        kind: "hand.action",
        playerId,
        action,
        chipsCommitted,
        isAllIn,
      }),
    );
    effects.push(...this.broadcastHandSnapshot(roomId, result.state));

    if (result.state.street === "complete") {
      this.finalizeHandReveals(roomId, result.state);
      this.emitHandRecord(roomId, result.state);
      effects.push(...this.applyHandResultToRoom(roomId, result.state));
      effects.push(...this.scheduleNextHand(roomId));
      return effects;
    }

    // Check if the next actor has a queued pre-action and fire it.
    const nextSeatIdx = result.state.currentSeatIdx;
    if (nextSeatIdx !== null) {
      const nextPlayerId = result.state.seats[nextSeatIdx]?.playerId;
      if (nextPlayerId) {
        const queued = this.queuedPreAction(roomId, nextPlayerId);
        if (queued) {
          const translated = this.translatePreAction(queued, result.state, nextSeatIdx);
          this.dropPreAction(roomId, nextPlayerId);
          if (translated) {
            effects.push(...this.applyAndPropagate(roomId, nextPlayerId, translated));
          }
        }
      }
    }

    return effects;
  }

  private sendHoleCardsPrivately(roomId: RoomId, hand: HandState): Effect[] {
    const effects: Effect[] = [];
    for (const seat of hand.seats) {
      if (!seat.holeCards) continue;
      const sessions = this.sessionsForPlayerInRoom(roomId, seat.playerId);
      for (const sid of sessions) {
        effects.push({
          sessionId: sid,
          message: {
            type: "hand.holeCards",
            handId: hand.handId,
            cards: seat.holeCards as [
              import("@felt/shared").Card,
              import("@felt/shared").Card,
            ],
          },
        });
      }
    }
    return effects;
  }

  /** After a hand completes, sync each seated player's stack from the engine result back to room.seats. */
  /**
   * Populate the reveal set for a just-completed hand. Real showdowns (≥2
   * non-folded) auto-reveal every non-folded seat. Fold-arounds leave the set
   * empty; the winner may later opt in via seat.showCards.
   */
  private finalizeHandReveals(roomId: RoomId, hand: HandState): void {
    const nonFolded = hand.seats.filter((s) => !s.isFolded);
    const reveals = new Set<PlayerId>();
    if (nonFolded.length > 1) {
      for (const s of nonFolded) reveals.add(s.playerId);
    }
    this.currentHandReveals.set(roomId, reveals);
  }

  private applyHandResultToRoom(roomId: RoomId, hand: HandState): Effect[] {
    let room = this.rooms.get(roomId);
    if (!room) return [];
    const effects: Effect[] = [];
    for (const handSeat of hand.seats) {
      const slot = findSeatOf(room, handSeat.playerId);
      if (slot === -1) continue;
      const existing = room.seats[slot];
      if (existing?.kind !== "taken") continue;
      const newStack = handSeat.stack;
      const busted = newStack <= 0;
      if (existing.stack === newStack && existing.busted === busted) continue;
      room = applyEvent(room, {
        kind: "seatStackUpdated",
        seatIndex: slot,
        stack: newStack,
        busted,
      });
      this.rooms.set(roomId, room);
      effects.push(
        ...this.broadcastDelta(roomId, {
          kind: "seatStackUpdated",
          seatIndex: slot,
          playerId: handSeat.playerId,
          stack: newStack,
          busted,
        }),
      );
    }
    return effects;
  }

  /** Broadcast nextHandScheduled and arm the timer that fires startNextHand. */
  private scheduleNextHand(roomId: RoomId): Effect[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    if (!room.gameStarted) return [];

    // Cancel any prior timer.
    const existing = this.nextHandTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.nextHandTimers.delete(roomId);
    }

    const eligible = eligibleSeatedSlots(room).length;
    // Either not enough players, host disabled auto-deal, room is paused, or session
    // is ended — broadcast that no next-hand is scheduled so clients hide the countdown.
    if (eligible < 2 || !room.config.autoDealEnabled || room.paused || room.ended) {
      const updated = applyEvent(room, { kind: "nextHandScheduled", at: null });
      this.rooms.set(roomId, updated);
      return this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null });
    }

    const delay = room.config.interHandDelayMs;
    const at = Date.now() + delay;
    const updated = applyEvent(room, { kind: "nextHandScheduled", at });
    this.rooms.set(roomId, updated);

    const timer = setTimeout(() => {
      this.nextHandTimers.delete(roomId);
      const effects = this.startNextHand(roomId);
      this.dispatchAsync(effects);
    }, delay);
    this.nextHandTimers.set(roomId, timer);

    return this.broadcastDelta(roomId, { kind: "nextHandScheduled", at });
  }

  /** Create the next engine hand from current room state. Used by the auto-advance timer. */
  private startNextHand(roomId: RoomId): Effect[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const eligible = eligibleSeatedSlots(room);
    if (eligible.length < 2) {
      // Cancel scheduling — not enough players.
      const cleared = applyEvent(room, { kind: "nextHandScheduled", at: null });
      this.rooms.set(roomId, cleared);
      return this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null });
    }

    // Rotate dealer to the next eligible slot AT or AFTER current nextDealerSlot.
    let dealerSlot = room.nextDealerSlot;
    if (!eligible.includes(dealerSlot)) {
      // Find next eligible slot rotating forward.
      let found = -1;
      for (let step = 0; step < room.seats.length; step++) {
        const candidate = (dealerSlot + step) % room.seats.length;
        if (eligible.includes(candidate)) {
          found = candidate;
          break;
        }
      }
      dealerSlot = found === -1 ? (eligible[0] as number) : found;
    }

    const { startOpts } = buildHandFromRoom(room, randomUUID(), dealerSlot);
    const { state: hand } = startHand(startOpts);
    this.hands.set(roomId, hand);
    this.clearPreActions(roomId);
    this.currentHandReveals.delete(roomId);
    this.armTurnTimer(roomId, hand);

    // Move dealer marker forward for the NEXT hand.
    const after = nextDealerAfter(room, dealerSlot);
    let updated = applyEvent(room, { kind: "nextDealerSlotSet", slot: after });
    updated = applyEvent(updated, { kind: "nextHandScheduled", at: null });
    this.rooms.set(roomId, updated);

    const effects: Effect[] = [];
    effects.push(...this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null }));
    effects.push(...this.broadcastHandSnapshot(roomId, hand));
    effects.push(...this.sendHoleCardsPrivately(roomId, hand));
    return effects;
  }

  handleJoin(args: JoinArgs): Effect[] | IntentError {
    const room = this.rooms.get(args.roomId);
    if (!room) {
      return { error: { code: "room_not_found", message: `Room ${args.roomId} does not exist` } };
    }

    const normalize = (s: string) => s.trim().toLowerCase();
    const incoming = normalize(args.displayName);
    for (const existing of room.players.values()) {
      if (existing.id !== args.playerId && normalize(existing.displayName) === incoming) {
        return {
          error: {
            code: "name_taken",
            message: `Name "${args.displayName.trim()}" is already in use in this room`,
          },
        };
      }
    }

    const player = { id: args.playerId, displayName: args.displayName };
    const wasPresent = room.players.has(args.playerId);
    const updated = applyEvent(room, { kind: "playerJoined", player });
    this.rooms.set(args.roomId, updated);
    this.sessions.set(args.sessionId, { roomId: args.roomId, playerId: args.playerId });

    // Reconnect: cancel any pending eviction so the disconnected player keeps
    // their seat and player record.
    this.cancelEviction(args.roomId, args.playerId);

    const effects: Effect[] = [
      {
        sessionId: args.sessionId,
        message: { type: "room.snapshot", snapshot: this.toSnapshotWithHand(updated) },
      },
    ];

    if (!wasPresent) {
      effects.push(
        ...this.broadcastDelta(args.roomId, { kind: "playerJoined", player }, args.sessionId),
      );
    }

    const activeHand = this.hands.get(args.roomId);
    if (activeHand) {
      const seat = activeHand.seats.find((s) => s.playerId === args.playerId);
      if (seat?.holeCards) {
        effects.push({
          sessionId: args.sessionId,
          message: {
            type: "hand.holeCards",
            handId: activeHand.handId,
            cards: seat.holeCards as [
              import("@felt/shared").Card,
              import("@felt/shared").Card,
            ],
          },
        });
      }
    }

    return effects;
  }

  handleLeave(sessionId: SessionId): Effect[] {
    const info = this.sessions.get(sessionId);
    if (!info) return [];
    this.sessions.delete(sessionId);

    if (this.playerHasOtherSessions(info.roomId, info.playerId)) return [];

    const room = this.rooms.get(info.roomId);
    if (!room) return [];

    const effects: Effect[] = [];
    let next = room;

    // Drop any queued pre-action for this player.
    this.preActions.get(info.roomId)?.delete(info.playerId);

    // If this player is currently seated in an active hand, mark them sitting
    // out in the engine. They keep any uncommitted chips ("all-in for committed"
    // protection) and the hand continues without them. If they reconnect within
    // the grace window they're restored to their seat for the next hand.
    const hand = this.hands.get(info.roomId);
    if (hand && hand.street !== "complete") {
      const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
      const seat = seatIdx === -1 ? undefined : hand.seats[seatIdx];
      if (seat && !seat.isFolded && !seat.sittingOut) {
        const result = engineMarkSittingOut(hand, seatIdx);
        if (result.ok) {
          this.hands.set(info.roomId, result.state);
          if (result.state.street === "complete") {
            this.clearTurnTimer(info.roomId);
            this.clearPreActions(info.roomId);
          } else {
            this.armTurnTimer(info.roomId, result.state);
          }
          effects.push(...this.broadcastHandSnapshot(info.roomId, result.state));
          if (result.state.street === "complete") {
            this.finalizeHandReveals(info.roomId, result.state);
            this.emitHandRecord(info.roomId, result.state);
            effects.push(...this.applyHandResultToRoom(info.roomId, result.state));
            effects.push(...this.scheduleNextHand(info.roomId));
          }
        }
      }
    }

    // Defer seat/player removal until the disconnect grace period expires.
    // If the player reconnects in time, handleJoin cancels the timer and they're
    // restored seamlessly (snapshot includes their seat + private hole cards).
    this.rooms.set(info.roomId, next);
    this.scheduleEviction(info.roomId, info.playerId);

    return effects;
  }

  private dispatchIntent(
    sessionId: SessionId,
    runIntent: (
      state: RoomState,
      info: SessionInfo,
    ) => ReturnType<typeof applyIntent>,
  ): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };

    const result = runIntent(room, info);
    if (!result.ok) return { error: { code: result.code, message: result.message } };

    this.rooms.set(info.roomId, result.state);
    return this.broadcastDelta(info.roomId, result.delta);
  }

  handleSeatTake(
    sessionId: SessionId,
    args: { seatIndex: number; buyIn: number },
  ): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };
    if (room.ended) {
      return { error: { code: "session_ended", message: "Session has ended" } };
    }

    const result = applyIntent(room, {
      kind: "seatTake",
      playerId: info.playerId,
      seatIndex: args.seatIndex,
      buyIn: args.buyIn,
    });
    if (!result.ok) return { error: { code: result.code, message: result.message } };

    // Track the buy-in for the ledger before broadcasting.
    const updated = applyEvent(result.state, {
      kind: "buyInIncreased",
      playerId: info.playerId,
      amount: args.buyIn,
    });
    this.rooms.set(info.roomId, updated);

    const effects: Effect[] = this.broadcastDelta(info.roomId, result.delta);
    effects.push(
      ...this.broadcastDelta(info.roomId, {
        kind: "buyInsUpdated",
        playerId: info.playerId,
        total: updated.buyIns.get(info.playerId) ?? args.buyIn,
      }),
    );
    return effects;
  }

  handleSeatLeave(sessionId: SessionId): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };
    if (findSeatOf(room, info.playerId) === -1) {
      return { error: { code: "not_seated", message: "You are not seated" } };
    }
    return this.vacateSeat(info.roomId, info.playerId);
  }

  handleSeatRebuy(
    sessionId: SessionId,
    args: { amount: number },
  ): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };
    const slot = findSeatOf(room, info.playerId);
    if (slot === -1) return { error: { code: "not_seated", message: "You're not seated" } };
    const seat = room.seats[slot];
    if (seat?.kind !== "taken") return { error: { code: "not_seated", message: "Not seated" } };
    if (!seat.busted) {
      return { error: { code: "not_busted", message: "You're not busted — no rebuy needed" } };
    }
    if (args.amount < room.config.minBuyIn || args.amount > room.config.maxBuyIn) {
      return {
        error: {
          code: "bad_buyin",
          message: `Buy-in must be between ${room.config.minBuyIn} and ${room.config.maxBuyIn}`,
        },
      };
    }
    let updated = applyEvent(room, {
      kind: "seatStackUpdated",
      seatIndex: slot,
      stack: args.amount,
      busted: false,
    });
    updated = applyEvent(updated, {
      kind: "buyInIncreased",
      playerId: info.playerId,
      amount: args.amount,
    });
    this.rooms.set(info.roomId, updated);
    const effects = this.broadcastDelta(info.roomId, {
      kind: "seatStackUpdated",
      seatIndex: slot,
      playerId: info.playerId,
      stack: args.amount,
      busted: false,
    });
    effects.push(
      ...this.broadcastDelta(info.roomId, {
        kind: "buyInsUpdated",
        playerId: info.playerId,
        total: updated.buyIns.get(info.playerId) ?? args.amount,
      }),
    );
    // If the game is on, no active hand is in progress, and we just brought eligible
    // seated count to 2+, schedule the next hand. (A *completed* hand may still sit in
    // this.hands during the inter-hand pause — that doesn't count as active.)
    const activeHand = this.hands.get(info.roomId);
    const handInProgress = activeHand && activeHand.street !== "complete";
    if (
      updated.gameStarted &&
      !handInProgress &&
      !updated.nextHandAt &&
      eligibleSeatedSlots(updated).length >= 2
    ) {
      effects.push(...this.scheduleNextHand(info.roomId));
    }
    return effects;
  }

  handleGameStart(sessionId: SessionId): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };

    const result = applyIntent(room, { kind: "gameStart", playerId: info.playerId });
    if (!result.ok) return { error: { code: result.code, message: result.message } };

    this.rooms.set(info.roomId, result.state);
    const effects: Effect[] = this.broadcastDelta(info.roomId, result.delta);

    // Initial dealer = first seated slot.
    const eligible = eligibleSeatedSlots(result.state);
    const initialDealer = eligible[0] ?? 0;
    let updated = applyEvent(result.state, { kind: "nextDealerSlotSet", slot: initialDealer });
    this.rooms.set(info.roomId, updated);

    const { startOpts } = buildHandFromRoom(updated, randomUUID(), initialDealer);
    const { state: hand } = startHand(startOpts);
    this.hands.set(info.roomId, hand);
    this.clearPreActions(info.roomId);
    this.currentHandReveals.delete(info.roomId);
    this.armTurnTimer(info.roomId, hand);

    // Move dealer marker forward for the NEXT hand.
    const nextDealer = nextDealerAfter(updated, initialDealer);
    updated = applyEvent(updated, { kind: "nextDealerSlotSet", slot: nextDealer });
    this.rooms.set(info.roomId, updated);

    effects.push(...this.broadcastHandSnapshot(info.roomId, hand));
    effects.push(...this.sendHoleCardsPrivately(info.roomId, hand));
    return effects;
  }

  handleChat(sessionId: SessionId, args: { text: string }): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, {
        kind: "chatSend",
        playerId: info.playerId,
        text: args.text,
        chatId: randomUUID(),
        ts: Date.now(),
      }),
    );
  }

  handleHandAction(sessionId: SessionId, action: Action): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const hand = this.hands.get(info.roomId);
    if (!hand) return { error: { code: "no_hand", message: "No active hand in this room" } };

    const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
    if (seatIdx === -1) {
      return { error: { code: "not_in_hand", message: "You are not seated in this hand" } };
    }

    // Validate it's actually their turn before consuming the action via applyAndPropagate
    // (applyAndPropagate uses engineApplyAction which validates, but we want a friendly
    // error code returned synchronously to this caller — engine returns "not_your_turn").
    const result = engineApplyAction(hand, seatIdx, action);
    if (!result.ok) {
      return { error: { code: result.code, message: result.message } };
    }

    // Re-route through applyAndPropagate so timer arming + pre-action propagation happen.
    // Discard the engine result we computed above; applyAndPropagate re-applies.
    return this.applyAndPropagate(info.roomId, info.playerId, action);
  }

  handleUseTimeBank(sessionId: SessionId): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const hand = this.hands.get(info.roomId);
    if (!hand || hand.street === "complete" || hand.currentSeatIdx === null) {
      return { error: { code: "no_hand", message: "No active turn" } };
    }
    const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
    if (seatIdx === -1 || seatIdx !== hand.currentSeatIdx) {
      return { error: { code: "not_your_turn", message: "It's not your turn" } };
    }
    const seat = hand.seats[seatIdx];
    if (!seat) return { error: { code: "bad_seat", message: "Bad seat" } };
    if (seat.timeBankUsed) {
      return { error: { code: "time_bank_used", message: "You've already used your time bank" } };
    }

    // Mark used (mutate engine state — manager-owned bookkeeping field).
    seat.timeBankUsed = true;
    // Cancel current timer; arm a longer one. Total = remaining + timeBankMs.
    const room = this.rooms.get(info.roomId);
    const timeBankMs = room?.config.timeBankMs ?? 30_000;
    const oldDeadline = this.currentTurnDeadlines.get(info.roomId) ?? Date.now();
    const remaining = Math.max(0, oldDeadline - Date.now());
    const newDeadline = Date.now() + remaining + timeBankMs;
    const existing = this.turnTimers.get(info.roomId);
    if (existing) clearTimeout(existing);
    this.currentTurnDeadlines.set(info.roomId, newDeadline);
    const newTimer = setTimeout(() => this.fireTurnExpiry(info.roomId), newDeadline - Date.now());
    this.turnTimers.set(info.roomId, newTimer);

    return this.broadcastHandSnapshot(info.roomId, hand);
  }

  handlePreAction(sessionId: SessionId, preAction: PreAction): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const hand = this.hands.get(info.roomId);
    if (!hand || hand.street === "complete") {
      return { error: { code: "no_hand", message: "No active hand" } };
    }
    const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
    if (seatIdx === -1) {
      return { error: { code: "not_in_hand", message: "You are not in this hand" } };
    }
    if (seatIdx === hand.currentSeatIdx) {
      return { error: { code: "your_turn", message: "It's your turn — act directly" } };
    }
    if (hand.seats[seatIdx]?.isFolded || hand.seats[seatIdx]?.isAllIn) {
      return { error: { code: "cannot_preact", message: "You cannot pre-act in this state" } };
    }
    let map = this.preActions.get(info.roomId);
    if (!map) {
      map = new Map();
      this.preActions.set(info.roomId, map);
    }
    map.set(info.playerId, preAction);
    return [];
  }

  handleCancelPreAction(sessionId: SessionId): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    this.preActions.get(info.roomId)?.delete(info.playerId);
    return [];
  }

  /**
   * The fold-around winner of the just-completed hand opts to reveal their cards.
   * Only valid while the hand is still in the "complete" inter-hand window — once
   * the next hand starts, the reveal window closes. For v1, showOneShowBoth is
   * implicitly true: showing always reveals both cards.
   */
  handleShowCards(sessionId: SessionId): Effect[] | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const hand = this.hands.get(info.roomId);
    if (!hand || hand.street !== "complete") {
      return { error: { code: "cannot_show", message: "No completed hand to show for" } };
    }
    const mySeat = hand.seats.find((s) => s.playerId === info.playerId);
    if (!mySeat) {
      return { error: { code: "not_in_hand", message: "You weren't in this hand" } };
    }
    if (mySeat.isFolded) {
      return { error: { code: "cannot_show", message: "Folded hands cannot reveal" } };
    }
    const reveals = this.currentHandReveals.get(info.roomId) ?? new Set<PlayerId>();
    if (reveals.has(info.playerId)) {
      // Already revealed (auto, via multi-seat showdown, or via a prior show).
      return [];
    }
    reveals.add(info.playerId);
    this.currentHandReveals.set(info.roomId, reveals);
    return this.broadcastHandSnapshot(info.roomId, hand);
  }

  // ---------- Host actions (Phase 10) ----------

  /** Emit a server-authored chat entry; appears in the chat panel with a system style. */
  private emitSystemChat(roomId: RoomId, text: string): Effect[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    const message = {
      id: randomUUID(),
      playerId: "system" as PlayerId,
      displayName: "System",
      text,
      ts: Date.now(),
      system: true,
    };
    const updated = applyEvent(room, { kind: "chatMessage", message });
    this.rooms.set(roomId, updated);
    return this.broadcastDelta(roomId, { kind: "chat", message });
  }

  private requireHost(sessionId: SessionId): { room: RoomState; roomId: RoomId } | IntentError {
    const info = this.sessions.get(sessionId);
    if (!info) return { error: { code: "no_session", message: "Session has not joined a room" } };
    const room = this.rooms.get(info.roomId);
    if (!room) return { error: { code: "room_not_found", message: "Room no longer exists" } };
    if (room.hostId !== info.playerId) {
      return { error: { code: "not_host", message: "Only the host can do that" } };
    }
    return { room, roomId: info.roomId };
  }

  handleHostPause(sessionId: SessionId): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;
    if (room.paused) return { error: { code: "already_paused", message: "Room is already paused" } };

    let updated = applyEvent(room, { kind: "pausedChanged", paused: true });
    this.rooms.set(roomId, updated);
    const effects: Effect[] = this.broadcastDelta(roomId, { kind: "pausedChanged", paused: true });

    // Cancel any pending next-hand timer; broadcast the change so clients hide the countdown.
    const existing = this.nextHandTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.nextHandTimers.delete(roomId);
    }
    if (updated.nextHandAt !== null) {
      updated = applyEvent(updated, { kind: "nextHandScheduled", at: null });
      this.rooms.set(roomId, updated);
      effects.push(...this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null }));
    }
    effects.push(...this.emitSystemChat(roomId, "Host paused the room."));
    return effects;
  }

  handleHostKick(
    sessionId: SessionId,
    args: { playerId: PlayerId },
  ): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;
    const target = args.playerId;
    if (!room.players.has(target)) {
      return { error: { code: "unknown_player", message: "That player is not in the room" } };
    }
    if (target === room.hostId) {
      return {
        error: {
          code: "cannot_kick_host",
          message: "Transfer host before kicking yourself",
        },
      };
    }

    const effects: Effect[] = [];

    // If they're mid-hand, fold their seat first so the hand can advance.
    const hand = this.hands.get(roomId);
    if (hand && hand.street !== "complete") {
      const seatIdx = hand.seats.findIndex((s) => s.playerId === target);
      if (seatIdx !== -1 && !hand.seats[seatIdx]?.isFolded) {
        const result = engineForceFold(hand, seatIdx);
        if (result.ok) {
          this.hands.set(roomId, result.state);
          if (result.state.street === "complete") {
            this.clearTurnTimer(roomId);
            this.clearPreActions(roomId);
          } else {
            this.armTurnTimer(roomId, result.state);
          }
          effects.push(...this.broadcastHandSnapshot(roomId, result.state));
          if (result.state.street === "complete") {
            this.emitHandRecord(roomId, result.state);
            effects.push(...this.applyHandResultToRoom(roomId, result.state));
            effects.push(...this.scheduleNextHand(roomId));
          }
        }
      }
    }

    // Look up the kicked player's display name (for the system chat) and active sessions
    // (to deliver a "kicked" notice and remove their session→room mapping).
    const kickedName = room.players.get(target)?.displayName ?? "Someone";
    const hostName = room.players.get(room.hostId ?? "")?.displayName ?? "Host";
    const targetSessions: SessionId[] = [];
    for (const [sid, info] of this.sessions.entries()) {
      if (info.roomId === roomId && info.playerId === target) targetSessions.push(sid);
    }
    for (const sid of targetSessions) {
      effects.push({
        sessionId: sid,
        message: { type: "error", code: "kicked", message: `You were kicked by ${hostName}.` },
      });
    }

    effects.push(...this.vacateSeat(roomId, target));
    // Also remove from the room's player list — kick is a full removal.
    const r2 = this.rooms.get(roomId);
    if (r2) {
      const r3 = applyEvent(r2, { kind: "playerLeft", playerId: target });
      this.rooms.set(roomId, r3);
      effects.push(...this.broadcastDelta(roomId, { kind: "playerLeft", playerId: target }));
    }
    // Cancel any pending eviction timer for them (defensive — they may have just disconnected).
    const evictMap = this.evictionTimers.get(roomId);
    const pendingEvict = evictMap?.get(target);
    if (pendingEvict) {
      clearTimeout(pendingEvict);
      evictMap?.delete(target);
    }
    // Drop their sessions so future client messages from them fail cleanly.
    for (const sid of targetSessions) this.sessions.delete(sid);

    effects.push(...this.emitSystemChat(roomId, `${hostName} kicked ${kickedName}.`));
    return effects;
  }

  handleHostResume(sessionId: SessionId): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;
    if (!room.paused) return { error: { code: "not_paused", message: "Room is not paused" } };

    const updated = applyEvent(room, { kind: "pausedChanged", paused: false });
    this.rooms.set(roomId, updated);
    const effects: Effect[] = this.broadcastDelta(roomId, { kind: "pausedChanged", paused: false });
    effects.push(...this.emitSystemChat(roomId, "Host resumed the room."));

    // If a hand isn't currently in progress and the game has started, schedule the next one.
    const hand = this.hands.get(roomId);
    const handInProgress = hand && hand.street !== "complete";
    if (updated.gameStarted && !handInProgress) {
      effects.push(...this.scheduleNextHand(roomId));
    }
    return effects;
  }

  handleHostUpdateSettings(
    sessionId: SessionId,
    settings: Partial<RoomConfig>,
  ): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;

    // Reuse the same validator as room creation.
    const validation = validateRoomSettings(settings);
    if (!validation.ok) {
      return { error: { code: "bad_settings", message: validation.error } };
    }
    // Compose the merged target config against the current values (not defaults), so
    // partial updates leave other fields alone.
    const merged = { ...room.config, ...validation.settings };
    // Re-run the validator against the merged shape so cross-field invariants
    // (e.g. new bigBlind > existing minBuyIn) are caught.
    const mergedValidation = validateRoomSettings(merged);
    if (!mergedValidation.ok) {
      return { error: { code: "bad_settings", message: mergedValidation.error } };
    }

    const prevAutoDeal = room.config.autoDealEnabled;
    const nextAutoDeal = merged.autoDealEnabled;

    const updated = applyEvent(room, { kind: "configReplaced", config: merged });
    this.rooms.set(roomId, updated);
    const publicConfig: RoomConfig = {
      maxSeats: merged.maxSeats,
      minBuyIn: merged.minBuyIn,
      maxBuyIn: merged.maxBuyIn,
      startingStack: merged.startingStack,
      smallBlind: merged.smallBlind,
      bigBlind: merged.bigBlind,
      turnTimerMs: merged.turnTimerMs,
      timeBankMs: merged.timeBankMs,
      interHandDelayMs: merged.interHandDelayMs,
      autoDealEnabled: merged.autoDealEnabled,
      showOneShowBoth: merged.showOneShowBoth,
    };
    const effects: Effect[] = this.broadcastDelta(roomId, {
      kind: "configUpdated",
      config: publicConfig,
    });
    effects.push(...this.emitSystemChat(roomId, "Host updated room settings."));

    // Auto-deal toggle affects the inter-hand timer.
    if (prevAutoDeal && !nextAutoDeal) {
      // Turning off: cancel any pending next-hand timer.
      const existing = this.nextHandTimers.get(roomId);
      if (existing) {
        clearTimeout(existing);
        this.nextHandTimers.delete(roomId);
      }
      if (updated.nextHandAt !== null) {
        const r2 = applyEvent(updated, { kind: "nextHandScheduled", at: null });
        this.rooms.set(roomId, r2);
        effects.push(...this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null }));
      }
    } else if (!prevAutoDeal && nextAutoDeal) {
      // Turning on: if a hand isn't in progress and the game has started, schedule one.
      const hand = this.hands.get(roomId);
      const handInProgress = hand && hand.street !== "complete";
      if (updated.gameStarted && !handInProgress && !updated.paused && !updated.ended) {
        effects.push(...this.scheduleNextHand(roomId));
      }
    }
    return effects;
  }

  handleHostTransfer(
    sessionId: SessionId,
    args: { playerId: PlayerId },
  ): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;
    if (args.playerId === room.hostId) {
      return { error: { code: "already_host", message: "Already the host" } };
    }
    if (!room.players.has(args.playerId)) {
      return { error: { code: "unknown_player", message: "That player is not in the room" } };
    }
    const oldName = room.players.get(room.hostId ?? "")?.displayName ?? "Host";
    const newName = room.players.get(args.playerId)?.displayName ?? "the new host";
    const updated = applyEvent(room, { kind: "hostChanged", hostId: args.playerId });
    this.rooms.set(roomId, updated);
    const effects: Effect[] = this.broadcastDelta(roomId, {
      kind: "hostChanged",
      hostId: args.playerId,
    });
    effects.push(...this.emitSystemChat(roomId, `${oldName} transferred host to ${newName}.`));
    return effects;
  }

  /**
   * Pick the next host after an old one is gone. Preference order: the player
   * at the lowest non-empty seat index, falling back to any other player in
   * the room. Returns null if no candidate exists.
   */
  private pickNextHost(room: RoomState, excluding: PlayerId | null): PlayerId | null {
    for (let i = 0; i < room.seats.length; i++) {
      const seat = room.seats[i];
      if (seat?.kind === "taken" && seat.playerId !== excluding) return seat.playerId;
    }
    for (const id of room.players.keys()) {
      if (id !== excluding) return id;
    }
    return null;
  }

  handleHostEndSession(sessionId: SessionId): Effect[] | IntentError {
    const auth = this.requireHost(sessionId);
    if ("error" in auth) return auth;
    const { room, roomId } = auth;
    if (room.ended) return { error: { code: "already_ended", message: "Session already ended" } };

    const updated = applyEvent(room, { kind: "sessionEnded" });
    this.rooms.set(roomId, updated);
    const effects: Effect[] = this.broadcastDelta(roomId, { kind: "sessionEnded" });

    // Cancel any pending next-hand timer; the session won't schedule new hands.
    const existing = this.nextHandTimers.get(roomId);
    if (existing) {
      clearTimeout(existing);
      this.nextHandTimers.delete(roomId);
    }

    effects.push(...this.emitSystemChat(roomId, "Host ended the session."));
    return effects;
  }

  // ---------- Hand history (Phase 8) ----------

  /** Construct a HandRecord for a completed hand, suitable for persistence. */
  private buildHandRecord(roomId: RoomId, hand: HandState): HandRecord | null {
    const room = this.rooms.get(roomId);
    if (!room || !hand.result) return null;

    const seats = hand.seats.map((s) => ({
      seatIdx: s.idx,
      playerId: s.playerId,
      displayName: room.players.get(s.playerId)?.displayName ?? s.playerId,
      startingStack: s.startingStack,
      holeCards: s.holeCards,
      isFolded: s.isFolded,
    }));

    const revealed = this.currentHandReveals.get(roomId) ?? new Set<PlayerId>();
    return {
      handId: hand.handId,
      roomId,
      completedAt: Date.now(),
      seed: hand.seed,
      seedHash: sha256Hex(hand.seed),
      blinds: { sb: hand.config.sb, bb: hand.config.bb },
      dealerSeatIdx: hand.dealerIdx,
      seats,
      board: hand.board.slice(),
      actionLog: hand.actionLog as HandLogEntryView[],
      result: {
        awards: hand.result.awards.map((a) => ({
          amount: a.amount,
          winners: a.winners.map((w) => ({
            playerId: hand.seats[w.seatIdx]?.playerId ?? "",
            amount: w.amount,
            handName: w.handName,
            handDescr: w.handDescr,
          })),
        })),
        finalStacks: hand.seats.map((s) => ({ playerId: s.playerId, stack: s.stack })),
      },
      revealedPlayerIds: [...revealed],
    };
  }

  private emitHandRecord(roomId: RoomId, hand: HandState): void {
    if (!this.handSink) return;
    const rec = this.buildHandRecord(roomId, hand);
    if (rec) this.handSink(rec);
  }

  // ---------- Snapshot + restore (Phase 7) ----------

  /** Build a persistable snapshot for a single room. */
  getSnapshotBlob(roomId: RoomId): RoomSnapshotBlob | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const hand = this.hands.get(roomId) ?? null;
    const currentTurnDeadline = this.currentTurnDeadlines.get(roomId) ?? null;
    const preActions: Array<[PlayerId, PreAction]> = [];
    const map = this.preActions.get(roomId);
    if (map) {
      for (const [playerId, pre] of map) preActions.push([playerId, pre]);
    }
    return { version: 1, room, hand, currentTurnDeadline, preActions };
  }

  /** Build snapshots for every live room. Used by the periodic save loop. */
  getAllSnapshotBlobs(): RoomSnapshotBlob[] {
    const out: RoomSnapshotBlob[] = [];
    for (const roomId of this.rooms.keys()) {
      const blob = this.getSnapshotBlob(roomId);
      if (blob) out.push(blob);
    }
    return out;
  }

  /**
   * Hydrate this manager from a list of persisted blobs (e.g., on server boot).
   * No sessions exist post-restart, so an eviction timer is started for every
   * player — they have until disconnectGraceMs to reconnect or be dropped.
   * Active hand turn timers are re-armed with a fresh full duration; the
   * previous deadline is discarded since it may already be in the past.
   */
  restoreFromSnapshots(blobs: RoomSnapshotBlob[]): void {
    for (const blob of blobs) {
      const roomId = blob.room.roomId;
      // Backfill defaults for fields introduced after a snapshot was first written.
      const restored: RoomState = {
        ...blob.room,
        paused: blob.room.paused ?? false,
        ended: blob.room.ended ?? false,
      };
      this.rooms.set(roomId, restored);
      if (blob.hand) {
        this.hands.set(roomId, blob.hand);
        if (blob.hand.street !== "complete" && blob.hand.currentSeatIdx !== null) {
          this.armTurnTimer(roomId, blob.hand);
        }
      }
      if (blob.preActions.length > 0) {
        const map = new Map<PlayerId, PreAction>();
        for (const [pid, pre] of blob.preActions) map.set(pid, pre);
        this.preActions.set(roomId, map);
      }
      // Schedule eviction for every player — they're effectively disconnected
      // until they re-join. Reconnect cancels their timer.
      for (const playerId of blob.room.players.keys()) {
        this.scheduleEviction(roomId, playerId);
      }
    }
  }
}
