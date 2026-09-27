// Messages passed inside the extension, between content scripts, the popup,
// and the background service worker. Server messages live in
// @radhaparty/shared.
// Types only: a runtime export here would make the bundler split the
// content script into a loader plus a web-accessible chunk.

export type PortName = "player";

export type PlayerEvent = { type: "play" | "pause" | "seek"; position: number };

export type ContentToBackground = { type: "player-event"; event: PlayerEvent };

// Sent with chrome.tabs.sendMessage when the background has no port for a
// tab, usually because the service worker restarted and the port closed.
export type BackgroundToContent = { type: "reconnect" };
export type ContentReply = { hasVideo: boolean };

// The popup always acts on the tab it was opened over.
export type PopupRequest =
  | { type: "get-status"; tabId: number }
  | { type: "create-room"; tabId: number }
  | { type: "join-room"; tabId: number; roomId: string }
  | { type: "leave-room"; tabId: number };

export type PopupStatus = { hasVideo: boolean; roomId: string | null; connected: boolean };

export type PopupResponse = { ok: true; status: PopupStatus } | { ok: false; error: string };
