import type { ClientMessage, ServerMessage } from "@felt/shared";
import { useEffect, useReducer } from "react";
import { wsUrl } from "../api";
import { applyServerMessage, initialRoomViewState, type RoomViewState } from "./state";

type Action = { kind: "message"; msg: ServerMessage } | { kind: "reset" };

function reducer(state: RoomViewState, action: Action): RoomViewState {
  if (action.kind === "reset") return initialRoomViewState;
  return applyServerMessage(state, action.msg);
}

export function useRoomConnection(args: {
  roomId: string;
  playerId: string;
  displayName: string;
  enabled: boolean;
}): RoomViewState {
  const [state, dispatch] = useReducer(reducer, initialRoomViewState);

  useEffect(() => {
    if (!args.enabled) return;
    dispatch({ kind: "reset" });

    const ws = new WebSocket(wsUrl("/ws"));

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
      ws.close();
    };
  }, [args.enabled, args.roomId, args.playerId, args.displayName]);

  return state;
}
