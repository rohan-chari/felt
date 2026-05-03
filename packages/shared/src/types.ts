export type RoomId = string;
export type PlayerId = string;

export type Player = {
  id: PlayerId;
  displayName: string;
};

export type RoomSnapshot = {
  roomId: RoomId;
  players: Player[];
};
