// A small banner over the page, used to say why the video is paused while
// the room waits for someone's ad.
//
// It lives in a shadow root so the site's CSS can't restyle it. A full-screen
// player only shows its own subtree, so the banner moves into the full-screen
// element while there is one.

// Show only after the message has held this long. When our own ad ends, the
// server still lists us as waiting until it hears, which would otherwise
// flash the banner for a moment.
const SHOW_AFTER_MS = 700;

let host: HTMLDivElement | null = null;
let label: HTMLDivElement | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;
let wanted: string | null = null;

function ensureBanner(): HTMLDivElement {
  if (host && label) return host;
  host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      div {
        position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; pointer-events: none;
        padding: 10px 16px; border-radius: 8px;
        background: rgba(0, 0, 0, 0.8); color: #fff;
        font: 500 15px/1.3 system-ui, sans-serif;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
      }
    </style>
    <div role="status"></div>`;
  label = root.querySelector("div");
  return host;
}

function place(): void {
  if (!host || !wanted) return;
  const parent = document.fullscreenElement ?? document.body;
  if (host.parentElement !== parent) parent.append(host);
}

document.addEventListener("fullscreenchange", place);

export function setBanner(text: string | null): void {
  if (text === wanted) return;
  wanted = text;
  clearTimeout(pending);
  if (text === null) {
    host?.remove();
    return;
  }
  pending = setTimeout(() => {
    ensureBanner();
    if (label) label.textContent = text;
    place();
  }, SHOW_AFTER_MS);
}
