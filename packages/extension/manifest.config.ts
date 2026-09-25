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
  action: {
    default_popup: "src/popup/index.html",
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
  host_permissions: matches,
});
