import type { WebSocket } from "ws";
import type { ContentRef, RoomState, ServerMessage } from "@radhaparty/shared";

export type Client = { id: string; socket: WebSocket; roomId: string | null };

type Room = { state: RoomState; clients: Set<Client> };

const rooms = new Map<string, Room>();

export function send(client: Client, msg: ServerMessage): void {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(msg));
  }
}

function broadcast(room: Room): void {
  const msg: ServerMessage = { type: "state", state: room.state };
  for (const client of room.clients) send(client, msg);
}

function describe(state: RoomState): string {
  return `#${state.seq} ${state.playing ? "playing" : "paused"} at ${state.position.toFixed(2)}s`;
}

// Puts the client in a room, creating the room if needed, and sends the
// client the current state. Joining another room leaves the current one.
export function join(client: Client, roomId: string, content: ContentRef): void {
  leave(client);

  let room = rooms.get(roomId);
  if (!room) {
    room = {
      state: {
        roomId,
        content,
        playing: false,
        position: 0,
        updatedAt: Date.now(),
        seq: 0,
        waiting: [],
      },
      clients: new Set(),
    };
    rooms.set(roomId, room);
    console.log(`[server] room ${roomId} created for ${content.service}:${content.titleId}`);
  } else if (
    room.state.content.service !== content.service ||
    room.state.content.titleId !== content.titleId
  ) {
    // Handled later, when viewers can change what the room is watching.
    console.log(`[server] client ${client.id} joined room ${roomId} with different content`);
  }

  room.clients.add(client);
  client.roomId = roomId;
  console.log(`[server] client ${client.id} joined room ${roomId} (${room.clients.size} in room)`);
  send(client, { type: "state", state: room.state });
}

export function leave(client: Client): void {
  if (!client.roomId) return;
  const roomId = client.roomId;
  client.roomId = null;

  const room = rooms.get(roomId);
  if (!room) return;
  room.clients.delete(client);
  console.log(`[server] client ${client.id} left room ${roomId} (${room.clients.size} in room)`);
  if (room.clients.size === 0) {
    rooms.delete(roomId);
    console.log(`[server] room ${roomId} deleted`);
  }
}

// Applies a play, pause, or seek to the client's room and sends the new
// state to everyone in it, including the sender.
export function applyAction(
  client: Client,
  action: "play" | "pause" | "seek",
  position: number,
): void {
  const room = client.roomId ? rooms.get(client.roomId) : undefined;
  if (!room) {
    console.log(`[server] client ${client.id} sent ${action} without joining a room, ignored`);
    return;
  }

  const state = room.state;
  if (action === "play") state.playing = true;
  if (action === "pause") state.playing = false;
  // A seek keeps the current playing state.
  state.position = position;
  state.updatedAt = Date.now();
  state.seq += 1;

  console.log(`[server] room ${state.roomId} ${action} by ${client.id}: ${describe(state)}`);
  broadcast(room);
}
