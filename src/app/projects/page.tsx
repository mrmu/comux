"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import NewSessionModal from "@/components/NewSessionModal";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";

interface SessionInfo {
  name: string;
  display_name: string;
  color: string;
  running: boolean;
  cwd: string;
  command: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showModal, setShowModal] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.get("/api/sessions"));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="projects" />
        <MachineBadge />
        <button className="icon-btn" title="New project" onClick={() => setShowModal(true)}>+</button>
      </header>
      <div className="session-list">
        {sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#x229E;</div>
            <p>No projects yet.<br />Create one to get started.</p>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.name}
              className="session-card"
              onClick={() => {
                if (s.running) {
                  router.push(`/projects/${s.name}`);
                } else {
                  (async () => {
                    try {
                      await api.post("/api/sessions", {
                        name: s.name, display_name: s.display_name,
                        cwd: s.cwd, command: s.command, color: s.color,
                      });
                      loadSessions();
                    } catch { /* ignore */ }
                  })();
                }
              }}>
              <div className="session-dot" style={{ background: s.color, opacity: s.running ? 1 : 0.4 }}>
                {s.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="session-card-info">
                <div className="session-card-name">{s.display_name}</div>
                <div className="session-card-meta">
                  {s.name} &middot; {s.running ? "running" : "stopped"}
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
