import type { ClientMessage, ServerMessage } from "@felt/shared";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { wsUrl } from "../api";
import { applyServerMessage, initialRoomViewState, type RoomViewState } from "./state";

type Action =
  | { kind: "message"; msg: ServerMessage }
  | { kind: "reset" }
  | { kind: "clearTransientError" }
  | { kind: "clearReplay" }
  | { kind: "pushTransientError"; code: string; message: string; tone: "error" | "info" };

function reducer(state: RoomViewState, action: Action): RoomViewState {
  if (action.kind === "reset") return initialRoomViewState;
  if (action.kind === "clearTransientError") return { ...state, transientError: null };
  if (action.kind === "clearReplay") return { ...state, replay: null };
  if (action.kind === "pushTransientError") {
    return {
      ...state,
      transientError: {
        code: action.code,
        message: action.message,
        seq: (state.transientError?.seq ?? 0) + 1,
        tone: action.tone,
      },
    };
  }
  return applyServerMessage(state, action.msg);
}

export type RoomConnection = {
  view: RoomViewState;
  send: (msg: ClientMessage) => void;
  clearTransientError: () => void;
  clearReplay: () => void;
  pushTransientError: (code: string, message: string, tone?: "error" | "info") => void;
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

  const clearTransientError = useCallback(() => {
    dispatch({ kind: "clearTransientError" });
  }, []);

  const clearReplay = useCallback(() => {
    dispatch({ kind: "clearReplay" });
  }, []);

  const pushTransientError = useCallback(
    (code: string, message: string, tone: "error" | "info" = "error") => {
      dispatch({ kind: "pushTransientError", code, message, tone });
    },
    [],
  );

  return { view, send, clearTransientError, clearReplay, pushTransientError };
}
