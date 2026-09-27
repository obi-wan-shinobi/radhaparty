// How to press play and pause on each site.
//
// Calling play() or pause() on the <video> works on plain pages, but a
// site's player keeps its own idea of whether it should be playing and can
// undo a change it didn't make. Apple TV does this: after video.play() its
// player pauses the video again. There, click the player's own buttons so
// its state changes with the video's.

type Controls = {
  play(video: HTMLVideoElement): Promise<void>;
  pause(video: HTMLVideoElement): void;
};

const html5: Controls = {
  play: (video) => video.play(),
  pause: (video) => video.pause(),
};

function clickButton(selector: string): boolean {
  const button = document.querySelector<HTMLButtonElement>(selector);
  if (!button) return false;
  button.click();
  return true;
}

const appleTv: Controls = {
  async play(video) {
    if (!clickButton("button.playback-play__play")) {
      console.warn("[content] Apple TV play button not found, calling video.play()");
      await video.play();
    }
  },
  pause(video) {
    if (!clickButton("button.playback-play__pause")) {
      console.warn("[content] Apple TV pause button not found, calling video.pause()");
      video.pause();
    }
  },
};

export const controls: Controls = location.hostname === "tv.apple.com" ? appleTv : html5;
