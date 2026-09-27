export type ContentRef = { service: "prime" | "appletv" | "hotstar" | "test"; titleId: string; episodeId?: string };

export type RoomState = {
  roomId: string;
  content: ContentRef;
  playing: boolean;
  position: number;   // content seconds at updatedAt
  updatedAt: number;  // server clock, ms
  seq: number;
  waiting: string[];  // clientIds currently blocked (buffering, ad, loading)
};

export type ClientMessage =
  | { type: "ping"; t0: number }
  | { type: "join"; roomId: string; content: ContentRef }
  | { type: "action"; action: "play" | "pause" | "seek"; position: number }
  | { type: "status"; blocked: boolean }
  | { type: "content"; content: ContentRef };

export type ServerMessage =
  | { type: "pong"; t0: number; ts: number }
  | { type: "state"; state: RoomState };

export interface PlayerAdapter {
  service: ContentRef["service"];
  getContentId(): ContentRef | null;
  getState(): { playing: boolean; position: number; buffering: boolean; inAd: boolean };
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setRate(rate: number): void;
  onUserEvent(cb: (e: { type: "play" | "pause" | "seek"; position: number }) => void): void;
}
