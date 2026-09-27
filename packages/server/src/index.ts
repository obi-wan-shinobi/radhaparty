import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { applyAction, join, leave, send, type Client } from "./rooms";
import { parseClientMessage } from "./validate";

const port = Number(process.env.PORT ?? 8787);

// Our largest message (a join with a long title ID) is well under 1 KB.
// The ws default is 100 MB.
const MAX_MESSAGE_BYTES = 4096;

// Browsers send an Origin header with WebSocket connections, so this stops
// ordinary websites from using the server through their visitors' browsers.
// Unpacked extensions get a different ID on each machine, so any extension
// origin is allowed. Clients without an Origin (scripts, tests) are allowed:
// they could send any header they like anyway.
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Hosting platforms check this URL to know the server is up. Every other
// plain HTTP request gets a 404; WebSocket upgrades are handled by wss.
const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({ origin }: { origin: string | undefined }) => {
    if (isAllowedOrigin(origin)) return true;
    console.log(`[server] rejected connection from origin ${origin}`);
    return false;
  },
});

http.listen(port, () => {
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

  // ws emits "error" for oversized or malformed frames, then closes the
  // socket. Without a listener, Node treats the error as fatal and the whole
  // server exits, so one bad client could take every room down.
  socket.on("error", (err) => {
    console.log(`[server] client ${client.id} error: ${err.message}`);
  });

  socket.on("close", (code) => {
    leave(client);
    console.log(`[server] client ${client.id} disconnected code=${code} (clients: ${wss.clients.size})`);
  });
});
