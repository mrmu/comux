"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import NewSessionModal from "@/components/NewSessionModal";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";

interface HostInfo {
  id: number;
  name: string;
  ssh_target: string;
  env: string;
  description: string;
  path: string;
  machine: string | null;
}

interface SessionInfo {
  name: string;
  display_name: string;
  description: string;
  color: string;
  running: boolean;
  cwd: string;
  command: string;
  hosts: HostInfo[];
}

// Open-frequency tracking, per browser. {name: {n: count, at: lastOpenMs}}
const OPENS_KEY = "comux:projectOpens";

function loadOpens(): Record<string, { n: number; at: number }> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(OPENS_KEY) || "{}"); }
  catch { return {}; }
}

function recordOpen(name: string) {
  try {
    const opens = loadOpens();
    const cur = opens[name] || { n: 0, at: 0 };
    opens[name] = { n: cur.n + 1, at: Date.now() };
    window.localStorage.setItem(OPENS_KEY, JSON.stringify(opens));
  } catch { /* ignore */ }
}

export default function ProjectsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [query, setQuery] = useState("");
  const [machineFilter, setMachineFilter] = useState<string | null>(null);
  const [opens, setOpens] = useState<Record<string, { n: number; at: number }>>({});

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.get("/api/sessions"));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { loadSessions(); setOpens(loadOpens()); }, [loadSessions]);

  // Machine filter chips — built from every host's machine (or legacy
  // ssh_target), so "which box is this on" is one tap away.
  const machines = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      for (const h of s.hosts) set.add(h.machine || h.ssh_target || "");
    }
    set.delete("");
    return [...set].sort();
  }, [sessions]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SessionInfo) => {
      if (machineFilter && !s.hosts.some((h) => (h.machine || h.ssh_target) === machineFilter)) {
        return false;
      }
      if (!q) return true;
      // Name, display name, and every URL-ish field: project description
      // plus host descriptions (both carry the site URL by convention).
      const hay = [
        s.name,
        s.display_name,
        s.description,
        ...s.hosts.flatMap((h) => [h.description, h.machine || h.ssh_target, h.path]),
      ].join("\n").toLowerCase();
      return hay.includes(q);
    };
    // Most-opened first, recency breaks ties, then name for stability.
    return sessions.filter(match).sort((a, b) => {
      const oa = opens[a.name] || { n: 0, at: 0 };
      const ob = opens[b.name] || { n: 0, at: 0 };
      if (ob.n !== oa.n) return ob.n - oa.n;
      if (ob.at !== oa.at) return ob.at - oa.at;
      return a.name.localeCompare(b.name);
    });
  }, [sessions, query, machineFilter, opens]);

  const openProject = (s: SessionInfo) => {
    recordOpen(s.name);
    if (s.running) {
      router.push(`/projects/${s.name}`);
    } else {
      // Restart then enter in one click — a stopped card should behave
      // like a running one, just with a spin-up first.
      (async () => {
        try {
          await api.post("/api/sessions", {
            name: s.name, display_name: s.display_name,
            cwd: s.cwd, command: s.command, color: s.color,
          });
          router.push(`/projects/${s.name}`);
        } catch {
          loadSessions(); // restart failed — refresh so state stays honest
        }
      })();
    }
  };

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="projects" />
        <MachineBadge />
        <button className="icon-btn" title="New project" onClick={() => setShowModal(true)}>+</button>
      </header>

      <div className="project-toolbar">
        <input
          type="search"
          className="project-search"
          placeholder="搜尋專案名稱或網址…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {machines.length > 1 && (
          <div className="machine-chips">
            <button
              className={`machine-chip${machineFilter === null ? " active" : ""}`}
              onClick={() => setMachineFilter(null)}
            >
              全部
            </button>
            {machines.map((m) => (
              <button
                key={m}
                className={`machine-chip${machineFilter === m ? " active" : ""}`}
                onClick={() => setMachineFilter(machineFilter === m ? null : m)}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#x229E;</div>
            <p>No projects yet.<br />Create one to get started.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <p>沒有符合「{query || machineFilter}」的專案</p>
          </div>
        ) : (
          visible.map((s) => (
            <div key={s.name} className="session-card" onClick={() => openProject(s)}>
              <div className="session-dot" style={{ background: s.color, opacity: s.running ? 1 : 0.4 }}>
                {s.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="session-card-info">
                <div className="session-card-name">{s.display_name}</div>
                <div className="session-card-meta">
                  {s.name} &middot; {s.running ? "running" : "stopped"}
                  {s.description && <> &middot; {s.description.replace(/^https?:\/\//, "")}</>}
                  {s.hosts[0]?.machine && <> &middot; {s.hosts[0].machine}</>}
                </div>
              </div>
              <div className={`session-card-status${s.running ? " active" : ""}`} />
            </div>
          ))
        )}
      </div>
      {showModal && (
        <NewSessionModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); loadSessions(); }}
        />
      )}
    </div>
  );
}
