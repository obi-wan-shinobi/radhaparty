// Runs in the default isolated world.
import type { ContentToBackground, PlayerEvent, PortName } from "../messages";

console.log("[content] loaded on", location.href);

// The service worker can be stopped by Chrome at any time, which closes the
// port. Reconnect lazily on the next send instead of holding a dead port.
let port: chrome.runtime.Port | null = null;

function connect(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: "player" satisfies PortName });
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
  });
  return p;
}

function send(msg: ContentToBackground): void {
  try {
    port ??= connect();
    port.postMessage(msg);
  } catch {
    // The port may have closed before its onDisconnect fired. Retry once.
    try {
      port = connect();
      port.postMessage(msg);
    } catch (err) {
      // Happens after the extension is reloaded: this old content script is
      // orphaned until the page is reloaded too.
      console.warn("[content] could not reach background, reload the page", err);
      port = null;
    }
  }
}

// Streaming sites insert the <video> after page load, so wait for it
// instead of assuming it exists when the script runs.
function waitForVideo(): Promise<HTMLVideoElement> {
  return new Promise((resolve) => {
    const existing = document.querySelector("video");
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const video = document.querySelector("video");
      if (video) {
        observer.disconnect();
        resolve(video);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function watchVideo(video: HTMLVideoElement): void {
  console.log("[content] found video element", video);

  const report = (type: PlayerEvent["type"]) => {
    const event: PlayerEvent = { type, position: video.currentTime };
    console.log(`[content] ${type} at ${event.position.toFixed(2)}s`);
    send({ type: "player-event", event });
  };

  video.addEventListener("play", () => report("play"));
  video.addEventListener("pause", () => report("pause"));
  video.addEventListener("seeked", () => report("seek"));
}

waitForVideo().then(watchVideo);
