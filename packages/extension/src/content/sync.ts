import type { RoomState } from "@radhaparty/shared";
import { controls } from "./controls";

// Makes the page's video follow the room's state, and decides which video
// events are the viewer's own actions.
//
// Echo prevention: when we pause the video because someone else paused, the
// video fires the same "pause" event as a click would. Instead of tracking
// which events we caused, an event is only reported when the video no longer
// matches the room. Events caused by applying the room's state leave the
// video matching it, so they are never sent back.

// How far the video may be from the room's position before we seek. Paused
// videos are held tighter so everyone sees the same frame. Playing videos
// drift a little, and small drift is corrected separately (by rate, later)
// instead of by seeking.
const PLAYING_TOLERANCE_S = 1.0;
const PAUSED_TOLERANCE_S = 0.25;

// A state that arrives shortly after the viewer acted was usually sent
// before the server saw that action. Applying it would undo what the viewer
// just did, so hold it and apply the newest state once this window ends.
const LOCAL_GRACE_MS = 1000;

// A site's player can react to a change we make, for example by pausing
// again right after we play. Events this soon after applying the room's
// state are treated as the site reacting, not the viewer. Reporting them
// would start a loop: the room flips, we apply it, the site undoes it.
const SITE_REACTION_MS = 500;

let room: RoomState | null = null;
let lastLocalAction = -Infinity;
let lastApplied = -Infinity;
let deferred: ReturnType<typeof setTimeout> | undefined;

function tolerance(state: RoomState): number {
  return state.playing ? PLAYING_TOLERANCE_S : PAUSED_TOLERANCE_S;
}

// Where the room is now. `position` is where it was at `updatedAt`.
// The server's clock is assumed to match ours until clock sync exists.
function expectedPosition(state: RoomState): number {
  if (!state.playing) return state.position;
  return state.position + Math.max(0, Date.now() - state.updatedAt) / 1000;
}

// True when the video is where the room says it should be.
export function matchesRoom(video: HTMLVideoElement): boolean {
  if (!room) return false;
  return (
    !video.paused === room.playing &&
    Math.abs(video.currentTime - expectedPosition(room)) <= tolerance(room)
  );
}

export function isSiteReaction(): boolean {
  return performance.now() - lastApplied < SITE_REACTION_MS;
}

export function noteLocalAction(): void {
  lastLocalAction = performance.now();
}

async function apply(video: HTMLVideoElement, state: RoomState): Promise<void> {
  // Seek before play or pause. The play and pause events then fire with
  // the video already at the room's position, so they match the room and
  // aren't reported.
  const target = expectedPosition(state);
  if (Math.abs(video.currentTime - target) > tolerance(state)) {
    console.log(`[content] sync: seeking ${video.currentTime.toFixed(2)}s -> ${target.toFixed(2)}s`);
    lastApplied = performance.now();
    video.currentTime = target;
  }
  if (state.playing && video.paused) {
    console.log("[content] sync: play");
    lastApplied = performance.now();
    try {
      await controls.play(video);
    } catch (err) {
      // Chrome blocks play() on a page the viewer hasn't interacted with.
      console.warn("[content] sync: the browser blocked play, press play to catch up", err);
    }
  } else if (!state.playing && !video.paused) {
    console.log("[content] sync: pause");
    lastApplied = performance.now();
    controls.pause(video);
  }
}

function applyLatest(getVideo: () => HTMLVideoElement | null): void {
  deferred = undefined;
  if (!room) return;
  const video = getVideo();
  if (!video) {
    console.log("[content] sync: no video to apply the room's state to");
    return;
  }
  void apply(video, room);
}

export function setRoomState(state: RoomState | null, getVideo: () => HTMLVideoElement | null): void {
  room = state;
  clearTimeout(deferred);
  deferred = undefined;
  if (!state) return;

  const wait = lastLocalAction + LOCAL_GRACE_MS - performance.now();
  if (wait > 0) {
    deferred = setTimeout(() => applyLatest(getVideo), wait);
  } else {
    applyLatest(getVideo);
  }
}
