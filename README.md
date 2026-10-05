# radhaparty

Watch party sync for Prime Video, Apple TV+, and JioHotstar. Each viewer streams from their own account. A Chrome extension reads and controls the page's `<video>` element, and a WebSocket server holds shared room state.

Work in progress. Play, pause, and seek sync between tabs in the same room. Each tab measures its clock against the server's, and playing videos that drift apart are brought back in step by briefly adjusting playback speed.

Ads: when anyone in a room is watching an ad, the room is held paused for everyone until it ends. Prime Video splices ads into the same stream as the show, so the extension records where each ad played and syncs the show's own time rather than the stream's. Ad detection is currently only implemented for Prime Video.

## Packages

| Package | What it is |
| --- | --- |
| `packages/shared` | Shared TypeScript types (`RoomState`, `ClientMessage`, `ServerMessage`, `PlayerAdapter`). No runtime code. |
| `packages/server` | Node WebSocket server (`ws`). Keeps the state of each room and sends it to everyone in the room. |
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

The extension connects to `ws://localhost:8787` by default. To point it elsewhere, set `VITE_SERVER_URL` when building, for example `VITE_SERVER_URL=wss://example.com pnpm build:extension`.

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

The content script runs on `http://localhost/*` (any port), `https://www.primevideo.com/*`, `https://tv.apple.com/*`, and `https://www.hotstar.com/*` (JioHotstar). Open the test page and check the page's DevTools console for `[content] loaded on ...`. The service worker log is under "Inspect views: service worker" on the extension card.

## Rooms

A tab only connects to the server while it is in a room. With a video open, click the extension's toolbar icon:

- **Create room** puts this tab in a new room and shows a 6 character code to share.
- **Join room** puts this tab in the room with the code you type.
- **Leave room** disconnects this tab from the server.

A tab stays in its room across page reloads. It leaves when you click Leave room or close the tab.

## Deploying the server

The server keeps rooms in memory, so run exactly one instance. A restart or redeploy clears all rooms; tabs reconnect and rejoin by themselves, but the room starts again from paused at 0.

The `Dockerfile` at the repo root builds the server into one bundled file (`packages/server/dist/index.cjs`) and runs it with plain Node. Any host that builds from a Dockerfile works. The host must:

- set `PORT` (most do this automatically),
- serve it over HTTPS so the extension can use `wss://`,
- use `/health` as the health check path.

To run the production build locally:

```sh
pnpm --filter @radhaparty/server build
pnpm --filter @radhaparty/server start
```

The server accepts WebSocket connections from extensions, from `localhost` pages, and from clients that send no `Origin` header. Connections from other websites are rejected.

## Sharing the extension

The server is deployed at `wss://radhaparty-server.onrender.com`. To build the extension against it and zip it:

```sh
pnpm package:extension
```

This writes the build to `packages/extension/release` and the zip to `packages/extension/radhaparty-<version>.zip`, for example `radhaparty-0.0.1.zip`. The version comes from `packages/extension/package.json`. Your development build in `packages/extension/dist` keeps pointing at `ws://localhost:8787`.

Send the zip to the people you're watching with. They unzip it and use Load unpacked on the unzipped folder, as in "Load the extension in Chrome" above. To join them yourself, load `packages/extension/release` the same way, and turn off your development copy in `chrome://extensions` first: two copies loaded at once would both control the video.

To use a different server, run `VITE_SERVER_URL=wss://your-server.example pnpm --filter @radhaparty/extension package`.
