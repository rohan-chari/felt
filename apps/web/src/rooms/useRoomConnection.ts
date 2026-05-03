import type { ClientMessage, ServerMessage } from "@felt/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { wsUrl } from "../api";
import { applyServerMessage, initialRoomViewState, type RoomViewState } from "./state";

type Action = { kind: "message"; msg: ServerMessage } | { kind: "reset" };

function reducer(state: RoomViewState, action: Action): RoomViewState {
  if (action.kind === "reset") return initialRoomViewState;
  return applyServerMessage(state, action.msg);
}

export type RoomConnection = {
  view: RoomViewState;
  send: (msg: ClientMessage) => void;
};

export function useRoomConnection(args: {
  roomId: string;
  playerId: string;
  displayName: string;
  enabled: boolean;
}): RoomConnection {
  const [view, dispatch] = useReducer(reducer, initialRoomViewState);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!args.enabled) return;
    dispatch({ kind: "reset" });

    const ws = new WebSocket(wsUrl("/ws"));
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      const msg: ClientMessage = {
        type: "room.join",
        roomId: args.roomId,
        playerId: args.playerId,
        displayName: args.displayName,
      };
      ws.send(JSON.stringify(msg));
    });

    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as ServerMessage;
        dispatch({ kind: "message", msg: parsed });
      } catch {
        // ignore malformed
      }
    });

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [args.enabled, args.roomId, args.playerId, args.displayName]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  return { view, send };
}
