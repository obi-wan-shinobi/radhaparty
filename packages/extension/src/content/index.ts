// Runs in the default isolated world.
import type {
  BackgroundToContent,
  ContentReply,
  ContentToBackground,
  PlayerEvent,
  PortName,
} from "../messages";

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

// The service worker loses its ports when Chrome restarts it. When the popup
// then asks about this tab, the background asks us to connect again.
chrome.runtime.onMessage.addListener(
  (msg: BackgroundToContent, _sender, sendResponse: (reply: ContentReply) => void) => {
    if (msg.type !== "reconnect") return;
    const hasVideo = document.querySelector("video") !== null;
    if (hasVideo) {
      try {
        port ??= connect();
      } catch (err) {
        console.warn("[content] could not reach background, reload the page", err);
      }
    }
    sendResponse({ hasVideo });
  },
);

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

// Connect as soon as a video exists rather than on the first event, so the
// background has its server connection open before the user presses anything.
waitForVideo().then((video) => {
  console.log("[content] found video element", video);
  try {
    port ??= connect();
  } catch (err) {
    console.warn("[content] could not reach background, reload the page", err);
  }
});

// Sites can swap the <video> element at any time (Prime plays a trailer on
// the title page, then may create a new element for the episode). Media
// events don't bubble, but a capture listener on the document still sees
// them from every video, including ones added later.
const videoIds = new WeakMap<HTMLVideoElement, number>();
let nextVideoId = 1;

function describe(video: HTMLVideoElement): string {
  let id = videoIds.get(video);
  if (id === undefined) {
    id = nextVideoId++;
    videoIds.set(video, id);
    console.log(`[content] first event from video #${id}`, video);
  }
  const size = `${video.clientWidth}x${video.clientHeight}`;
  return `video #${id} (${size}${video.muted ? ", muted" : ""})`;
}

// Prime autoplays a muted trailer on the title page next to the episode's
// video. Ignore a video until it has been heard at least once. Checking
// `muted` at event time instead would stop syncing a viewer who mutes the
// episode partway through.
const heard = new WeakSet<HTMLVideoElement>();

document.addEventListener(
  "volumechange",
  (e) => {
    if (e.target instanceof HTMLVideoElement && !e.target.muted) heard.add(e.target);
  },
  true,
);

const eventTypes: Record<string, PlayerEvent["type"]> = {
  play: "play",
  pause: "pause",
  seeked: "seek",
};

for (const [domEvent, type] of Object.entries(eventTypes)) {
  document.addEventListener(
    domEvent,
    (e) => {
      const video = e.target;
      if (!(video instanceof HTMLVideoElement)) return;
      const event: PlayerEvent = { type, position: video.currentTime };
      const line = `[content] ${describe(video)} ${type} at ${event.position.toFixed(2)}s`;
      if (!video.muted) heard.add(video);
      if (!heard.has(video)) {
        console.log(`${line}, ignored (never unmuted)`);
        return;
      }
      console.log(line);
      send({ type: "player-event", event });
    },
    true,
  );
}
