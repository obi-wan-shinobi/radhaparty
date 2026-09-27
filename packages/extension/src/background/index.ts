import type { ContentRef } from "@radhaparty/shared";
import type { ContentToBackground, PortName } from "../messages";
import { ServerConnection } from "./connection";

console.log("[background] service worker loaded");

// Until the popup can create and join rooms, every tab joins this one.
const DEV_ROOM = "dev";

// Placeholder until the per-site adapters can read the real title and
// episode IDs from the page.
function contentFromUrl(url: string | undefined): ContentRef {
  const { hostname, pathname } = new URL(url ?? "http://unknown/");
  const service =
    hostname === "www.primevideo.com" ? "prime" : hostname === "tv.apple.com" ? "appletv" : "test";
  return { service, titleId: pathname };
}

// Listeners must be registered synchronously at startup so Chrome can wake
// the service worker for them.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ("player" satisfies PortName)) return;

  const tab = port.sender?.tab;
  const label = `tab ${tab?.id ?? "?"}`;
  console.log(`[background] ${label} connected: ${tab?.url ?? "unknown url"}`);

  // Each tab is its own client on the server.
  const server = new ServerConnection(label, {
    onOpen: () => {
      server.send({ type: "join", roomId: DEV_ROOM, content: contentFromUrl(tab?.url) });
    },
    onMessage: (msg) => {
      if (msg.type === "pong") {
        console.log(`[background] ${label} pong, round trip ${Date.now() - msg.t0}ms`);
      } else if (msg.type === "state") {
        const s = msg.state;
        console.log(
          `[background] ${label} room ${s.roomId} state #${s.seq}: ` +
            `${s.playing ? "playing" : "paused"} at ${s.position.toFixed(2)}s`,
        );
      }
    },
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
