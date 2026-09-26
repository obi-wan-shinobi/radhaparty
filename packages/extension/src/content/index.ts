// Runs in the default isolated world.
console.log("[content] loaded on", location.href);

// Streaming sites insert the <video> after page load, so wait for it
// instead of assuming it exists when the script runs.
function waitForVideo(): Promise<HTMLVideoElement> {
  return new Promise((resolve) => {
    const existing = document.querySelector("video");
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const video = document.querySelector("video");
      if (video) {
        observer.disconnect();
        resolve(video);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function watchVideo(video: HTMLVideoElement): void {
  console.log("[content] found video element", video);

  const log = (type: string) => {
    console.log(`[content] ${type} at ${video.currentTime.toFixed(2)}s`);
  };

  video.addEventListener("play", () => log("play"));
  video.addEventListener("pause", () => log("pause"));
  video.addEventListener("seeked", () => log("seek"));
}

waitForVideo().then(watchVideo);
