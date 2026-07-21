"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";
import { api } from "@/lib/api";
import { ISSUE_STATUSES, ISSUE_SEVERITIES, isClosedStatus } from "@/lib/issues";

interface Issue {
  id: number;
  project_name: string;
  title: string;
  status: string;
  severity: string;
  assigned_to: string;
  created_at: number;
}

interface Project {
  name: string;
  display_name: string;
  color: string;
}

function formatAge(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function IssuesListPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // Seed project filter from ?project=<name> so opening the Issues icon from
  // within a project page lands you on that project's issues.
  const [projectFilter, setProjectFilter] = useState(
    () => searchParams.get("project") || ""
  );
  const [statusFilter, setStatusFilter] = useState("OPEN_ONLY"); // OPEN_ONLY, ALL, or specific
  const [severityFilter, setSeverityFilter] = useState("");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (projectFilter) p.set("project", projectFilter);
    if (statusFilter === "OPEN_ONLY") {
      p.append("status", "OPEN");
      p.append("status", "IN_PROGRESS");
    } else if (statusFilter !== "ALL") {
      p.append("status", statusFilter);
    }
    if (severityFilter) p.append("severity", severityFilter);
    return p.toString();
  }, [projectFilter, statusFilter, severityFilter]);

  const load = useCallback(async () => {
    try {
      setIssues(await api.get(`/api/issues?${query}`));
    } catch {
      setIssues([]);
    }
  }, [query]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        setProjects(await api.get("/api/sessions"));
      } catch {
        setProjects([]);
      }
    })();
  }, []);

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="issues" />
        <MachineBadge />
        <button
          className="icon-btn"
          title="New issue"
          onClick={() => router.push("/issues/new")}
        >
          +
        </button>
      </header>

      <div className="issue-filters">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.name} value={p.name}>
              {p.display_name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="OPEN_ONLY">Open</option>
          <option value="ALL">All statuses</option>
          {ISSUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">Any severity</option>
          {ISSUE_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="session-list">
        {issues.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">&#x229E;</div>
            <p>
              No issues match these filters.
              <br />
              Create one to get started.
            </p>
          </div>
        ) : (
          issues.map((i) => (
            <div
              key={i.id}
              className="issue-card"
              onClick={() => router.push(`/issues/${i.id}`)}
            >
              <div className="issue-card-main">
                <div className="issue-card-title">{i.title}</div>
                <div className="issue-card-meta">
                  <span className="issue-meta-project">{i.project_name}</span>
                  {i.assigned_to && (
                    <>
                      <span className="issue-meta-sep">&middot;</span>
                      <span>{i.assigned_to}</span>
                    </>
                  )}
                  <span className="issue-meta-sep">&middot;</span>
                  <span>{formatAge(i.created_at)}</span>
                </div>
              </div>
              <div className="issue-badges">
                <span className={`severity-badge sev-${i.severity.toLowerCase()}`}>
                  {i.severity}
                </span>
                <span
                  className={`status-badge status-${i.status.toLowerCase()}${isClosedStatus(i.status) ? " status-closed" : ""}`}
                >
                  {i.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function IssuesListPage() {
  return (
    <Suspense fallback={null}>
      <IssuesListPageContent />
    </Suspense>
  );
}
