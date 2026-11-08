/**
 * WebSocket server for terminal streaming via PTY.
 */

import { Server as HttpServer, IncomingMessage } from "http";
import type { Duplex } from "stream";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";

// ─── Auth / validation ─────────────────────────────────────────────

// 與 prod-server.js 共用：驗簽章後查 DB 比對 tokenVersion（同 API 的 requireAuth）、
// 只允許 comux 管理的 session、tmux target 用 `=name` 精確比對
import {
  verifySessionToken,
  isManagedSession,
  parseTerminalPath,
  tmuxTarget,
  getCookieValue,
  WS_MAX_PAYLOAD,
} from "./server-shared/ws-guard";

// ─── Allowed origins ───────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "comux.test,localhost")
    .split(",")
    .map((o) => o.trim().toLowerCase())
);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // no origin = same-origin or non-browser
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return ALLOWED_ORIGINS.has(hostname);
  } catch {
    return false;
  }
}

// ─── WebSocket setup ───────────────────────────────────────────────

function reject(socket: Duplex, status: string) {
  if (!socket.destroyed) socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

export function setupWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

  server.on("upgrade", async (request: IncomingMessage, socket: Duplex, head) => {
    const { pathname } = parse(request.url || "", true);

    if (pathname && pathname.startsWith("/ws/terminal/")) {
      try {
        // Origin check
        if (!isOriginAllowed(request.headers.origin)) return reject(socket, "403 Forbidden");

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
          handleTerminalConnection(ws, parsed.sessionName, parsed.windowIndex);
        });
      } catch (err) {
        console.error("> terminal upgrade failed:", (err as Error).message);
        reject(socket, "500 Internal Server Error");
      }
    }
    // Don't destroy other upgrades — let Next.js handle HMR WebSocket
  });
}

function handleTerminalConnection(ws: WebSocket, sessionName: string, windowIndex?: number) {
  // `=name` 精確比對（避免前綴比對到別的 session）
  const target = tmuxTarget(sessionName, windowIndex);

  const socketArgs = process.env.TMUX_SOCKET
    ? ["-S", process.env.TMUX_SOCKET]
    : [];
  const ptyProcess = pty.spawn(
    "tmux",
    [...socketArgs, "attach-session", "-t", target],
    {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    }
  );

  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "output", data }));
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  // Heartbeat: detect dead connections silently killed by NAT/proxy/OS.
  // Sends native ws ping every 30s; if no pong by the next tick, terminate.
  let isAlive = true;
  ws.on("pong", () => {
    isAlive = true;
  });
  const heartbeat = setInterval(() => {
    if (!isAlive) {
      ws.terminate();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }, 30000);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        ptyProcess.write(msg.data);
      } else if (
        msg.type === "resize" &&
        Number.isInteger(msg.cols) && Number.isInteger(msg.rows) &&
        msg.cols > 0 && msg.rows > 0 && msg.cols <= 1000 && msg.rows <= 1000
      ) {
        ptyProcess.resize(msg.cols, msg.rows);
      } else if (msg.type === "ping") {
        // App-level ping — lets the client probe the connection
        // without relying on browser-exposed pong events.
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      }
    } catch {
      /* ignore malformed */
    }
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    ptyProcess.kill();
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
