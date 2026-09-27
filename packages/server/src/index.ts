import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { applyAction, join, leave, send, type Client } from "./rooms";
import { parseClientMessage } from "./validate";

const port = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port });

wss.on("listening", () => {
  console.log(`[server] loaded, listening on ws://localhost:${port}`);
});

wss.on("connection", (socket, req) => {
  const client: Client = { id: randomUUID().slice(0, 8), socket, roomId: null };
  const addr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`[server] client ${client.id} connected from ${addr} (clients: ${wss.clients.size})`);

  socket.on("message", (data) => {
    const msg = parseClientMessage(data.toString());
    if (!msg) {
      console.log(`[server] client ${client.id} sent an invalid message, ignored:`, data.toString().slice(0, 200));
      return;
    }

    switch (msg.type) {
      case "ping":
        // Pings arrive every 20s per tab as keepalives, so answer without logging.
        send(client, { type: "pong", t0: msg.t0, ts: Date.now() });
        return;
      case "join":
        join(client, msg.roomId, msg.content);
        return;
      case "action":
        applyAction(client, msg.action, msg.position);
        return;
      case "status":
      case "content":
        console.log(`[server] client ${client.id} sent ${msg.type}, not handled yet`);
        return;
    }
  });

  socket.on("close", (code) => {
    leave(client);
    console.log(`[server] client ${client.id} disconnected code=${code} (clients: ${wss.clients.size})`);
  });
});
