"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
}

interface AgentSpec {
  id: "claude" | "codex" | "gemini";
  label: string;
  available: boolean;
  comingSoonHint?: string;
}

const AGENTS: AgentSpec[] = [
  { id: "claude", label: "Claude Code", available: true },
  { id: "codex",  label: "OpenAI Codex", available: false, comingSoonHint: "transcript adapter 規劃中" },
  { id: "gemini", label: "Gemini CLI",   available: false, comingSoonHint: "transcript adapter 規劃中" },
];

export default function TerminalView({
  sessionName,
  agent,
  onAgentLaunched,
}: {
  sessionName: string;
  agent: string | null;
  onAgentLaunched: (agent: string, ready: boolean) => void;
}) {
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState("");
  const [launchNotice, setLaunchNotice] = useState("");

  const launchAgent = async (id: AgentSpec["id"]) => {
    setLaunching(id);
    setLaunchError("");
    setLaunchNotice("");
    try {
      const res = await api.post(`/api/sessions/${sessionName}/launch-agent`, { agent: id });
      // ready=false: the CLI is still waiting on an interactive prompt the
      // server couldn't auto-answer — keep the user here instead of
      // bouncing to Chat, which can't drive interactive UIs.
      const ready = res.ready !== false;
      if (!ready) {
        setLaunchNotice("CLI 還在等待初始確認 — 請在下方終端機完成後，再手動切到 Chat 分頁。");
      }
      onAgentLaunched(id, ready);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : String(e));
    }
    setLaunching(null);
  };

  const [windows, setWindows] = useState<TmuxWindow[]>([]);
  const [activeWindow, setActiveWindow] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Load windows list
  const loadWindows = useCallback(async () => {
    try {
      let data = await api.get(`/api/sessions/${sessionName}/windows`);
      if (!data || data.length === 0) {
        // Session doesn't exist — create it
        await api.post("/api/sessions", {
          name: sessionName,
          display_name: sessionName,
        }).catch(() => {});
        // Retry loading windows
        data = await api.get(`/api/sessions/${sessionName}/windows`);
      }
      setWindows(data || []);
    } catch {
      setWindows([]);
    }
  }, [sessionName]);

  useEffect(() => {
    loadWindows();
  }, [loadWindows]);

  // Connect PTY to active window
  useEffect(() => {
    if (windows.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let terminal: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fitAddon: any = null;
    let ws: WebSocket | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPong = Date.now();
    let reconnectAttempts = 0;

    const wsUrl = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const wsPort = process.env.NEXT_PUBLIC_WS_PORT;
      const wsHost = wsPort
        ? `${location.hostname}:${wsPort}`
        : location.host;
      return `${proto}//${wsHost}/ws/terminal/${sessionName}/${activeWindow}`;
    };

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(wsUrl());

      ws.onopen = () => {
        reconnectAttempts = 0;
        lastPong = Date.now();
        if (ws && terminal) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
        // App-level heartbeat: probe every 25s; if no pong in 60s the
        // connection is stale — force close so onclose triggers reconnect.
        pingTimer = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastPong > 60000) {
            try { ws.close(); } catch { /* ignore */ }
            return;
          }
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
        }, 25000);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "output") {
            terminal?.write(msg.data);
          } else if (msg.type === "pong") {
            lastPong = Date.now();
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (cancelled) return;
        // Exponential backoff, capped at 10s.
        const delay = Math.min(500 * Math.pow(2, reconnectAttempts), 10000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(() => {
          if (!cancelled) connect();
        }, delay);
      };
    }

    // Force a quick liveness check when the tab/page becomes visible again.
    // Browsers often suspend timers while hidden, so the heartbeat may not
    // have fired in time to catch a connection killed during the idle period.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!ws) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      const probeStart = Date.now();
      try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
      setTimeout(() => {
        if (cancelled || !ws) return;
        if (lastPong < probeStart && ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch { /* ignore */ }
        }
      }, 3000);
    };

    async function initTerminal() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebglAddon } = await import("@xterm/addon-webgl");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      const { Unicode11Addon } = await import("@xterm/addon-unicode11");

      if (cancelled || !containerRef.current) return;

      // Clear previous terminal
      containerRef.current.innerHTML = "";

      terminal = new Terminal({
        theme: {
          background: "#0c0c0c",
          foreground: "#e0e0e0",
          cursor: "#e0e0e0",
        },
        fontSize: 13,
        fontFamily:
          "'SF Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace",
        cursorBlink: true,
        scrollback: 10000,
      });

      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      // Correct CJK/emoji widths — agents print plenty of both
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = "11";
      // URLs become clickable (agents paste PR/deploy links constantly)
      terminal.loadAddon(new WebLinksAddon());
      terminal.open(containerRef.current);
      // GPU renderer — same as VS Code's terminal. Big win for TUI-heavy
      // output (agent spinners redraw constantly). Falls back to the DOM
      // renderer on context loss or unsupported devices.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
      } catch { /* no WebGL — DOM renderer is fine */ }
      setTimeout(() => fitAddon.fit(), 50);

      // Copy-on-select for NATIVE selections (Shift+drag). Plain drag goes
      // through tmux copy-mode → OSC 52; this makes both paths end up in
      // the clipboard. Debounced so we don't spam the clipboard mid-drag.
      let copyTimer: ReturnType<typeof setTimeout> | null = null;
      terminal.onSelectionChange(() => {
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          const sel = terminal?.getSelection();
          if (sel) navigator.clipboard?.writeText(sel).catch(() => {});
        }, 200);
      });

      terminal.onData((data: string) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }));
        }
      });

      // OSC 52: tmux (set-clipboard on) reports copied text as
      // "<target>;<base64>" when a mouse-drag copy completes in copy-mode.
      // Write it to the browser clipboard so drag-to-select copies for
      // real — without this the text lands only in tmux's internal buffer
      // and the selection just seems to vanish. Requires a secure context
      // (https / localhost); silently a no-op elsewhere.
      terminal.parser.registerOscHandler(52, (data: string) => {
        const semi = data.indexOf(";");
        const b64 = semi >= 0 ? data.slice(semi + 1) : data;
        if (!b64 || b64 === "?") return true; // "?" is a read query — ignore
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const text = new TextDecoder().decode(bytes);
          navigator.clipboard?.writeText(text).catch(() => {});
        } catch { /* malformed base64 — drop */ }
        return true;
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon?.fit();
        if (ws && ws.readyState === WebSocket.OPEN && terminal) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            })
          );
        }
      });
      resizeObserver.observe(containerRef.current);

      // The parent hides inactive views with display:none rather than
      // unmounting, so xterm's canvas can end up blank when we switch back —
      // ResizeObserver fires the size change, but xterm doesn't repaint its
      // buffer on its own. Force a redraw whenever the container becomes
      // visible again.
      let wasVisible = false;
      const intersectionObserver = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible && !wasVisible) {
          fitAddon?.fit();
          if (terminal) terminal.refresh(0, terminal.rows - 1);
        }
        wasVisible = visible;
      });
      intersectionObserver.observe(containerRef.current);

      document.addEventListener("visibilitychange", onVisibility);

      connect();

      cleanupRef.current = () => {
        document.removeEventListener("visibilitychange", onVisibility);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        if (pingTimer) clearInterval(pingTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) {
          ws.onclose = null;
          try { ws.close(); } catch { /* ignore */ }
        }
        terminal?.dispose();
      };
    }

    initTerminal();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [sessionName, activeWindow, windows.length]);

  const addWindow = async () => {
    try {
      const w = await api.post(`/api/sessions/${sessionName}/windows`, {
        name: "shell",
      });
      await loadWindows();
      setActiveWindow(w.index);
    } catch {
      /* ignore */
    }
  };

  const closeWindow = async (index: number) => {
    if (windows.length <= 1) return; // don't close last window
    try {
      await api.del(`/api/sessions/${sessionName}/windows/${index}`);
      await loadWindows();
      if (activeWindow === index) {
        setActiveWindow(windows[0].index === index ? windows[1].index : windows[0].index);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="view-panel terminal-view">
      {/* Window tabs */}
      {windows.length > 0 && (
        <div className="terminal-window-tabs">
          {windows.map((w) => (
            <button
              key={w.index}
              className={`terminal-window-tab${activeWindow === w.index ? " active" : ""}`}
              onClick={() => setActiveWindow(w.index)}
            >
              <span className="terminal-window-name">
                {w.index === 0 ? (agent || "main") : w.name}
              </span>
              {w.index !== 0 && (
                <span
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWindow(w.index);
                  }}
                >
                  &times;
                </span>
              )}
            </button>
          ))}
          <button className="terminal-window-tab add-tab" onClick={addWindow}>
            +
          </button>
        </div>
      )}

      {/* Terminal */}
      <div className="terminal-wrap">
        <div className="terminal-container" ref={containerRef} />
      </div>
      <div className="terminal-bar">
        {agent ? (
          <span className="terminal-agent-status">
            目前 agent：<strong>{AGENTS.find((a) => a.id === agent)?.label || agent}</strong>
            <button
              className="terminal-agent-relaunch"
              title="重新啟動 agent CLI"
              onClick={() => launchAgent(agent as AgentSpec["id"])}
              disabled={launching !== null}
            >
              {launching ? "重啟中..." : "重啟"}
            </button>
          </span>
        ) : (
          <span className="terminal-agent-launchers">
            啟用 AI agent：
            {AGENTS.map((a) => (
              <button
                key={a.id}
                className={`terminal-agent-btn${a.available ? "" : " disabled"}`}
                disabled={!a.available || launching !== null}
                title={a.available ? `啟動 ${a.label}` : a.comingSoonHint}
                onClick={() => a.available && launchAgent(a.id)}
              >
                {launching === a.id ? "啟動中..." : `▶ ${a.label}`}
                {!a.available && <span className="badge-soon">soon</span>}
              </button>
            ))}
          </span>
        )}
        <span className="terminal-focus-hint">Tap terminal to type</span>
      </div>
      {launchError && <div className="terminal-launch-error">{launchError}</div>}
      {launchNotice && <div className="terminal-launch-error" style={{ color: "#fbbf24" }}>{launchNotice}</div>}
    </div>
  );
}
