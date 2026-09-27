import type { ContentToBackground, PortName } from "../messages";
import { ServerConnection } from "./connection";

console.log("[background] service worker loaded");

// Listeners must be registered synchronously at startup so Chrome can wake
// the service worker for them.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ("player" satisfies PortName)) return;

  const tab = port.sender?.tab;
  const label = `tab ${tab?.id ?? "?"}`;
  console.log(`[background] ${label} connected: ${tab?.url ?? "unknown url"}`);

  // Each tab is its own client on the server.
  const server = new ServerConnection(label, (msg) => {
    if (msg.type === "pong") {
      console.log(`[background] ${label} pong, round trip ${Date.now() - msg.t0}ms`);
    } else {
      console.log(`[background] ${label} server message:`, msg);
    }
  });

  port.onMessage.addListener((msg: ContentToBackground) => {
    if (msg.type === "player-event") {
      console.log(`[background] ${label} ${msg.event.type} at ${msg.event.position.toFixed(2)}s`);
      server.send({ type: "action", action: msg.event.type, position: msg.event.position });
    }
  });

  port.onDisconnect.addListener(() => {
    console.log(`[background] ${label} disconnected`);
    server.close();
  });
});
