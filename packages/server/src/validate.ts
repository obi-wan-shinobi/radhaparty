import type { ClientMessage, ContentRef } from "@radhaparty/shared";

// Messages come from the network, so check every field before trusting it.
// Each branch rebuilds the message so unknown extra fields are dropped.

const SERVICES: readonly ContentRef["service"][] = ["prime", "appletv", "hotstar", "test"];
const ACTIONS = ["play", "pause", "seek"] as const;
const ROOM_ID = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_ID_LENGTH = 500;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isShortString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;

function parseContent(v: unknown): ContentRef | null {
  if (typeof v !== "object" || v === null) return null;
  const { service, titleId, episodeId } = v as Record<string, unknown>;
  if (!SERVICES.includes(service as ContentRef["service"]) || !isShortString(titleId)) return null;
  if (episodeId !== undefined && !isShortString(episodeId)) return null;
  const content: ContentRef = { service: service as ContentRef["service"], titleId };
  if (episodeId !== undefined) content.episodeId = episodeId;
  return content;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.type) {
    case "ping":
      return isFiniteNumber(msg.t0) ? { type: "ping", t0: msg.t0 } : null;
    case "join": {
      const content = parseContent(msg.content);
      const roomId = msg.roomId;
      if (typeof roomId !== "string" || !ROOM_ID.test(roomId) || !content) return null;
      return { type: "join", roomId, content };
    }
    case "action": {
      const action = ACTIONS.find((a) => a === msg.action);
      const position = msg.position;
      if (!action || !isFiniteNumber(position) || position < 0) return null;
      return { type: "action", action, position };
    }
    case "status":
      return typeof msg.blocked === "boolean" ? { type: "status", blocked: msg.blocked } : null;
    case "content": {
      const content = parseContent(msg.content);
      return content ? { type: "content", content } : null;
    }
    default:
      return null;
  }
}
