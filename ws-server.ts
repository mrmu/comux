/**
 * WebSocket server for terminal streaming via PTY.
 */

import { Server as HttpServer, IncomingMessage } from "http";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";

// ─── Validation ────────────────────────────────────────────────────

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function isValidSessionName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && SAFE_NAME_RE.test(name);
}

// ─── Auth (JWT) ────────────────────────────────────────────────────

import jwt from "jsonwebtoken";
import { getComuxSecret } from "./server-shared/comux-secret";

function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, getComuxSecret());
    return true;
  } catch {
    return false;
  }
}

function getCookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

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

export function setupWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const { pathname } = parse(request.url || "", true);

    if (pathname && pathname.startsWith("/ws/terminal/")) {
      // Origin check
      if (!isOriginAllowed(request.headers.origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      // Auth check
      const token = getCookieValue(request.headers.cookie, "comux_token");
      if (!token || !verifyToken(token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // Parse and validate session name
      const parts = pathname.replace("/ws/terminal/", "").split("/");
      const sessionName = decodeURIComponent(parts[0]);
      const windowIndex = parts[1] !== undefined ? parseInt(parts[1]) : undefined;

      if (!isValidSessionName(sessionName)) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        handleTerminalConnection(ws, sessionName, windowIndex);
      });
    }
    // Don't destroy other upgrades — let Next.js handle HMR WebSocket
  });
}

function handleTerminalConnection(ws: WebSocket, sessionName: string, windowIndex?: number) {
  // Use ={name} for exact match (prevents fnmatch pattern injection)
  const target =
    windowIndex !== undefined
      ? `${sessionName}:${windowIndex}`
      : `${sessionName}`;

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
      if (msg.type === "input") {
        ptyProcess.write(msg.data);
      } else if (msg.type === "resize" && msg.cols && msg.rows) {
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
