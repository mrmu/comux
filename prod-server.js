/**
 * Production server for standalone Next.js + WebSocket terminal (PTY).
 */

const http = require("http");
const path = require("path");
const { parse } = require("url");
// crypto removed — using JWT now

const dir = path.join(__dirname);
process.env.NODE_ENV = "production";
process.chdir(__dirname);

// COMUX_SECRET 不合格（未設 / 太短 / 公開預設值）就直接拒絕啟動
require("./server-shared/comux-secret").assertComuxSecretOrExit("comux");

// systemd gives us a bare PATH (/usr/local/bin:/usr/bin:...), but per-user
// CLI installs live under $HOME — notably Claude Code's native installer
// (~/.local/bin/claude). Prepend the ones that exist so `which claude` in the
// API routes and the PATH we inject into new tmux panes can both find them.
{
  const fs = require("fs");
  const home = process.env.HOME || require("os").homedir();
  const current = (process.env.PATH || "").split(":").filter(Boolean);
  const extra = [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".bun", "bin"),
  ].filter((p) => !current.includes(p) && fs.existsSync(p));
  if (extra.length) process.env.PATH = [...extra, ...current].join(":");
}

const currentPort = parseInt(process.env.PORT, 10) || 3000;
// 預設只聽 loopback：正式機由 Tailscale Serve（或其他本機反向代理）轉進來，
// comux 本身絕不直接對外。真的需要時才用 HOSTNAME 覆寫（例如容器內的 0.0.0.0）。
const hostname = process.env.HOSTNAME || "127.0.0.1";

const nextConfig = require(
  path.join(__dirname, ".next", "required-server-files.json")
).config;
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

// ─── Auth ──────────────────────────────────────────────────────────

// JWT 簽章 + DB tokenVersion 比對（與 API 的 requireAuth 相同規則）、
// 只允許 comux 管理的 session、tmux target 精確比對 —— 與 ws-server.ts 共用
const {
  verifySessionToken,
  isManagedSession,
  parseTerminalPath,
  tmuxTarget,
  getCookieValue,
  WS_MAX_PAYLOAD,
} = require("./server-shared/ws-guard");

// ─── PTY terminal handler ──────────────────────────────────────────

function handleTerminal(ws, sessionName, windowIndex) {
  const pty = require("node-pty");
  // `=name` 精確比對（避免前綴比對到別的 session）
  const target = tmuxTarget(sessionName, windowIndex);

  const socketArgs = process.env.TMUX_SOCKET
    ? ["-S", process.env.TMUX_SOCKET]
    : [];
  const ptyProcess = pty.spawn("tmux", [...socketArgs, "attach-session", "-t", target], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === 1) ws.close();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string") ptyProcess.write(msg.data);
      else if (msg.type === "resize" && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)
        && msg.cols > 0 && msg.rows > 0 && msg.cols <= 1000 && msg.rows <= 1000)
        ptyProcess.resize(msg.cols, msg.rows);
      // 前端每 25 秒送 app-level ping，60 秒沒收到 pong 就重連（與 ws-server.ts 一致）
      else if (msg.type === "ping" && ws.readyState === 1)
        ws.send(JSON.stringify({ type: "pong" }));
    } catch {}
  });

  ws.on("close", () => ptyProcess.kill());
  ws.on("error", () => ptyProcess.kill());
}

// ─── Start ─────────────────────────────────────────────────────────

async function main() {
  let requestHandler = (_req, res) => {
    res.statusCode = 503;
    res.end("Starting...");
  };

  // 可信來源位址：刪掉外部傳入的 x-comux-client-ip，改由 socket 位址
  // （或 TRUSTED_PROXIES 轉送的 X-Forwarded-For）決定，給登入限流用
  const { applyClientIpHeader, markClientIpHeaderTrusted } = require("./server-shared/client-ip");
  markClientIpHeaderTrusted();

  const server = http.createServer((req, res) => {
    applyClientIpHeader(req);
    requestHandler(req, res);
  });

  // WebSocket
  const { WebSocketServer } = require("ws");
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

  const ALLOWED_ORIGINS = new Set(
    (process.env.ALLOWED_ORIGINS || process.env.VIRTUAL_HOST || "localhost")
      .split(",").map((o) => o.trim().toLowerCase())
  );

  const reject = (socket, status) => {
    if (!socket.destroyed) socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
  };

  server.on("upgrade", async (request, socket, head) => {
    const { pathname } = parse(request.url || "", true);

    if (pathname && pathname.startsWith("/ws/terminal/")) {
      try {
        // Origin check
        const origin = request.headers.origin;
        if (origin) {
          let host = "";
          try { host = new URL(origin).hostname.toLowerCase(); } catch {}
          if (!ALLOWED_ORIGINS.has(host)) return reject(socket, "403 Forbidden");
        }

        // 路徑格式：/ws/terminal/{session}[/{window}]
        const parsed = parseTerminalPath(pathname);
        if (!parsed) return reject(socket, "400 Bad Request");

        // Auth check（查 DB，所以是非同步）
        const token = getCookieValue(request.headers.cookie, "comux_token");
        if (!(await verifySessionToken(token))) return reject(socket, "401 Unauthorized");

        // 只能 attach comux 自己管理的 session（projects 表裡有的）
        if (!(await isManagedSession(parsed.sessionName))) return reject(socket, "404 Not Found");

        // 等 DB 期間 client 可能已斷線
        if (socket.destroyed) return;

        wss.handleUpgrade(request, socket, head, (ws) => {
          handleTerminal(ws, parsed.sessionName, parsed.windowIndex);
        });
      } catch (err) {
        console.error("> terminal upgrade failed:", err && err.message);
        reject(socket, "500 Internal Server Error");
      }
    }
    // Don't destroy — let Next.js handle other upgrades
  });

  require("next");
  const { getRequestHandlers } = require("next/dist/server/lib/start-server");
  const handlers = await getRequestHandlers({
    dir,
    port: currentPort,
    hostname,
    isDev: false,
    server,
  });

  requestHandler = handlers.requestHandler;

  server.listen(currentPort, hostname, () => {
    console.log(`> comux ready on http://${hostname}:${currentPort}`);

    // Auto-restore sessions from DB after server is ready
    setTimeout(async () => {
      try {
        // 用實際 bind 的位址打回自己；"localhost" 在 Node 可能先解析成 ::1 而連不上
        const selfHost = hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
        const res = await fetch(`http://${selfHost}:${currentPort}/api/sessions/restore`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (data.restored?.length) {
          console.log(`> restored sessions: ${data.restored.join(", ")}`);
        }
      } catch (err) {
        console.error("> session restore failed:", err.message);
      }
    }, 2000);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
