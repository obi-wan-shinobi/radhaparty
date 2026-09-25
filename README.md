# radhaparty

Watch party sync for Prime Video and Apple TV+. Each viewer streams from their own account. A Chrome extension reads and controls the page's `<video>` element, and a WebSocket server holds shared room state.

This repo is currently scaffolding only. Every source file is a stub that logs when it loads.

## Packages

| Package | What it is |
| --- | --- |
| `packages/shared` | Shared TypeScript types (`RoomState`, `ClientMessage`, `ServerMessage`, `PlayerAdapter`). No runtime code. |
| `packages/server` | Node WebSocket server (`ws`). Logs connections, disconnections, and messages. |
| `packages/test-page` | Vite page with one `<video controls>` element playing `/sample.mp4`. Used for development before touching real streaming sites. |
| `packages/extension` | Chrome Manifest V3 extension: background service worker, content script, popup. Built with Vite and `@crxjs/vite-plugin`. |

## Requirements

- Node 22
- pnpm 10 (`npm install -g pnpm`)
- ffmpeg, only if you want to regenerate the test video

## Install

```sh
pnpm install
```

## Run

```sh
pnpm dev:server      # WebSocket server on ws://localhost:8787 (override with PORT=...)
pnpm dev:test-page   # test page on http://localhost:5173
pnpm dev:extension   # rebuilds packages/extension/dist on file changes
pnpm build:extension # one-off production build of the extension
pnpm typecheck       # tsc --noEmit in every package
```

## Test video

`packages/test-page/public/sample.mp4` is git-ignored. It is a 10 minute 1280x720 test pattern with a running counter and a short beep every second. The counter is elapsed time in hundredths of a second with no decimal point, so `12340` means 123.40 s.

To regenerate it:

```sh
ffmpeg -f lavfi -i "testsrc=size=1280x720:rate=30:duration=600:decimals=2" \
  -f lavfi -i "sine=frequency=440:beep_factor=4:sample_rate=48000:duration=600" \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -g 30 \
  -c:a aac -b:a 64k -movflags +faststart -shortest \
  packages/test-page/public/sample.mp4
```

You can also drop in any MP4 of your own at that path.

## Load the extension in Chrome

1. Run `pnpm build:extension` (or keep `pnpm dev:extension` running).
2. Open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and select `packages/extension/dist`.
4. After a rebuild, click the reload icon on the extension card, then reload the page.

The content script runs on `http://localhost/*` (any port), `https://www.primevideo.com/*`, and `https://tv.apple.com/*`. Open the test page and check the page's DevTools console for `[content] loaded on ...`. The service worker log is under "Inspect views: service worker" on the extension card.
