import { WebSocketServer } from "ws";
import type { ClientMessage } from "@radhaparty/shared";

const port = Number(process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port });

wss.on("listening", () => {
  console.log(`[server] loaded, listening on ws://localhost:${port}`);
});

wss.on("connection", (socket, req) => {
  const addr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
  console.log(`[server] connected ${addr} (clients: ${wss.clients.size})`);

  socket.on("message", (data) => {
    // Parsed for logging only. No validation or handling yet.
    let msg: ClientMessage | string;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      msg = data.toString();
    }
    console.log(`[server] message from ${addr}:`, msg);
  });

  socket.on("close", (code) => {
    console.log(`[server] disconnected ${addr} code=${code} (clients: ${wss.clients.size})`);
  });
});
