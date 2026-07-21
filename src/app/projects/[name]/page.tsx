"use client";

import { Suspense, useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import ChatView from "@/components/ChatView";
import TerminalView from "@/components/TerminalView";
import FileBrowser from "@/components/FileBrowser";
import FileEditor from "@/components/FileEditor";
import NotesPanel from "@/components/NotesPanel";
import ProjectSettings from "@/components/ProjectSettings";

interface SessionInfo {
  name: string;
  display_name: string;
  color: string;
  running: boolean;
}

const OPEN_TABS_KEY = "comux:openProjectTabs";

function loadOpenTabs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OPEN_TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

function persistOpenTabs(tabs: string[]) {
  try { window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs)); }
  catch { /* localStorage full / blocked — nothing we can do */ }
}

interface OpenFile {
  path: string;
  modified: boolean;
}

function WorkspacePageContent({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: projectName } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Terminal is the primary surface; "chat" is a read-only transcript.
  const initialTab = searchParams.get("tab") || "terminal";

  const [activeView, setActiveView] = useState<string>(initialTab);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  // Open project tabs — persisted per browser. Always includes the
  // current project; closing a tab removes it from this list and
  // navigates away if it was the active one.
  const [openTabs, setOpenTabs] = useState<string[]>(loadOpenTabs);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Confirm the project exists before mounting Chat/Terminal. Without this,
  // TerminalView's "empty windows → POST /api/sessions" retry would
  // auto-create a stray Project row for any name typed into the URL
  // (stale bookmarks, old cache, etc.).
  const [projectReady, setProjectReady] = useState<boolean>(false);
  // Which AI agent is currently launched in this project (claude / codex /
  // gemini). Drives Chat-tab visibility and which transcript adapter the
  // chat view will use. null until the user clicks a launch button.
  const [agent, setAgent] = useState<string | null>(null);

  // Track which project we last loaded so we can tell "first mount" apart
  // from "user switched tabs". On a switch we override activeView to the
  // destination's preferred default (chat if it has an agent, else
  // terminal); on first mount we leave the URL's ?tab= intact.
  const prevProjectName = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isSwitch =
      prevProjectName.current !== null && prevProjectName.current !== projectName;
    prevProjectName.current = projectName;
    (async () => {
      let proj: { agent?: string | null } | null = null;
      try {
        proj = await api.get(`/api/projects/${projectName}`);
      } catch {
        if (!cancelled) router.replace("/projects");
        return;
      }
      if (cancelled) return;
      setProjectReady(true);
      setAgent(proj?.agent || null);
      if (isSwitch) {
        const target = "terminal";
        setActiveView(target);
        router.replace(`/projects/${projectName}?tab=${target}`, { scroll: false });
      }
      try { setSessions(await api.get("/api/sessions")); } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectName, router]);

  // The transcript tab is only meaningful once an agent has been used;
  // if the URL asks for it on a project without one, fall back to Terminal.
  useEffect(() => {
    if (projectReady && !agent && activeView === "chat") setActiveView("terminal");
  }, [projectReady, agent, activeView]);

  // Make sure the current project is in the open-tabs list; once the
  // sessions list has loaded, also drop any stale names (deleted
  // projects, or renamed ones the user no longer owns). Pruning is
  // gated on `sessions.length > 0` because an empty `sessions` means
  // "still loading" — pruning then would wipe every other tab the
  // user opened in a previous visit.
  useEffect(() => {
    setOpenTabs((prev) => {
      let next = prev;
      if (!next.includes(projectName)) next = [...next, projectName];
      if (sessions.length > 0) {
        const validNames = new Set(sessions.map((s) => s.name));
        next = next.filter((n) => validNames.has(n) || n === projectName);
      }
      if (next.length === prev.length && next.every((n, i) => n === prev[i])) return prev;
      persistOpenTabs(next);
      return next;
    });
  }, [projectName, sessions]);

  // Tab close confirm — only shown when the session is still running, so a
  // casual tab close can't silently kill a working agent, but ending the
  // session (VS Code-style) is one click away.
  const [closingTab, setClosingTab] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);

  const closeProjectTab = useCallback(
    (name: string) => {
      setOpenTabs((prev) => {
        const idx = prev.indexOf(name);
        if (idx < 0) return prev;
        const next = prev.filter((n) => n !== name);
        persistOpenTabs(next);
        if (name === projectName) {
          // Navigate to the neighbouring tab (previous if available, else
          // next, else back to the project list).
          const fallback = next[idx] || next[idx - 1] || null;
          if (fallback) router.push(`/projects/${fallback}`);
          else router.push("/projects");
        }
        return next;
      });
    },
    [projectName, router]
  );

  /** X on a tab: prompt if the tmux session is alive, close straight away
   *  if it isn't. */
  const requestCloseTab = useCallback(
    (name: string) => {
      const p = sessions.find((s) => s.name === name);
      if (p?.running) setClosingTab(name);
      else closeProjectTab(name);
    },
    [sessions, closeProjectTab]
  );

  const endSessionAndCloseTab = useCallback(async () => {
    if (!closingTab) return;
    setCloseBusy(true);
    try {
      // keep=true: kill tmux only — project data stays
      await api.del(`/api/sessions/${closingTab}?keep=true`);
      try { setSessions(await api.get("/api/sessions")); } catch { /* ignore */ }
      closeProjectTab(closingTab);
      setClosingTab(null);
    } catch (e) {
      alert("結束 session 失敗：" + (e instanceof Error ? e.message : String(e)));
    }
    setCloseBusy(false);
  }, [closingTab, closeProjectTab]);

  // Sync tab to URL
  const switchView = useCallback((view: string) => {
    setActiveView(view);
    const tab = view.startsWith("file:") ? "file" : view;
    router.replace(`/projects/${projectName}?tab=${tab}`, { scroll: false });
  }, [router, projectName]);

  const switchProject = useCallback((name: string) => {
    router.push(`/projects/${name}`);
  }, [router]);

  const openFile = useCallback((filePath: string) => {
    const existing = openFiles.find((f) => f.path === filePath);
    if (!existing) {
      setOpenFiles((prev) => [...prev, { path: filePath, modified: false }]);
    }
    switchView("file:" + filePath);
  }, [openFiles, switchView]);

  const closeFile = useCallback((filePath: string) => {
    const file = openFiles.find((f) => f.path === filePath);
    if (file?.modified && !confirm(`${filePath} has unsaved changes. Close anyway?`)) return;
    setOpenFiles((prev) => prev.filter((f) => f.path !== filePath));
    if (activeView === "file:" + filePath) switchView("chat");
  }, [openFiles, activeView, switchView]);

  const setFileModified = useCallback((filePath: string, modified: boolean) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === filePath ? { ...f, modified } : f))
    );
  }, []);

  const closeAllPanels = useCallback(() => {
    setShowFiles(false);
    setShowNotes(false);
    setShowSettings(false);
  }, []);

  const togglePanel = useCallback((panel: "files" | "notes" | "settings") => {
    setShowFiles(panel === "files" ? (v) => !v : false);
    setShowNotes(panel === "notes" ? (v) => !v : false);
    setShowSettings(panel === "settings" ? (v) => !v : false);
  }, []);

  // "Ask AI" from a note: paste the text into the agent's terminal input
  // (bracketed paste — nothing auto-submits) and bring the Terminal up so
  // the user can review and hit Enter.
  const askAIFromNote = useCallback(async (text: string) => {
    closeAllPanels();
    switchView("terminal");
    try {
      await api.post(`/api/sessions/${projectName}/send`, { text, paste: true });
    } catch {
      alert("送到 Terminal 失敗 — 請確認 session 還在執行。");
    }
  }, [closeAllPanels, switchView, projectName]);

  if (!projectReady) return null;

  return (
    <div className="screen">
      {/* Layer 1: Project Tabs */}
      <div className="project-tabs-bar">
        <button className="tab-back-btn" onClick={() => router.push("/projects")} title="Back to list">
          &larr;
        </button>
        <div className="project-tabs-scroll">
          {openTabs.map((tabName) => {
            const p = sessions.find((s) => s.name === tabName);
            // If sessions hasn't loaded yet, fall back to the bare name
            // for the current tab so the bar isn't empty mid-load.
            const display = p?.display_name || tabName;
            const color = p?.color;
            const isCurrent = tabName === projectName;
            return (
              <button
                key={tabName}
                className={`project-tab${isCurrent ? " active" : ""}`}
                style={isCurrent && color ? { borderBottomColor: color } : undefined}
                onClick={() => !isCurrent && switchProject(tabName)}
              >
                <span>{display}</span>
                <span
                  className="tab-close"
                  title="關閉專案分頁"
                  onClick={(e) => { e.stopPropagation(); requestCloseTab(tabName); }}
                >&times;</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Close-tab confirm — session still running */}
      {closingTab && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setClosingTab(null)}>
          <div className="modal">
            <h2>關閉「{sessions.find((s) => s.name === closingTab)?.display_name || closingTab}」</h2>
            <p className="settings-hint" style={{ marginBottom: "1rem" }}>
              這個專案的 tmux session 還在執行中 — 終端機裡的程式（含 AI agent）可能正在跑。
              只關閉分頁的話，session 會繼續在背景執行，隨時可以回來。
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setClosingTab(null)} disabled={closeBusy}>
                取消
              </button>
              <button
                className="btn-secondary"
                onClick={() => { closeProjectTab(closingTab); setClosingTab(null); }}
                disabled={closeBusy}
              >
                只關閉分頁
              </button>
              <button className="btn-danger" onClick={endSessionAndCloseTab} disabled={closeBusy}>
                {closeBusy ? "結束中..." : "結束 session 並關閉"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layer 2: View Tabs */}
      <div className="view-tabs-bar">
        <div className="view-tabs-scroll">
          {agent && (
            <button className={`view-tab${activeView === "chat" ? " active" : ""}`}
              onClick={() => { closeAllPanels(); switchView("chat"); }}
              title="唯讀對話紀錄">Transcript</button>
          )}
          <button className={`view-tab${activeView === "terminal" ? " active" : ""}`}
            onClick={() => { closeAllPanels(); switchView("terminal"); }}>Terminal</button>
          {openFiles.map((f) => {
            const viewId = "file:" + f.path;
            const fileName = f.path.split("/").pop();
            return (
              <button key={viewId}
                className={`view-tab file-tab${activeView === viewId ? " active" : ""}${f.modified ? " modified" : ""}`}
                onClick={() => { closeAllPanels(); switchView(viewId); }}>
                <span className="tab-filename">{fileName}</span>
                <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeFile(f.path); }}>&times;</span>
              </button>
            );
          })}
        </div>
        <div className="view-bar-actions">
          <button className="view-action-btn" title="Security scans for this project" onClick={() => router.push(`/scans?project=${projectName}`)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>
            </svg>
          </button>
          <button className="view-action-btn" title="Issues for this project" onClick={() => router.push(`/issues?project=${projectName}`)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
            </svg>
          </button>
          <button className={`view-action-btn${showSettings ? " active" : ""}`} title="Settings" onClick={() => togglePanel("settings")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button className={`view-action-btn${showNotes ? " active" : ""}`} title="Notes" onClick={() => togglePanel("notes")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
          </button>
          <button className={`view-action-btn${showFiles ? " active" : ""}`} title="Files" onClick={() => togglePanel("files")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="workspace-content">
        {agent && (
          <div style={{ display: activeView === "chat" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
            <ChatView key={projectName} sessionName={projectName} />
          </div>
        )}
        <div style={{ display: activeView === "terminal" ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <TerminalView
            key={projectName}
            sessionName={projectName}
            agent={agent}
            onAgentLaunched={(a) => setAgent(a)}
          />
        </div>

        {openFiles.map((f) => {
          const viewId = "file:" + f.path;
          if (activeView !== viewId) return null;
          return (
            <FileEditor key={f.path} sessionName={projectName} filePath={f.path}
              onModifiedChange={(modified) => setFileModified(f.path, modified)} />
          );
        })}

        {showFiles && <FileBrowser sessionName={projectName} onOpenFile={openFile} onClose={() => setShowFiles(false)} />}
        {showNotes && <NotesPanel sessionName={projectName} onClose={() => setShowNotes(false)} onAskAI={askAIFromNote} />}
        {showSettings && (
          <ProjectSettings
            projectName={projectName}
            onClose={() => setShowSettings(false)}
            onDeleted={() => router.push("/projects")}
            onAskAI={askAIFromNote}
            onOpenFile={(path) => { setShowSettings(false); openFile(path); }}
          />
        )}
      </div>
    </div>
  );
}

export default function WorkspacePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <WorkspacePageContent params={params} />
    </Suspense>
  );
}
