import type { PopupRequest, PopupResponse, PopupStatus } from "../messages";

console.log("[popup] loaded");

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const message = byId<HTMLParagraphElement>("message");
const noRoom = byId<HTMLElement>("no-room");
const inRoom = byId<HTMLElement>("in-room");
const roomId = byId<HTMLParagraphElement>("room-id");
const connection = byId<HTMLParagraphElement>("connection");
const codeInput = byId<HTMLInputElement>("room-code");
const buttons = [...document.querySelectorAll("button")];

// Room codes are uppercase, but typing them in lowercase should still work.
const ROOM_ID = /^[A-Z0-9_-]{1,32}$/;

function render(status: PopupStatus): void {
  noRoom.hidden = !status.hasVideo || status.roomId !== null;
  inRoom.hidden = !status.hasVideo || status.roomId === null;
  if (!status.hasVideo) {
    message.textContent =
      "No video on this page. Open a title on Prime Video, Apple TV, or JioHotstar, or the test page.";
    return;
  }
  if (message.textContent?.startsWith("No video")) message.textContent = "";
  if (status.roomId) {
    roomId.textContent = status.roomId;
    connection.textContent = status.connected ? "Connected" : "Connecting to server…";
  }
}

async function request(req: PopupRequest): Promise<void> {
  let res: PopupResponse | undefined;
  try {
    res = await chrome.runtime.sendMessage<PopupRequest, PopupResponse>(req);
  } catch (err) {
    message.textContent = `Couldn't reach the extension: ${String(err)}`;
    return;
  }
  if (!res) {
    message.textContent = "The extension didn't answer. Try reopening this popup.";
  } else if (!res.ok) {
    message.textContent = res.error;
  } else {
    render(res.status);
  }
}

// Disables the buttons while an action runs, so a double click can't create
// two rooms.
async function act(req: PopupRequest): Promise<void> {
  message.textContent = "";
  for (const b of buttons) b.disabled = true;
  try {
    await request(req);
  } finally {
    for (const b of buttons) b.disabled = false;
  }
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id;
  if (tabId === undefined) {
    message.textContent = "Couldn't find the current tab.";
    return;
  }

  byId("create-room").addEventListener("click", () => void act({ type: "create-room", tabId }));

  byId("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!ROOM_ID.test(code)) {
      message.textContent = "Room codes are letters and numbers, up to 32 characters.";
      return;
    }
    void act({ type: "join-room", tabId, roomId: code });
  });

  byId("leave-room").addEventListener("click", () => void act({ type: "leave-room", tabId }));

  byId("copy-code").addEventListener("click", () => {
    void navigator.clipboard.writeText(roomId.textContent ?? "").then(
      () => (message.textContent = "Code copied."),
      () => (message.textContent = "Couldn't copy. Select the code and copy it by hand."),
    );
  });

  await request({ type: "get-status", tabId });
  // Picks up "Connecting" turning into "Connected" while the popup is open.
  setInterval(() => void request({ type: "get-status", tabId }), 1000);
}

void main();
