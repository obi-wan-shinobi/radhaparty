/// <reference types="vite/client" />

interface ImportMetaEnv {
  // WebSocket server the extension connects to. Defaults to ws://localhost:8787.
  readonly VITE_SERVER_URL?: string;
}
