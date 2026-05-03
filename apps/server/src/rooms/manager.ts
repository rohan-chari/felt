import { randomUUID } from "node:crypto";
import {
  applyAction as engineApplyAction,
  forceFold as engineForceFold,
  type HandState,
  startHand,
} from "@felt/engine";
import type { Action, PlayerId, RoomDelta, RoomId, ServerMessage } from "@felt/shared";
import { buildHandFromRoom, toHandView } from "./hand.js";
import {
  applyEvent,
  applyIntent,
  createRoom,
  type RoomState,
  toSnapshot as roomToSnapshot,
} from "./room.js";

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
const INTER_HAND_DELAY_MS = 4000;

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
  private rooms = new Map<RoomId, RoomState>();
  private sessions = new Map<SessionId, SessionInfo>();
  private hands = new Map<RoomId, HandState>();
  private nextHandTimers = new Map<RoomId, ReturnType<typeof setTimeout>>();
  private dispatcher: ((effects: Effect[]) => void) | null = null;

  /** Server registers a callback the manager uses to dispatch async effects (e.g., timer-fired hand starts). */
  setDispatcher(fn: (effects: Effect[]) => void): void {
    this.dispatcher = fn;
  }

  private dispatchAsync(effects: Effect[]): void {
    if (this.dispatcher && effects.length > 0) this.dispatcher(effects);
  }

  createRoom(): RoomId {
    let id = generateRoomId();
    while (this.rooms.has(id)) id = generateRoomId();
    this.rooms.set(id, createRoom(id));
    return id;
  }

  hasRoom(roomId: RoomId): boolean {
    return this.rooms.has(roomId);
  }

  getHand(roomId: RoomId): HandState | undefined {
    return this.hands.get(roomId);
  }

  private toSnapshotWithHand(room: RoomState) {
    const snap = roomToSnapshot(room);
    const hand = this.hands.get(room.roomId);
    if (hand) snap.hand = toHandView(hand);
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
    return this.broadcastDelta(roomId, { kind: "hand.snapshot", hand: toHandView(hand) });
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
    if (eligible < 2) {
      const updated = applyEvent(room, { kind: "nextHandScheduled", at: null });
      this.rooms.set(roomId, updated);
      return this.broadcastDelta(roomId, { kind: "nextHandScheduled", at: null });
    }

    const at = Date.now() + INTER_HAND_DELAY_MS;
    const updated = applyEvent(room, { kind: "nextHandScheduled", at });
    this.rooms.set(roomId, updated);

    const timer = setTimeout(() => {
      this.nextHandTimers.delete(roomId);
      const effects = this.startNextHand(roomId);
      this.dispatchAsync(effects);
    }, INTER_HAND_DELAY_MS);
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

    // If this player is currently seated in an active hand, force-fold them in the engine.
    const hand = this.hands.get(info.roomId);
    if (hand && hand.street !== "complete") {
      const seatIdx = hand.seats.findIndex((s) => s.playerId === info.playerId);
      if (seatIdx !== -1 && !hand.seats[seatIdx]?.isFolded) {
        const result = engineForceFold(hand, seatIdx);
        if (result.ok) {
          this.hands.set(info.roomId, result.state);
          effects.push(...this.broadcastHandSnapshot(info.roomId, result.state));
          if (result.state.street === "complete") {
            effects.push(...this.applyHandResultToRoom(info.roomId, result.state));
            effects.push(...this.scheduleNextHand(info.roomId));
          }
        }
      }
    }

    // Vacate the room seat (if any) and remove the player from the player list.
    const slot = findSeatOf(next, info.playerId);
    if (slot !== -1) {
      next = applyEvent(next, { kind: "seatLeft", seatIndex: slot });
      effects.push(...this.broadcastDelta(info.roomId, { kind: "seatLeft", seatIndex: slot, playerId: info.playerId }));
    }
    next = applyEvent(next, { kind: "playerLeft", playerId: info.playerId });
    effects.push(...this.broadcastDelta(info.roomId, { kind: "playerLeft", playerId: info.playerId }));
    this.rooms.set(info.roomId, next);

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
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, {
        kind: "seatTake",
        playerId: info.playerId,
        seatIndex: args.seatIndex,
        buyIn: args.buyIn,
      }),
    );
  }

  handleSeatLeave(sessionId: SessionId): Effect[] | IntentError {
    return this.dispatchIntent(sessionId, (state, info) =>
      applyIntent(state, { kind: "seatLeave", playerId: info.playerId }),
    );
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
    const updated = applyEvent(room, {
      kind: "seatStackUpdated",
      seatIndex: slot,
      stack: args.amount,
      busted: false,
    });
    this.rooms.set(info.roomId, updated);
    const effects = this.broadcastDelta(info.roomId, {
      kind: "seatStackUpdated",
      seatIndex: slot,
      playerId: info.playerId,
      stack: args.amount,
      busted: false,
    });
    // If the game is on and we just brought eligible seated count to 2+, schedule next hand.
    if (
      updated.gameStarted &&
      !this.hands.get(info.roomId) &&
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

    const result = engineApplyAction(hand, seatIdx, action);
    if (!result.ok) {
      return { error: { code: result.code, message: result.message } };
    }
    this.hands.set(info.roomId, result.state);

    const effects: Effect[] = [];
    let chipsCommitted = 0;
    let isAllIn = false;
    for (const eff of result.effects) {
      if (eff.kind === "actionTaken" && eff.seatIdx === seatIdx) {
        chipsCommitted = eff.chipsCommitted;
        isAllIn = eff.isAllIn;
      }
    }
    effects.push(
      ...this.broadcastDelta(info.roomId, {
        kind: "hand.action",
        playerId: info.playerId,
        action,
        chipsCommitted,
        isAllIn,
      }),
    );
    effects.push(...this.broadcastHandSnapshot(info.roomId, result.state));

    // If hand just completed, sync stacks back to room and schedule next hand.
    if (result.state.street === "complete") {
      effects.push(...this.applyHandResultToRoom(info.roomId, result.state));
      effects.push(...this.scheduleNextHand(info.roomId));
    }

    return effects;
  }
}
