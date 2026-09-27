import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

const matches = [
  "http://localhost/*",
  "https://www.primevideo.com/*",
  "https://tv.apple.com/*",
];

export default defineManifest({
  manifest_version: 3,
  name: "radhaparty",
  description: "Watch party sync for Prime Video and Apple TV+",
  version: pkg.version,
  // PNGs rendered from icons/peacock-feather.svg. Files in public/ are
  // copied to the root of dist.
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches,
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  // storage: remembers each tab's room across page reloads and service
  // worker restarts (chrome.storage.session).
  permissions: ["storage"],
  host_permissions: matches,
});
