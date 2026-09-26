import type { ContentToBackground, PortName } from "../messages";

console.log("[background] service worker loaded");

// Listeners must be registered synchronously at startup so Chrome can wake
// the service worker for them.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ("player" satisfies PortName)) return;

  const tab = port.sender?.tab;
  const label = `tab ${tab?.id ?? "?"}`;
  console.log(`[background] ${label} connected: ${tab?.url ?? "unknown url"}`);

  port.onMessage.addListener((msg: ContentToBackground) => {
    if (msg.type === "player-event") {
      console.log(`[background] ${label} ${msg.event.type} at ${msg.event.position.toFixed(2)}s`);
    }
  });

  port.onDisconnect.addListener(() => {
    console.log(`[background] ${label} disconnected`);
  });
});
