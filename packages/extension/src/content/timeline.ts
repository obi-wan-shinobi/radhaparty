// Converts between stream time and show time, and detects ads.
//
// Prime Video splices ads into the same stream as the show, so
// video.currentTime ("stream time") runs ahead of the show by the length of
// the ads played so far. Two viewers who got different ads are at different
// stream times on the same scene, so rooms sync show time instead.
//
// Show time is stream time minus the ads before it. While an ad plays, the
// player shows an ad countdown, so each ad's span in the stream is recorded
// from when the countdown appears to when it goes away. If an ad played
// before we were watching (the extension was reloaded mid-ad, say), or one
// we seeked straight past, the spans miss it. So when the player's own
// elapsed time is on screen (Prime shows it while paused or while the mouse
// is over the player) and disagrees by more than a couple of seconds, the
// difference is taken from it instead.
//
// On sites without these elements, nothing is ever recorded and show time is
// stream time.

// Elements that are on screen only while an ad plays.
const AD_SELECTORS = [
  // Prime Video's ad countdown, e.g. "0:21".
  ".atvwebplayersdk-ad-timer-remaining-time",
];

// The player's elapsed time only has whole seconds, so it is only trusted
// over the recorded ad spans when they disagree by more than this.
const DISPLAY_TRUST_S = 2;
// Ads are at most this much of the stream, used to check that a pair of
// times on the page really is the player's elapsed and remaining time.
const MAX_AD_TOTAL_S = 900;

type Track = {
  // The stream's URL. Each title or episode gets a new one (a new blob: URL
  // on sites that build the stream themselves), and a fresh track. Duration
  // would be a worse key: players may grow it when they splice in an ad.
  src: string;
  spans: [number, number][]; // ad spans in stream time, sorted, not overlapping
  adStart: number | null; // stream time when the current ad was first seen
  extra: number; // ad time before the recorded spans, from the display
};

const tracks = new WeakMap<HTMLVideoElement, Track>();

function trackFor(video: HTMLVideoElement): Track {
  let track = tracks.get(video);
  if (!track || track.src !== video.currentSrc) {
    track = { src: video.currentSrc, spans: [], adStart: null, extra: 0 };
    tracks.set(video, track);
  }
  return track;
}

export function isAdShowing(): boolean {
  return AD_SELECTORS.some((selector) => {
    const el = document.querySelector(selector);
    return el !== null && el.checkVisibility();
  });
}

function addSpan(track: Track, start: number, end: number): void {
  if (end <= start) return;
  const spans = [...track.spans, [start, end] as [number, number]].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  track.spans = merged;
}

// Ad time in the stream before `streamTime`.
function adTimeBefore(track: Track, streamTime: number): number {
  let total = track.extra;
  for (const [s, e] of track.spans) {
    if (s >= streamTime) break;
    total += Math.min(e, streamTime) - s;
  }
  return total;
}

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;

function parseTime(text: string): number | null {
  const m = TIME.exec(text.trim().replace(/^-/, ""));
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// The player's elapsed time, if on screen. Class names on streaming sites are
// often scrambled and change between releases, so the display is found by
// shape: two sibling elements holding times (elapsed, then remaining) that
// add up to about the stream's length minus ads.
function readElapsed(video: HTMLVideoElement): number | null {
  for (const parent of document.querySelectorAll("body *")) {
    const times: number[] = [];
    for (const child of parent.children) {
      if (child.childElementCount > 0) continue;
      const t = parseTime(child.textContent ?? "");
      if (t !== null) times.push(t);
    }
    if (times.length !== 2) continue;
    const [elapsed, remaining] = times as [number, number];
    const total = elapsed + remaining;
    if (total <= video.duration + 2 && total >= video.duration - MAX_AD_TOTAL_S) return elapsed;
  }
  return null;
}

// Call often (every ~100ms) so ad spans are recorded close to where they
// start and end. Returns whether an ad is showing.
export function tick(video: HTMLVideoElement): boolean {
  const track = trackFor(video);
  const inAd = isAdShowing();
  const now = video.currentTime;
  if (inAd && track.adStart === null) {
    track.adStart = now;
  } else if (!inAd && track.adStart !== null) {
    addSpan(track, track.adStart, now);
    console.log(
      `[content] timeline: ad from ${track.adStart.toFixed(2)}s to ${now.toFixed(2)}s in the stream, ` +
        `${adTimeBefore(track, now).toFixed(2)}s of ads so far`,
    );
    track.adStart = null;
  }
  return inAd;
}

// Compare with the player's display, when it's on screen. Searching the page
// is slower than a tick, so call this less often (every ~2s).
export function calibrate(video: HTMLVideoElement): void {
  if (video.seeking || isAdShowing() || !Number.isFinite(video.duration)) return;
  const elapsed = readElapsed(video);
  if (elapsed === null) return;
  const track = trackFor(video);
  // The display shows whole seconds, so the true show time is somewhere in
  // the second after it. Use the middle.
  const fromDisplay = video.currentTime - (elapsed + 0.5);
  const fromSpans = adTimeBefore(track, video.currentTime);
  if (Math.abs(fromDisplay - fromSpans) <= DISPLAY_TRUST_S) return;
  track.extra += fromDisplay - fromSpans;
  console.log(
    `[content] timeline: player shows ${elapsed}s but recorded ads give ${(video.currentTime - fromSpans).toFixed(1)}s, ` +
      `using the player's time (${track.extra.toFixed(1)}s of ads not seen)`,
  );
}

export function showTime(video: HTMLVideoElement): number {
  return video.currentTime - adTimeBefore(trackFor(video), video.currentTime);
}

// The stream time for a show time: after any ad that starts at or before it.
export function streamTime(video: HTMLVideoElement, show: number): number {
  const track = trackFor(video);
  let stream = show + track.extra;
  for (const [s, e] of track.spans) {
    if (s > stream) break;
    stream += e - s;
  }
  return stream;
}
