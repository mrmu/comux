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
  priority: string; // high / medium / low
  running: boolean;
  cwd: string;
  command: string;
  hosts: HostInfo[];
}

const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const PRIORITY_NEXT: Record<string, string> = { high: "medium", medium: "low", low: "high" };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

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
  const [showLow, setShowLow] = useState(false);
  const [opens, setOpens] = useState<Record<string, { n: number; at: number }>>({});

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.get("/api/sessions"));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { loadSessions(); setOpens(loadOpens()); }, [loadSessions]);

  // Tap the badge to cycle 高→中→低. Optimistic — the PUT confirms it.
  const cyclePriority = async (s: SessionInfo) => {
    const next = PRIORITY_NEXT[s.priority] || "medium";
    setSessions((prev) => prev.map((p) => (p.name === s.name ? { ...p, priority: next } : p)));
    try {
      await api.put(`/api/projects/${s.name}`, { priority: next });
    } catch {
      loadSessions(); // revert to server truth
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SessionInfo) => {
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
    // Priority first, then most-opened, recency, name.
    return sessions.filter(match).sort((a, b) => {
      const pr = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      if (pr !== 0) return pr;
      const oa = opens[a.name] || { n: 0, at: 0 };
      const ob = opens[b.name] || { n: 0, at: 0 };
      if (ob.n !== oa.n) return ob.n - oa.n;
      if (ob.at !== oa.at) return ob.at - oa.at;
      return a.name.localeCompare(b.name);
    });
  }, [sessions, query, opens]);

  // Low-priority projects stay collapsed — unless the user is searching,
  // in which case they explicitly want to find things.
  const searching = query.trim().length > 0;
  const active = searching ? filtered : filtered.filter((s) => s.priority !== "low");
  const low = searching ? [] : filtered.filter((s) => s.priority === "low");

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

  const renderCard = (s: SessionInfo) => (
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
      <button
        className={`priority-badge ${s.priority}`}
        title="點擊切換優先度（高→中→低）"
        onClick={(e) => { e.stopPropagation(); cyclePriority(s); }}
      >
        {PRIORITY_LABEL[s.priority] || "中"}
      </button>
      <div className={`session-card-status${s.running ? " active" : ""}`} />
    </div>
  );

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
      </div>

      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#x229E;</div>
            <p>No projects yet.<br />Create one to get started.</p>
          </div>
        ) : active.length === 0 && low.length === 0 ? (
          <div className="empty-state">
            <p>沒有符合「{query}」的專案</p>
          </div>
        ) : (
          <>
            {active.map(renderCard)}
            {low.length > 0 && (
              <>
                <button className="low-priority-toggle" onClick={() => setShowLow((v) => !v)}>
                  {showLow ? "▾" : "▸"} 低優先（{low.length}）
                </button>
                {showLow && low.map(renderCard)}
              </>
            )}
          </>
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
