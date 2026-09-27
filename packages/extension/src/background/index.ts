import type { ContentRef } from "@radhaparty/shared";
import type {
  BackgroundToContent,
  BackgroundToPort,
  ContentReply,
  ContentToBackground,
  PopupRequest,
  PopupResponse,
  PopupStatus,
  PortName,
} from "../messages";
import { ServerConnection } from "./connection";

console.log("[background] service worker loaded");

// One per tab whose content script has found a video. A tab only connects
// to the server while it is in a room.
type Session = {
  tabId: number;
  label: string;
  port: chrome.runtime.Port;
  url: string | undefined;
  roomId: string | null;
  server: ServerConnection | null;
};

const sessions = new Map<number, Session>();

function postToTab(session: Session, msg: BackgroundToPort): void {
  try {
    session.port.postMessage(msg);
  } catch {
    // The page is gone. Its onDisconnect cleans up the session.
  }
}

// No 0/O or 1/I, so codes are easy to read out. 32 symbols divide 256
// evenly, so taking a random byte mod 32 is unbiased.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;

function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// Each tab's room is kept in session storage so the tab rejoins after a
// page reload or a service worker restart. It is cleared when the user
// leaves or the tab closes, and by the browser when it quits.
const roomKey = (tabId: number) => `room:${tabId}`;

async function loadRoom(tabId: number): Promise<string | null> {
  const key = roomKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const roomId = stored[key];
  return typeof roomId === "string" ? roomId : null;
}

async function saveRoom(tabId: number, roomId: string | null): Promise<void> {
  if (roomId) await chrome.storage.session.set({ [roomKey(tabId)]: roomId });
  else await chrome.storage.session.remove(roomKey(tabId));
}

// Placeholder until the per-site adapters can read the real title and
// episode IDs from the page.
function contentFromUrl(url: string | undefined): ContentRef {
  const { hostname, pathname } = new URL(url ?? "http://unknown/");
  const service =
    hostname === "www.primevideo.com" ? "prime" : hostname === "tv.apple.com" ? "appletv" : "test";
  return { service, titleId: pathname };
}

function joinRoom(session: Session, roomId: string): void {
  session.server?.close();
  session.roomId = roomId;
  console.log(`[background] ${session.label} joining room ${roomId}`);

  const server = new ServerConnection(session.label, {
    // Runs on every reconnect too: the server forgets a client's room when
    // its socket closes.
    onOpen: () => {
      server.send({ type: "join", roomId, content: contentFromUrl(session.url) });
    },
    onMessage: (msg) => {
      if (msg.type === "pong") {
        console.log(`[background] ${session.label} pong, round trip ${Date.now() - msg.t0}ms`);
      } else if (msg.type === "state") {
        const s = msg.state;
        console.log(
          `[background] ${session.label} room ${s.roomId} state #${s.seq}: ` +
            `${s.playing ? "playing" : "paused"} at ${s.position.toFixed(2)}s`,
        );
        postToTab(session, { type: "state", state: s });
      }
    },
  });
  session.server = server;
}

function leaveRoom(session: Session): void {
  if (session.roomId) console.log(`[background] ${session.label} leaving room ${session.roomId}`);
  postToTab(session, { type: "room-left" });
  session.server?.close();
  session.server = null;
  session.roomId = null;
}

// Listeners must be registered synchronously at startup so Chrome can wake
// the service worker for them.
chrome.runtime.onConnect.addListener((port) => {
  const tab = port.sender?.tab;
  if (port.name !== ("player" satisfies PortName) || tab?.id === undefined) return;
  const tabId = tab.id;

  // A reload can connect the new page before the old port's disconnect runs.
  const previous = sessions.get(tabId);
  if (previous) leaveRoom(previous);

  const session: Session = {
    tabId,
    label: `tab ${tabId}`,
    port,
    url: tab.url,
    roomId: null,
    server: null,
  };
  sessions.set(tabId, session);
  console.log(`[background] ${session.label} connected: ${tab.url ?? "unknown url"}`);

  // Rejoin if this tab was in a room before a reload or a restart. Skip it if
  // the popup already put the tab in a room while storage was being read.
  void loadRoom(tabId).then((roomId) => {
    if (roomId && sessions.get(tabId) === session && !session.roomId) joinRoom(session, roomId);
  });

  port.onMessage.addListener((msg: ContentToBackground) => {
    if (msg.type !== "player-event") return;
    const { type, position } = msg.event;
    if (!session.server) {
      console.log(`[background] ${session.label} ${type} at ${position.toFixed(2)}s (not in a room)`);
      return;
    }
    console.log(`[background] ${session.label} ${type} at ${position.toFixed(2)}s`);
    session.server.send({ type: "action", action: type, position });
  });

  // The page reloaded or navigated away. Its room stays in storage so the
  // next page in this tab rejoins it.
  port.onDisconnect.addListener(() => {
    console.log(`[background] ${session.label} disconnected`);
    session.server?.close();
    if (sessions.get(tabId) === session) sessions.delete(tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void saveRoom(tabId, null);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Finds the tab's session, asking its content script to reconnect if the
// service worker lost the port. Returns null if the page has no video, or no
// content script (a site the extension doesn't run on).
async function findSession(tabId: number): Promise<Session | null> {
  const existing = sessions.get(tabId);
  if (existing) return existing;

  let reply: ContentReply | undefined;
  try {
    reply = await chrome.tabs.sendMessage<BackgroundToContent, ContentReply>(tabId, {
      type: "reconnect",
    });
  } catch {
    return null;
  }
  if (!reply?.hasVideo) return null;

  // The port connects separately from the reply, so wait briefly for it.
  for (let i = 0; i < 20; i++) {
    const session = sessions.get(tabId);
    if (session) return session;
    await sleep(50);
  }
  return null;
}

function statusOf(session: Session | null): PopupStatus {
  return {
    hasVideo: session !== null,
    roomId: session?.roomId ?? null,
    connected: session?.server?.isOpen() ?? false,
  };
}

async function handlePopup(req: PopupRequest): Promise<PopupResponse> {
  const session = await findSession(req.tabId);
  if (req.type === "get-status") return { ok: true, status: statusOf(session) };
  if (!session) return { ok: false, error: "No video found on this page." };

  switch (req.type) {
    case "create-room": {
      const roomId = newRoomCode();
      joinRoom(session, roomId);
      await saveRoom(session.tabId, roomId);
      break;
    }
    case "join-room": {
      if (!ROOM_ID.test(req.roomId)) return { ok: false, error: "That isn't a valid room code." };
      joinRoom(session, req.roomId);
      await saveRoom(session.tabId, req.roomId);
      break;
    }
    case "leave-room":
      leaveRoom(session);
      await saveRoom(session.tabId, null);
      break;
  }
  return { ok: true, status: statusOf(session) };
}

chrome.runtime.onMessage.addListener((req: PopupRequest, sender, sendResponse) => {
  // Only the popup sends runtime messages. Content scripts use the port.
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  handlePopup(req).then(sendResponse, (err: unknown) => {
    sendResponse({ ok: false, error: String(err) } satisfies PopupResponse);
  });
  return true; // keeps sendResponse valid until the promise settles
});
