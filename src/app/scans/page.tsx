"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";
import { api } from "@/lib/api";

interface Project {
  name: string;
  display_name: string;
  color: string;
}

interface Scan {
  id: number;
  tool: string;
  tool_version: string;
  ruleset_ref: string;
  commit_sha: string;
  status: string;
  error_message: string;
  started_at: number;
  finished_at: number;
  summary: { CRITICAL?: number; HIGH?: number; MEDIUM?: number; LOW?: number; INFO?: number };
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function formatDuration(start: number, end: number): string {
  if (!start || !end) return "";
  const s = end - start;
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function ScansListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState(
    () => searchParams.get("project") || ""
  );
  const [scans, setScans] = useState<Scan[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!selectedProject) {
      setScans([]);
      return;
    }
    try {
      setScans(await api.get(`/api/sessions/${selectedProject}/scans`));
    } catch {
      setScans([]);
    }
  }, [selectedProject]);

  useEffect(() => {
    (async () => {
      try {
        setProjects(await api.get("/api/sessions"));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // Auto-refresh while any scan is RUNNING
  useEffect(() => {
    const hasRunning = scans.some((s) => s.status === "RUNNING");
    if (!hasRunning) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [scans, load]);

  const triggerScan = async () => {
    if (!selectedProject) {
      setError("Select a project first");
      return;
    }
    setError("");
    setTriggering(true);
    try {
      const res = await api.post(`/api/sessions/${selectedProject}/scans`, {});
      router.push(`/scans/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger scan");
      setTriggering(false);
    }
  };

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="scans" />
        <MachineBadge />
        <button
          className="icon-btn"
          title="Run new scan"
          onClick={triggerScan}
          disabled={triggering || !selectedProject}
        >
          {triggering ? "…" : "+"}
        </button>
      </header>

      <div className="issue-filters">
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          <option value="">Select project…</option>
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.display_name}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="error-text" style={{ padding: "0.6rem 1rem" }}>{error}</div>}

      <div className="session-list">
        {!selectedProject ? (
          <div className="empty-state">
            <p>Select a project above to view its scans.</p>
          </div>
        ) : scans.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#x229E;</div>
            <p>
              No scans yet for this project.
              <br />
              Click + to run the first scan.
            </p>
          </div>
        ) : (
          scans.map((s) => {
            const summary = s.summary || {};
            const crit = summary.CRITICAL || 0;
            const high = summary.HIGH || 0;
            const med = summary.MEDIUM || 0;
            const low = summary.LOW || 0;
            return (
              <div
                key={s.id}
                className="issue-card"
                onClick={() => router.push(`/scans/${s.id}`)}
              >
                <div className="issue-card-main">
                  <div className="issue-card-title">
                    {s.tool} {s.tool_version && `v${s.tool_version}`}
                    {s.commit_sha && (
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          fontFamily: "SF Mono, monospace",
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
                          fontWeight: "normal",
                        }}
                      >
                        @{s.commit_sha.slice(0, 7)}
                      </span>
                    )}
                  </div>
                  <div className="issue-card-meta">
                    <span>{formatTime(s.started_at)}</span>
                    {s.finished_at > 0 && (
                      <>
                        <span className="issue-meta-sep">&middot;</span>
                        <span>{formatDuration(s.started_at, s.finished_at)}</span>
                      </>
                    )}
                    <span className="issue-meta-sep">&middot;</span>
                    <span className="issue-meta-project">{s.ruleset_ref}</span>
                  </div>
                </div>
                <div className="issue-badges">
                  {s.status === "RUNNING" && (
                    <span className="status-badge status-open">RUNNING</span>
                  )}
                  {s.status === "FAILED" && (
                    <span className="severity-badge sev-high">FAILED</span>
                  )}
                  {s.status === "SUCCESS" && (
                    <>
                      {crit > 0 && <span className="severity-badge sev-critical">{crit} C</span>}
                      {high > 0 && <span className="severity-badge sev-high">{high} H</span>}
                      {med > 0 && <span className="severity-badge sev-medium">{med} M</span>}
                      {low > 0 && <span className="severity-badge sev-low">{low} L</span>}
                      {crit + high + med + low === 0 && (
                        <span className="status-badge status-fixed">CLEAN</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function ScansListPage() {
  return (
    <Suspense fallback={null}>
      <ScansListPageContent />
    </Suspense>
  );
}
