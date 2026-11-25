/**
 * Standalone terminal WebSocket server for development.
 * Binds to 127.0.0.1 only (not exposed to LAN).
 */

// next dev 會自己讀 .env，但這支是獨立的 tsx 進程，要自己載入
import "dotenv/config";
import { createServer } from "http";
import { setupWebSocket } from "./ws-server";
import { assertComuxSecretOrExit } from "./server-shared/comux-secret";
import { startSessionAudit } from "./server-shared/session-audit";

// 秘鑰不合格就拒絕啟動（本機開發也一樣，不再有預設值）
assertComuxSecretOrExit("comux-ws-dev");

const port = parseInt(process.env.WS_PORT || "3001", 10);
const host = "127.0.0.1";

const server = createServer((_req, res) => {
  res.writeHead(200);
  res.end("WebSocket terminal server");
});

setupWebSocket(server);

server.listen(port, host, () => {
  console.log(`> terminal WebSocket server on ws://${host}:${port}`);
  // 開發時 SSH 監看跟著 WS 進程跑（正式機在 prod-server.js）
  startSessionAudit().catch((err: Error) => console.error("> session audit failed to start:", err.message));
});
