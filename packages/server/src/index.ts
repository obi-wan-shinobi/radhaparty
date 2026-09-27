import { WebSocketServer } from "ws";
import type { ClientMessage, ServerMessage } from "@radhaparty/shared";

const port = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port });

wss.on("listening", () => {
  console.log(`[server] loaded, listening on ws://localhost:${port}`);
});

wss.on("connection", (socket, req) => {
  const addr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`[server] connected ${addr} (clients: ${wss.clients.size})`);

  socket.on("message", (data) => {
    // No validation yet.
    let msg: ClientMessage | string;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      msg = data.toString();
    }

    // Pings arrive every 20s per tab as keepalives, so answer without logging.
    if (typeof msg !== "string" && msg.type === "ping") {
      const pong: ServerMessage = { type: "pong", t0: msg.t0, ts: Date.now() };
      socket.send(JSON.stringify(pong));
      return;
    }

    console.log(`[server] message from ${addr}:`, msg);
  });

  socket.on("close", (code) => {
    console.log(`[server] disconnected ${addr} code=${code} (clients: ${wss.clients.size})`);
  });
});
