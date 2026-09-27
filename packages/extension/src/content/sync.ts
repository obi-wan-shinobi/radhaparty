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
// drift a little, and small drift is corrected by adjusting playback speed
// (see checkDrift) instead of by seeking.
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

// Drift correction. Videos that start together slowly drift apart (stalls,
// decoder timing). Once a second, a playing video's position is compared with
// the room's. Small drift is closed by playing slightly faster or slower,
// which is hard to notice and fires no play, pause, or seek events. Drift
// past PLAYING_TOLERANCE_S is fixed by seeking.
const DRIFT_CHECK_MS = 1000;
// A frame lasts 33 to 42ms at 24 to 30fps. Aiming for less than a frame
// would keep adjusting speed to chase measurement noise.
const DRIFT_START_S = 0.06; // start adjusting speed above about two frames
const DRIFT_STOP_S = 0.03; // back to normal speed within about one frame
const DRIFT_CLOSE_OVER_S = 3; // aim to close the gap over about this long
const MAX_SPEED_CHANGE = 0.05; // so speed stays between 0.95x and 1.05x

// Seeking a playing video takes time to buffer (a second or more on
// streaming sites), so it lands behind the room by that much. The next check
// would seek again and land behind again. So after each seek while playing,
// measure where it landed and aim that much further ahead next time, and
// don't seek for drift again right after a seek.
const MAX_SEEK_LEAD_S = 5;
const DRIFT_SEEK_COOLDOWN_MS = 3000;

let room: RoomState | null = null;
let clockOffsetMs = 0; // serverClock - ourClock, from the background's pings
let driftTimer: ReturnType<typeof setInterval> | undefined;
let adjusting: HTMLVideoElement | null = null; // video playing at a changed speed
let seekLeadS = 0; // how far ahead to aim when seeking a playing video
let measureLead = false; // measure the next landing to update seekLeadS
let lastLocalAction = -Infinity;
let lastApplied = -Infinity;
let deferred: ReturnType<typeof setTimeout> | undefined;

function tolerance(state: RoomState): number {
  return state.playing ? PLAYING_TOLERANCE_S : PAUSED_TOLERANCE_S;
}

export function setClockOffset(offsetMs: number): void {
  clockOffsetMs = offsetMs;
}

// Where the room is now. `position` is where it was at `updatedAt`, which is
// a time on the server's clock.
function expectedPosition(state: RoomState): number {
  if (!state.playing) return state.position;
  const serverNow = Date.now() + clockOffsetMs;
  return state.position + Math.max(0, serverNow - state.updatedAt) / 1000;
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
    const aim = state.playing ? target + seekLeadS : target;
    console.log(`[content] sync: seeking ${video.currentTime.toFixed(2)}s -> ${aim.toFixed(2)}s`);
    lastApplied = performance.now();
    measureLead = state.playing;
    video.currentTime = aim;
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

function resetSpeed(): void {
  if (!adjusting) return;
  adjusting.playbackRate = 1;
  console.log("[content] sync: back to normal speed");
  adjusting = null;
}

function checkDrift(getVideo: () => HTMLVideoElement | null): void {
  const video = getVideo();
  const settling = deferred !== undefined || performance.now() - lastLocalAction < LOCAL_GRACE_MS;
  // readyState below HAVE_FUTURE_DATA means the video is buffering and its
  // position is frozen, so drift measured now would be misleading.
  const buffering = video ? video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA : false;
  if (!room?.playing || !video || video.paused || video.seeking || buffering || settling) {
    resetSpeed();
    return;
  }
  if (adjusting && adjusting !== video) resetSpeed();

  const drift = video.currentTime - expectedPosition(room); // positive: we're ahead
  const size = Math.abs(drift);

  if (measureLead) {
    measureLead = false;
    const lead = Math.min(MAX_SEEK_LEAD_S, Math.max(0, seekLeadS - drift));
    if (Math.abs(lead - seekLeadS) >= 0.05) {
      console.log(`[content] sync: seeks land ${(-drift).toFixed(2)}s behind, aiming ${lead.toFixed(2)}s ahead from now on`);
    }
    seekLeadS = lead;
  }

  if (size > PLAYING_TOLERANCE_S) {
    resetSpeed();
    if (performance.now() - lastApplied >= DRIFT_SEEK_COOLDOWN_MS) void apply(video, room);
    return;
  }
  if (size < (adjusting ? DRIFT_STOP_S : DRIFT_START_S)) {
    resetSpeed();
    return;
  }

  const change = Math.min(MAX_SPEED_CHANGE, size / DRIFT_CLOSE_OVER_S);
  const rate = drift > 0 ? 1 - change : 1 + change;
  if (!adjusting) {
    console.log(
      `[content] sync: ${size.toFixed(2)}s ${drift > 0 ? "ahead" : "behind"}, ` +
        `playing at ${rate.toFixed(3)}x to catch up`,
    );
  }
  adjusting = video;
  video.playbackRate = rate;
}

export function setRoomState(state: RoomState | null, getVideo: () => HTMLVideoElement | null): void {
  room = state;
  clearTimeout(deferred);
  deferred = undefined;
  if (!state) {
    clearInterval(driftTimer);
    driftTimer = undefined;
    resetSpeed();
    return;
  }
  driftTimer ??= setInterval(() => checkDrift(getVideo), DRIFT_CHECK_MS);

  const wait = lastLocalAction + LOCAL_GRACE_MS - performance.now();
  if (wait > 0) {
    deferred = setTimeout(() => applyLatest(getVideo), wait);
  } else {
    applyLatest(getVideo);
  }
}
