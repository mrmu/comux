/**
 * Custom Next.js server with WebSocket support for terminal streaming.
 *
 * Dev:  npx tsx server.ts
 * Prod: node server.js (standalone output replaces this via prod-server.js)
 */

import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { setupWebSocket } from "./ws-server";
import { assertComuxSecretOrExit } from "./server-shared/comux-secret";

// 秘鑰不合格（未設 / 太短 / 公開預設值）就拒絕啟動
assertComuxSecretOrExit("comux");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
// 預設只聽 loopback，對外一律經 Tailscale Serve 等本機反向代理；必要時用 HOSTNAME 覆寫
const hostname = process.env.HOSTNAME || "127.0.0.1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  setupWebSocket(server);

  server.listen(port, hostname, () => {
    console.log(`> comux ready on http://${hostname}:${port}`);
  });
});
