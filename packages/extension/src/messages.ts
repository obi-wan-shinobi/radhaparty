// Messages passed inside the extension, between content scripts and the
// background service worker. Server messages live in @radhaparty/shared.
// Types only: a runtime export here would make the bundler split the
// content script into a loader plus a web-accessible chunk.

export type PortName = "player";

export type PlayerEvent = { type: "play" | "pause" | "seek"; position: number };

export type ContentToBackground = { type: "player-event"; event: PlayerEvent };
