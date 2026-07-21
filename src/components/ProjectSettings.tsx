"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { TrashIcon } from "./icons";
import { classifyRepoUrl } from "@/lib/repo-url";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#ef4444", "#64748b",
];

interface Host {
  id: number;
  name: string;
  ssh_target: string;
  machine_id: number | null;
  path: string;
  deploy_type: string;
  env: string;
  description: string;
  machine: { id: number; hostname: string; ssh_user: string; is_self: boolean } | null;
}

interface MachineOpt {
  id: number;
  hostname: string;
  ssh_user: string;
  online: boolean;
  is_self: boolean;
}

interface ChatSession {
  sessionId: string;
  mtime: number;
  active: boolean;
}

interface GitStatus {
  cwd: string;
  repoUrl: string;
  repoUrlKind: "ssh" | "https" | "unknown" | "empty";
  cwdExists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  remoteUrl: string;
  remoteMatches: boolean | null;
}

interface HealthCheck {
  id: string;
  label: string;
  ok: boolean | null;
  detail: string;
  hint: string;
}

function RepoUrlHint({ url }: { url: string }) {
  const kind = classifyRepoUrl(url);
  if (kind === "empty") return null;
  if (kind === "ssh") {
    return (
      <p className="settings-hint" style={{ margin: "-0.25rem 0 0.5rem" }}>
        ✅ SSH 格式，可 push。需先把這台 comux 主機的 ssh 公鑰加到 git host 的 deploy keys。
      </p>
    );
  }
  if (kind === "https") {
    return (
      <p className="settings-hint" style={{ margin: "-0.25rem 0 0.5rem", color: "#fbbf24" }}>
        ⚠ HTTPS 格式：可讀取，但 agent 改完程式碼無法 push 回 repo。
        若需要 push，請改用 SSH（<code>git@host:user/repo.git</code>）。
      </p>
    );
  }
  return (
    <p className="settings-hint" style={{ margin: "-0.25rem 0 0.5rem", color: "#fbbf24" }}>
      ⚠ 無法識別 URL 格式。建議用 <code>git@host:user/repo.git</code>。
    </p>
  );
}

function HealthCheckSection({
  checks,
  busy,
  onRerun,
  canClone,
  cloneBusy,
  onClone,
}: {
  checks: HealthCheck[] | null;
  busy: boolean;
  onRerun: () => void;
  canClone: boolean;
  cloneBusy: boolean;
  onClone: () => void;
}) {
  // The two checks that "Clone" can resolve directly. Showing the button
  // here saves the user from scrolling back up to 版本庫.
  const cloneFixesIds = new Set(["cwd-exists", "is-git-repo"]);
  const failing = checks?.filter((c) => c.ok === false).length ?? 0;
  const passing = checks?.filter((c) => c.ok === true).length ?? 0;
  const skipped = checks?.filter((c) => c.ok === null).length ?? 0;
  return (
    <section className="settings-section">
      <h3>
        健檢
        <button
          onClick={onRerun}
          disabled={busy}
          style={{
            marginLeft: "0.75rem",
            fontSize: "0.8rem",
            padding: "0.15rem 0.5rem",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 4,
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
          title="重跑所有檢查"
        >
          {busy ? "檢查中..." : "重跑"}
        </button>
      </h3>
      <p className="settings-hint">
        檢查 comux 在這台主機是否能對這個專案開工：目錄權限、git remote、ssh push、CLI 工具。
        每次設定有變動會自動重跑；也可手動點「重跑」。
      </p>
      {checks === null ? (
        <p className="settings-hint">{busy ? "檢查中..." : "尚未檢查"}</p>
      ) : checks.length === 0 ? (
        <p className="settings-hint">沒有檢查項目</p>
      ) : (
        <>
          <p className="settings-hint" style={{ marginBottom: "0.5rem" }}>
            {failing === 0
              ? `✅ 全部通過（${passing} / ${passing + skipped}，${skipped} 項略過）`
              : `⚠ ${failing} 項失敗、${passing} 項通過${skipped > 0 ? `、${skipped} 項略過` : ""}`}
          </p>
          <div className="agent-pointer-list">
            {checks.map((c) => (
              <div key={c.id} style={{ marginBottom: "0.4rem" }}>
                <div
                  className={`claudemd-status ${
                    c.ok === true ? "ok" : c.ok === false ? "warn" : ""
                  }`}
                >
                  <span className="claudemd-icon">
                    {c.ok === true ? "✅" : c.ok === false ? "⚠" : "○"}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>{c.label}</strong>
                    {c.detail && (
                      <span className="settings-hint" style={{ marginLeft: "0.5rem" }}>
                        — {c.detail}
                      </span>
                    )}
                  </span>
                </div>
                {c.ok === false && c.hint && (
                  <p className="pointer-error" style={{ marginLeft: "1.5rem" }}>
                    {c.hint}
                    {canClone && cloneFixesIds.has(c.id) && (
                      <button
                        onClick={onClone}
                        disabled={cloneBusy}
                        className="btn-primary"
                        style={{
                          marginLeft: "0.6rem",
                          padding: "0.15rem 0.6rem",
                          fontSize: "0.8rem",
                        }}
                      >
                        {cloneBusy ? "Clone 中..." : "Clone"}
                      </button>
                    )}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function GitStatusBlock({
  status,
  cwd,
  repoUrl,
  cloneBusy,
  cloneError,
  onClone,
}: {
  status: GitStatus | null;
  cwd: string;
  repoUrl: string;
  cloneBusy: boolean;
  cloneError: string;
  onClone: () => void;
}) {
  if (!cwd || !repoUrl) return null;
  if (!status) return null;

  const canClone = !status.isGitRepo && (status.isEmpty || !status.cwdExists);

  let line: { icon: string; text: string; tone: "ok" | "warn" };
  if (status.isGitRepo) {
    if (status.remoteMatches === false) {
      line = {
        icon: "⚠",
        tone: "warn",
        text: `已 clone，但 remote 不一致：${status.remoteUrl || "(無)"}`,
      };
    } else {
      line = { icon: "✅", tone: "ok", text: "已 clone，remote 與設定一致" };
    }
  } else if (!status.cwdExists) {
    line = { icon: "⚠", tone: "warn", text: "工作目錄不存在 — 可從這裡 clone" };
  } else if (status.isEmpty) {
    line = { icon: "⚠", tone: "warn", text: "工作目錄是空的 — 可從這裡 clone" };
  } else {
    line = {
      icon: "⚠",
      tone: "warn",
      text: "目錄有檔案但不是 git repo — 請手動處理（移走檔案或在主機上 git init）",
    };
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <div className={`claudemd-status ${line.tone}`}>
        <span className="claudemd-icon">{line.icon}</span>
        <span style={{ flex: 1 }}>{line.text}</span>
        {canClone && (
          <button
            className="btn-primary"
            onClick={onClone}
            disabled={cloneBusy}
            style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
          >
            {cloneBusy ? "Clone 中..." : "Clone"}
          </button>
        )}
      </div>
      {cloneError && <p className="pointer-error">{cloneError}</p>}
    </div>
  );
}

export default function ProjectSettings({
  projectName,
  onClose,
  onDeleted,
  onAskAI,
  onOpenFile,
}: {
  projectName: string;
  onClose: () => void;
  onDeleted: () => void;
  onAskAI?: (text: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  // Project info
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [cwd, setCwd] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoToken, setRepoToken] = useState("");
  // deploy.md / test.md are edited via the FileEditor (linked from this
  // panel). We only track existence here so the link rows can show a hint.
  const [docsExist, setDocsExist] = useState<{ deploy: boolean; test: boolean }>({
    deploy: false,
    test: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);

  // Hosts
  const [hosts, setHosts] = useState<Host[]>([]);
  const emptyNewHost = {
    name: "", ssh_target: "", machine_id: "", path: "",
    deploy_type: "ssh", env: "production", description: "",
  };
  const [newHost, setNewHost] = useState(emptyNewHost);
  const [editingHostId, setEditingHostId] = useState<number | null>(null);
  const [hostDraft, setHostDraft] = useState<Host | null>(null);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostError, setHostError] = useState("");

  // Machine registry (Tailscale sites) for the host dropdowns
  const [machines, setMachines] = useState<MachineOpt[]>([]);

  // Chat sessions
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);

  // tmux session restart
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartMsg, setRestartMsg] = useState("");

  // Git status (cwd state, remote match)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState("");

  // Healthcheck — runs git/ssh/binary probes; null until first load.
  const [healthChecks, setHealthChecks] = useState<HealthCheck[] | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  // CLAUDE.md deploy-section scan (pointer status lives in agentPointers)
  const [claudeMd, setClaudeMd] = useState<{
    exists: boolean;
    hasDeploy: boolean;
    deploySections: { title: string; body: string }[];
    allSections: string[];
  } | null>(null);

  // Multi-agent pointer status (CLAUDE.md, AGENTS.md, …)
  const [agentPointers, setAgentPointers] = useState<{
    filename: string;
    agent: string;
    exists: boolean;
    hasPointer: boolean;
  }[]>([]);
  const [pointerBlock, setPointerBlock] = useState("");
  const [showPointerPreview, setShowPointerPreview] = useState(false);
  const [pointerBusyFor, setPointerBusyFor] = useState<string | null>(null);
  // Per-target error surfaced from the agent-pointers POST response when the
  // server couldn't write the file (EACCES, etc). Keyed by filename; cleared
  // before each attempt.
  const [pointerErrors, setPointerErrors] = useState<Record<string, string>>({});

  const loadProject = useCallback(async () => {
    try {
      const sessions = await api.get("/api/sessions");
      const p = sessions.find((s: { name: string }) => s.name === projectName);
      if (p) {
        setDisplayName(p.display_name);
        setColor(p.color);
        setCwd(p.cwd);
        setRepoUrl(p.repo_url || "");
        // Don't overwrite token placeholder — only set if empty
        if (!p.repo_token) setRepoToken("");
      }
    } catch { /* ignore */ }
  }, [projectName]);

  // Docs (deploy.md / test.md) live as files under {cwd}/.comux/. Read
  // existence so the link rows can flag missing files; the editor is
  // launched separately via onOpenFile.
  const loadDocs = useCallback(async () => {
    try {
      const data = await api.get(`/api/sessions/${projectName}/comux/docs`);
      setDocsExist({
        deploy: typeof data.deploy === "string" && data.deploy.length > 0,
        test: typeof data.test === "string" && data.test.length > 0,
      });
    } catch { setDocsExist({ deploy: false, test: false }); }
  }, [projectName]);

  const loadHosts = useCallback(async () => {
    try {
      setHosts(await api.get(`/api/sessions/${projectName}/hosts`));
    } catch { setHosts([]); }
  }, [projectName]);

  const loadMachines = useCallback(async () => {
    try {
      const data = await api.get("/api/machines");
      setMachines(data.machines.map((m: Record<string, unknown>) => ({
        id: m.id as number,
        hostname: m.hostname as string,
        ssh_user: (m.ssh_user || "") as string,
        online: !!m.online,
        is_self: !!m.is_self,
      })));
    } catch { setMachines([]); }
  }, []);

  const loadChatSessions = useCallback(async () => {
    try {
      setChatSessions(await api.get(`/api/sessions/${projectName}/chat-sessions`));
    } catch { setChatSessions([]); }
  }, [projectName]);

  const loadClaudeMd = useCallback(async () => {
    try {
      setClaudeMd(await api.get(`/api/sessions/${projectName}/claudemd`));
    } catch { setClaudeMd(null); }
  }, [projectName]);

  const loadGitStatus = useCallback(async () => {
    try {
      setGitStatus(await api.get(`/api/sessions/${projectName}/git/status`));
    } catch { setGitStatus(null); }
  }, [projectName]);

  const loadHealthChecks = useCallback(async () => {
    setHealthBusy(true);
    try {
      const data = await api.get(`/api/sessions/${projectName}/healthcheck`);
      setHealthChecks(data.checks || []);
    } catch { setHealthChecks([]); }
    setHealthBusy(false);
  }, [projectName]);

  const loadAgentPointers = useCallback(async () => {
    try {
      const data = await api.get(`/api/sessions/${projectName}/agent-pointers`);
      setAgentPointers(data.targets || []);
      if (typeof data.pointer_block === "string") setPointerBlock(data.pointer_block);
    } catch { setAgentPointers([]); }
  }, [projectName]);

  useEffect(() => {
    loadProject();
    loadDocs();
    loadHosts();
    loadMachines();
    loadChatSessions();
    loadClaudeMd();
    loadAgentPointers();
    loadGitStatus();
    loadHealthChecks();
  }, [loadProject, loadDocs, loadHosts, loadMachines, loadChatSessions, loadClaudeMd, loadAgentPointers, loadGitStatus, loadHealthChecks]);

  const saveProject = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await api.put(`/api/projects/${projectName}`, {
        display_name: displayName,
        color,
        cwd,
        repo_url: repoUrl,
        // Only send token if user typed a new one (not the masked "***")
        ...(repoToken && repoToken !== "***" && { repo_token: repoToken }),
      });
      await loadGitStatus();
      loadHealthChecks();
    } catch (e) {
      setSaveError(humanizeSaveError(e instanceof Error ? e.message : String(e)));
    }
    setSaving(false);
  };

  const cloneRepo = async () => {
    // If the cwd exists with only .comux (isEmpty per our check), warn the user
    if (gitStatus?.cwdExists && gitStatus?.isEmpty) {
      if (!confirm("現有 .comux 目錄會被清除並由 repo 內容取代，繼續嗎？")) return;
    }
    setCloneBusy(true);
    setCloneError("");
    try {
      await api.post(`/api/sessions/${projectName}/git/clone`, {});
      await loadGitStatus();
      loadHealthChecks();
    } catch (e) {
      setCloneError(e instanceof Error ? e.message : String(e));
    }
    setCloneBusy(false);
  };

  const syncComux = async () => {
    setSyncBusy(true);
    try {
      await api.post(`/api/sessions/${projectName}/comux/sync`, {});
      await loadProject();
      await loadDocs();
      await loadClaudeMd();
    } catch { /* ignore */ }
    setSyncBusy(false);
  };

  const addHost = async () => {
    const needsTarget = newHost.deploy_type === "ssh" && !newHost.machine_id && !newHost.ssh_target;
    if (!newHost.name || needsTarget) return;
    setHostError("");
    try {
      await api.post(`/api/sessions/${projectName}/hosts`, {
        ...newHost,
        machine_id: newHost.machine_id ? parseInt(newHost.machine_id) : null,
      });
      setNewHost(emptyNewHost);
      loadHosts();
    } catch (e) {
      setHostError(humanizeHostError(e instanceof Error ? e.message : String(e)));
    }
  };

  const fillLocalhost = () => {
    const self = machines.find((m) => m.is_self);
    setNewHost({
      name: "本機",
      ssh_target: self ? "" : "localhost",
      machine_id: self ? String(self.id) : "",
      path: cwd,
      deploy_type: "ssh",
      env: "production",
      description: "專案就跑在這台 comux 主機上，部署指令直接執行、不用 SSH",
    });
  };

  const deleteHost = async (id: number) => {
    if (!confirm("確定刪除這個主機設定嗎？")) return;
    await api.del(`/api/sessions/${projectName}/hosts/${id}`);
    loadHosts();
  };

  const startEditHost = (h: Host) => {
    setEditingHostId(h.id);
    setHostDraft({ ...h });
  };

  const cancelEditHost = () => {
    setEditingHostId(null);
    setHostDraft(null);
  };

  const saveHost = async () => {
    if (!hostDraft) return;
    setHostBusy(true);
    setHostError("");
    try {
      await api.put(`/api/sessions/${projectName}/hosts/${hostDraft.id}`, {
        name: hostDraft.name,
        ssh_target: hostDraft.ssh_target,
        machine_id: hostDraft.machine_id,
        path: hostDraft.path,
        deploy_type: hostDraft.deploy_type,
        env: hostDraft.env,
        description: hostDraft.description,
      });
      await loadHosts();
      cancelEditHost();
    } catch (e) {
      setHostError(humanizeHostError(e instanceof Error ? e.message : String(e)));
    }
    setHostBusy(false);
  };

  function humanizeHostError(raw: string): string {
    try { return JSON.parse(raw).error || raw; } catch { return raw; }
  }

  /** Human label for where a host points. */
  const hostTargetLabel = (h: Host): string => {
    if (h.deploy_type === "cloud-run") return "Cloud Run（gcloud，主開發機執行）";
    if (h.machine) {
      return h.machine.is_self
        ? `本機（${h.machine.hostname}）`
        : `ssh ${h.machine.ssh_user ? `${h.machine.ssh_user}@` : ""}${h.machine.hostname}`;
    }
    if (h.ssh_target === "localhost" || h.ssh_target === "127.0.0.1") return "本機";
    return h.ssh_target ? `ssh ${h.ssh_target}` : "（未設定）";
  };

  const restartSession = async () => {
    if (!confirm("重啟 tmux session？終端機裡執行中的程式（含 AI agent）會被結束，專案資料不受影響。")) return;
    setRestartBusy(true);
    setRestartMsg("");
    try {
      // keep=true: kill tmux only, keep the DB project row
      await api.del(`/api/sessions/${projectName}?keep=true`);
      await api.post("/api/sessions", {
        name: projectName,
        display_name: displayName || projectName,
        cwd: cwd || null,
        color,
      });
      setRestartMsg("已重啟 — 切回 Terminal 分頁即可使用（shell 已在最新的工作目錄）");
    } catch (e) {
      setRestartMsg("重啟失敗：" + humanizeHostError(e instanceof Error ? e.message : String(e)));
    }
    setRestartBusy(false);
  };

  const selectChatSession = async (sessionId: string) => {
    await api.put(`/api/sessions/${projectName}/chat-sessions`, { sessionId });
    loadChatSessions();
  };

  /** The API returns 200 with per-file `{ ok, error }` entries, so HTTP
   *  success doesn't mean all writes succeeded — walk the results array
   *  and stash any per-filename errors for the UI to display. */
  const applyPointerResults = (
    results: { filename: string; ok: boolean; error?: string }[]
  ) => {
    const errs: Record<string, string> = {};
    for (const r of results) {
      if (!r.ok) errs[r.filename] = humanizePointerError(r.error || "unknown error");
    }
    setPointerErrors(errs);
  };

  const addPointer = async (filename: string) => {
    setPointerBusyFor(filename);
    setPointerErrors((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    try {
      const res = await api.post(`/api/sessions/${projectName}/agent-pointers`, {
        targets: [filename],
      });
      if (Array.isArray(res?.results)) applyPointerResults(res.results);
      await loadAgentPointers();
      if (filename === "CLAUDE.md") await loadClaudeMd();
    } catch (e) {
      setPointerErrors((prev) => ({
        ...prev,
        [filename]: humanizePointerError(e instanceof Error ? e.message : String(e)),
      }));
    }
    setPointerBusyFor(null);
  };

  const addAllMissingPointers = async () => {
    const missing = agentPointers.filter((p) => !p.hasPointer).map((p) => p.filename);
    if (missing.length === 0) return;
    setPointerBusyFor("*");
    setPointerErrors({});
    try {
      const res = await api.post(`/api/sessions/${projectName}/agent-pointers`, {
        targets: missing,
      });
      if (Array.isArray(res?.results)) applyPointerResults(res.results);
      await loadAgentPointers();
      await loadClaudeMd();
    } catch (e) {
      const msg = humanizePointerError(e instanceof Error ? e.message : String(e));
      const errs: Record<string, string> = {};
      for (const f of missing) errs[f] = msg;
      setPointerErrors(errs);
    }
    setPointerBusyFor(null);
  };

  function humanizeSaveError(raw: string): string {
    if (/Working directory must be within PROJECTS_ROOT/i.test(raw)) {
      return "工作目錄必須位於 PROJECTS_ROOT 之下，或等於 comux 自己跑的目錄。請改路徑、調整 PROJECTS_ROOT，或讓 comux 從該目錄啟動。";
    }
    if (/Invalid command/i.test(raw)) {
      return "啟動指令包含不允許的字元（shell 元字元、管線、相對路徑等）。";
    }
    return raw;
  }

  function humanizePointerError(raw: string): string {
    // Node fs errors are verbose; tease out the common ones into something
    // a non-engineer user can act on.
    if (/EACCES/i.test(raw)) {
      const m = raw.match(/open\s+'([^']+)'/);
      return `權限被拒：comux 無法寫入 ${m ? m[1] : "此檔"}。請在主機上 ${
        m ? `\`chown devops ${m[1]}\`` : "修改檔案擁有者"
      } 後重試。`;
    }
    if (/ENOENT/i.test(raw)) return `找不到檔案或目錄：${raw}`;
    if (/EROFS/i.test(raw)) return "檔案系統唯讀，無法寫入。";
    return raw;
  }

  const deleteProject = async () => {
    if (!confirm(`確定刪除專案「${displayName || projectName}」？會移除 DB 紀錄並結束 tmux session。`)) return;
    await api.del(`/api/sessions/${projectName}`);
    onDeleted();
  };

  /** Build a structured analysis prompt for the Chat tab. Includes the
   *  current comux settings so the AI knows what's already in place and
   *  can point out conflicts vs. what's written in CLAUDE.md / docs. */
  const buildAnalysisPrompt = (deployDoc: string, testDoc: string): string => {
    const hostsList = hosts.length
      ? hosts
          .map(
            (h) =>
              `  - ${h.env}: ${h.name} → ${h.ssh_target}${h.description ? ` (${h.description})` : ""}`
          )
          .join("\n")
      : "  (無)";
    return [
      "請幫我盤點這個專案的既有文件，建議如何把內容整理到 comux 的專案設定。",
      "",
      "## 請讀取並分析",
      "- `CLAUDE.md`、`AGENTS.md`（若存在）",
      "- `docs/` 下與部署 / 測試 / 運維相關的 markdown",
      "- `README.md` 的部署段落",
      "- `scripts/` 下的部署腳本",
      "",
      "## comux 目前的設定",
      "",
      "### Deploy steps（會寫入 `.comux/deploy.md`）",
      deployDoc ? "```\n" + deployDoc + "\n```" : "(空)",
      "",
      "### Test checklist（會寫入 `.comux/test.md`）",
      testDoc ? "```\n" + testDoc + "\n```" : "(空)",
      "",
      "### Hosts（會寫入 `.comux/hosts.md`）",
      hostsList,
      "",
      "## 請以下列結構回覆",
      "",
      "### 建議的 Deploy steps",
      "若有更新，列出完整新內容；若現有已充分，寫「現有設定已充分」。",
      "",
      "### 建議的 Test checklist",
      "同上格式。",
      "",
      "### 建議的 Hosts 調整",
      "逐條列出新增 / 修改 / 刪除的 host，並引用來源檔的相關片段說明原因。",
      "",
      "### 衝突與需人工判斷的地方",
      "列出 CLAUDE.md / docs 與 comux 目前設定不一致、或需要人決定的項目。",
      "",
      "**請不要直接修改 `.comux/*` 檔或 CLAUDE.md**——我會看完回覆後到 comux 設定面板手動貼上調整。",
    ].join("\n");
  };

  /** Wrap the analysis in a Note first so the AI reply is captured as a
   *  NoteExchange. The note persists in the Notes panel for re-ask / audit
   *  even after the JSONL session gets /clear'd. */
  const askAIForSuggestions = async () => {
    if (!onAskAI) return;
    // Fetch the latest file content at click-time so the prompt reflects
    // what the user is about to ask the AI to compare against.
    let docs: { deploy?: string; test?: string } = {};
    try { docs = await api.get(`/api/sessions/${projectName}/comux/docs`); }
    catch { /* fine — fall through with empty */ }
    const prompt = buildAnalysisPrompt(docs.deploy || "", docs.test || "");
    try {
      const note = await api.post(`/api/sessions/${projectName}/notes`, {
        content: prompt,
      });
      // Tracking footer points at the freshly-created note so extraction
      // links the reply automatically.
      onAskAI(`${prompt}\n\n(tracking: note #${note.id})`);
    } catch {
      // Fallback: still send the prompt, just without note linkage.
      onAskAI(prompt);
    }
    onClose();
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>專案設定</h2>
        <button className="icon-btn" onClick={onClose}>&#x2715;</button>
      </div>

      <div className="settings-content">
        {/* General */}
        <section className="settings-section">
          <h3>基本</h3>
          <div className="form-row">
            <label>顯示名稱</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="form-row">
            <label>工作目錄</label>
            <input type="text" value={cwd} onChange={(e) => setCwd(e.target.value)} />
          </div>
          <p className="settings-hint" style={{ margin: "-0.25rem 0 0.5rem" }}>
            可隨時修改。需位於 PROJECTS_ROOT 之下，或等於 comux 自己跑的目錄（讓 comux
            專案能自我管理）。若 tmux session 在執行，新路徑要等 session 結束、下次啟動才生效。
          </p>
          <div className="form-row">
            <label>顏色</label>
            <div className="color-picker">
              {COLORS.map((c) => (
                <button key={c} type="button"
                  className={`color-dot${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Repository */}
        <section className="settings-section">
          <h3>版本庫</h3>
          <div className="form-row">
            <label>URL</label>
            <input type="url" placeholder="git@github.com:user/repo.git" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </div>
          <RepoUrlHint url={repoUrl} />
          <div className="form-row">
            <label>Token (PAT)</label>
            <input type="password" placeholder={repoToken ? "••••••••" : "個人存取權杖"}
              value={repoToken === "***" ? "" : repoToken}
              onChange={(e) => setRepoToken(e.target.value)} />
          </div>
          <GitStatusBlock
            status={gitStatus}
            cwd={cwd}
            repoUrl={repoUrl}
            cloneBusy={cloneBusy}
            cloneError={cloneError}
            onClone={cloneRepo}
          />
        </section>

        {/* Save */}
        <div style={{ padding: "0 0 0.5rem" }}>
          <button className="btn-primary" onClick={saveProject} disabled={saving}
            style={{ padding: "0.5rem 1.5rem" }}>
            {saving ? "儲存中..." : "儲存變更"}
          </button>
          <p className="settings-hint" style={{ marginTop: "0.35rem" }}>
            儲存會同步更新到 <code>.comux/project.md</code>，供 AI agent 讀取。
          </p>
          {saveError && <p className="pointer-error">{saveError}</p>}
        </div>

        <HealthCheckSection
          checks={healthChecks}
          busy={healthBusy}
          onRerun={loadHealthChecks}
          canClone={
            !!repoUrl &&
            !!gitStatus &&
            !gitStatus.isGitRepo &&
            (gitStatus.isEmpty || !gitStatus.cwdExists)
          }
          cloneBusy={cloneBusy}
          onClone={cloneRepo}
        />

        {/* Hosts */}
        <section className="settings-section">
          <h3>部署主機</h3>
          <p className="settings-hint">
            每個環境部署在哪個站點的哪個目錄。儲存後會自動寫入 <code>.comux/hosts.md</code>，
            AI agent 部署前會讀取判斷要 SSH 到哪、<code>cd</code> 到哪個路徑。
            站點清單來自 <a href="/machines">Machines</a> 頁（Tailscale 同步）。
          </p>
          {hosts.length === 0 ? (
            <p className="settings-hint">尚未設定任何主機</p>
          ) : (
            <div className="host-list">
              {hosts.map((h) => (
                editingHostId === h.id && hostDraft ? (
                  <div key={h.id} className="host-item-edit">
                    <div className="host-edit-row">
                      <input
                        type="text"
                        placeholder="名稱"
                        value={hostDraft.name}
                        onChange={(e) => setHostDraft({ ...hostDraft, name: e.target.value })}
                      />
                      <select
                        value={hostDraft.env}
                        onChange={(e) => setHostDraft({ ...hostDraft, env: e.target.value })}
                      >
                        <option value="production">production</option>
                        <option value="staging">staging</option>
                        <option value="development">development</option>
                      </select>
                    </div>
                    <div className="host-edit-row">
                      <select
                        value={hostDraft.deploy_type}
                        onChange={(e) => setHostDraft({ ...hostDraft, deploy_type: e.target.value })}
                      >
                        <option value="ssh">SSH 站點</option>
                        <option value="cloud-run">Cloud Run（gcloud）</option>
                      </select>
                      {hostDraft.deploy_type === "ssh" && (
                        <select
                          value={hostDraft.machine_id ?? ""}
                          onChange={(e) =>
                            setHostDraft({
                              ...hostDraft,
                              machine_id: e.target.value ? parseInt(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">（手動輸入 ssh target）</option>
                          {machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.hostname}{m.is_self ? "（主開發機）" : ""}{!m.online ? "（離線）" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    {hostDraft.deploy_type === "ssh" && !hostDraft.machine_id && (
                      <input
                        type="text"
                        placeholder="SSH 目標（localhost 代表本機）"
                        value={hostDraft.ssh_target}
                        onChange={(e) => setHostDraft({ ...hostDraft, ssh_target: e.target.value })}
                      />
                    )}
                    {hostDraft.deploy_type === "ssh" && (
                      <input
                        type="text"
                        placeholder="該站點上的專案路徑（例：/srv/my-app）"
                        value={hostDraft.path}
                        onChange={(e) => setHostDraft({ ...hostDraft, path: e.target.value })}
                      />
                    )}
                    <input
                      type="text"
                      placeholder="描述（選填，會寫入 .comux/hosts.md）"
                      value={hostDraft.description}
                      onChange={(e) => setHostDraft({ ...hostDraft, description: e.target.value })}
                    />
                    <div className="host-edit-actions">
                      <button
                        onClick={cancelEditHost}
                        disabled={hostBusy}
                        className="issue-picker-btn secondary"
                      >
                        取消
                      </button>
                      <button
                        onClick={saveHost}
                        disabled={hostBusy}
                        className="issue-picker-btn primary"
                      >
                        {hostBusy ? "儲存中..." : "儲存"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={h.id} className="host-item">
                    <span className={`host-env ${h.env}`}>{h.env}</span>
                    <span
                      className="host-name host-clickable"
                      onClick={() => startEditHost(h)}
                      title="點擊編輯"
                    >
                      {h.name}
                    </span>
                    <span
                      className="host-target host-clickable"
                      onClick={() => startEditHost(h)}
                    >
                      {hostTargetLabel(h)}
                    </span>
                    {h.path && <span className="host-path">{h.path}</span>}
                    <button
                      className="host-delete"
                      onClick={() => deleteHost(h.id)}
                      title="刪除主機"
                      aria-label="刪除主機"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              ))}
            </div>
          )}
          <div className="host-add-section">
            <div className="host-add">
              <input type="text" placeholder="名稱（例：GCP 正式機）"
                value={newHost.name} onChange={(e) => setNewHost({ ...newHost, name: e.target.value })} />
              <select value={newHost.env} onChange={(e) => setNewHost({ ...newHost, env: e.target.value })}>
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </select>
              <select value={newHost.deploy_type}
                onChange={(e) => setNewHost({ ...newHost, deploy_type: e.target.value })}>
                <option value="ssh">SSH 站點</option>
                <option value="cloud-run">Cloud Run</option>
              </select>
            </div>
            {newHost.deploy_type === "ssh" && (
              <div className="host-add">
                <select value={newHost.machine_id}
                  onChange={(e) => setNewHost({ ...newHost, machine_id: e.target.value })}>
                  <option value="">（手動輸入 ssh target）</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.hostname}{m.is_self ? "（主開發機）" : ""}{!m.online ? "（離線）" : ""}
                    </option>
                  ))}
                </select>
                {!newHost.machine_id && (
                  <input type="text" placeholder="SSH 目標（例：gcp-prod 或 localhost）"
                    value={newHost.ssh_target} onChange={(e) => setNewHost({ ...newHost, ssh_target: e.target.value })} />
                )}
                <input type="text" placeholder="路徑（例：/srv/my-app）"
                  value={newHost.path} onChange={(e) => setNewHost({ ...newHost, path: e.target.value })} />
              </div>
            )}
            <div className="host-add">
              <button className="btn-primary" onClick={addHost}
                style={{ flex: "none", padding: "0.4rem 0.8rem" }}>新增</button>
              <button
                onClick={fillLocalhost}
                className="host-quick-local"
                type="button"
                title="一鍵填入本機主機設定"
              >
                + 專案在這台 comux 主機
              </button>
            </div>
            {machines.length === 0 && (
              <p className="settings-hint">
                還沒有站點資料 — 到 <a href="/machines">Machines</a> 頁按「從 Tailscale 同步」，
                之後就能用下拉選單選站點。
              </p>
            )}
            {hostError && <p className="msg-err">{hostError}</p>}
          </div>
        </section>

        {/* .comux/ docs — DB-backed, regenerates the files on save */}
        <section className="settings-section">
          <h3>
            專案文件
            <button
              onClick={syncComux}
              disabled={syncBusy}
              style={{
                marginLeft: "0.75rem",
                fontSize: "0.8rem",
                padding: "0.15rem 0.5rem",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
              title="重新生成 README.md / project.md / hosts.md（auto 檔）。不會動 deploy.md / test.md，那兩個是你的檔。"
            >
              {syncBusy ? "重生中..." : "重生 .comux/"}
            </button>
          </h3>
          <p className="settings-hint">
            點檔名用內建 editor 開檔；存檔即寫進 <code>.comux/</code> 並可
            <code>git commit</code>。auto 檔（<code>README.md</code> /
            <code>project.md</code> / <code>hosts.md</code>）由設定 render 出來，
            按右上「重生 .comux/」可手動重生。
          </p>
          {[
            { file: "deploy.md", label: "部署步驟", exists: docsExist.deploy },
            { file: "test.md", label: "測試清單", exists: docsExist.test },
          ].map((row) => (
            <div key={row.file} className="claudemd-status" style={{ marginBottom: "0.4rem" }}>
              <span className="claudemd-icon">{row.exists ? "✅" : "○"}</span>
              <span style={{ flex: 1 }}>
                <strong>{row.label}</strong>
                {" · "}
                {onOpenFile ? (
                  <a
                    className="filename-link"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenFile(`.comux/${row.file}`);
                    }}
                    title={row.exists ? "在編輯器開啟" : "在編輯器建立並編輯"}
                  >
                    <code>.comux/{row.file}</code>
                  </a>
                ) : (
                  <code>.comux/{row.file}</code>
                )}
                <span className="settings-hint" style={{ marginLeft: "0.4rem" }}>
                  {row.exists ? "已建立" : "尚未建立 — 點檔名建立"}
                </span>
              </span>
            </div>
          ))}
          {onAskAI && (
            <div className="settings-analyze-box" style={{ marginTop: "0.5rem" }}>
              <button
                onClick={askAIForSuggestions}
                type="button"
                className="btn-secondary"
                style={{ padding: "0.4rem 0.9rem", fontSize: "0.85rem" }}
              >
                請 AI 分析既有文件並建議整合
              </button>
              <p className="settings-hint" style={{ margin: "0.3rem 0 0" }}>
                把目前的 deploy / test 檔內容 + Hosts 設定，連同 prompt 送到 Chat tab，請 AI
                讀 <code>CLAUDE.md</code>、<code>docs/</code>、<code>scripts/</code> 後給建議。
                <strong>AI 不會動任何設定</strong>，回覆是純文字 — 看完自己改檔。
              </p>
            </div>
          )}
        </section>

        {/* Agent Integration — pointers in CLAUDE.md, AGENTS.md, ... */}
        <section className="settings-section">
          <h3>
            AI agent 整合
            {agentPointers.some((p) => !p.hasPointer) && (
              <button
                onClick={addAllMissingPointers}
                disabled={pointerBusyFor !== null}
                style={{
                  marginLeft: "0.75rem",
                  fontSize: "0.8rem",
                  padding: "0.15rem 0.5rem",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 4,
                  background: "transparent",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
                title="對每個還沒有 pointer 的檔案一次加入"
              >
                {pointerBusyFor === "*" ? "加入中..." : "一次補齊所有缺少的"}
              </button>
            )}
          </h3>
          <p className="settings-hint">
            在各家 AI agent 的初始檔（<code>CLAUDE.md</code>、<code>AGENTS.md</code>）底部
            加一段指向 <code>.comux/</code> 的區塊，告訴 agent 部署 / 測試前要重讀那些檔。
            檔案不存在會幫你建立。
          </p>
          <div style={{ marginBottom: "0.5rem" }}>
            <button
              onClick={() => setShowPointerPreview((v) => !v)}
              className="settings-hint"
              style={{
                fontSize: "0.78rem",
                padding: "0.15rem 0",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#a5b4fc",
              }}
              type="button"
            >
              {showPointerPreview ? "▾" : "▸"} 預覽會附加的內容
            </button>
            {showPointerPreview && pointerBlock && (
              <pre className="pointer-preview">{pointerBlock.trim()}</pre>
            )}
          </div>
          <div className="agent-pointer-list">
            {agentPointers.map((p) => (
              <div key={p.filename} style={{ marginBottom: "0.4rem" }}>
                <div
                  className={`claudemd-status ${p.hasPointer ? "ok" : "warn"}`}
                >
                  <span className="claudemd-icon">{p.hasPointer ? "✅" : "⚠"}</span>
                  <span style={{ flex: 1 }}>
                    {p.exists && onOpenFile ? (
                      <a
                        className="filename-link"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onOpenFile(p.filename);
                        }}
                        title="在編輯器開啟"
                      >
                        <code>{p.filename}</code>
                      </a>
                    ) : (
                      <code>{p.filename}</code>
                    )}{" "}
                    <span className="settings-hint" style={{ marginLeft: "0.25rem" }}>
                      ({p.agent})
                      {!p.exists && " — 會新建此檔"}
                      {p.hasPointer && " — 已有指向"}
                    </span>
                  </span>
                  {!p.hasPointer && (
                    <button
                      className="btn-primary"
                      onClick={() => addPointer(p.filename)}
                      disabled={pointerBusyFor !== null}
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      {pointerBusyFor === p.filename ? "加入中..." : "加入指向"}
                    </button>
                  )}
                </div>
                {pointerErrors[p.filename] && (
                  <p className="pointer-error">{pointerErrors[p.filename]}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* CLAUDE.md deploy-section scan (informational only) */}
        {claudeMd?.exists && (
          <section className="settings-section">
            <h3>CLAUDE.md 內容掃描</h3>
            <p className="settings-hint">
              只掃描、不會修改 <code>CLAUDE.md</code>。看目前有沒有部署相關的章節（含
              「deploy / 部署 / docker compose / ssh」等關鍵字），方便你判斷要不要把
              內容整理到上面的「部署步驟」區。
            </p>
            <div className={`claudemd-status ${claudeMd.hasDeploy ? "ok" : "warn"}`}>
              <span className="claudemd-icon">{claudeMd.hasDeploy ? "✅" : "⚠"}</span>
              <span>
                {claudeMd.hasDeploy
                  ? "偵測到部署說明"
                  : "沒偵測到部署說明"}
              </span>
            </div>
            {claudeMd.allSections.length > 0 && (
              <p className="settings-hint">
                章節：{claudeMd.allSections.join("、")}
              </p>
            )}
            {claudeMd.hasDeploy && claudeMd.deploySections.map((s, i) => (
              <details key={i} className="claudemd-deploy-section">
                <summary>{s.title}</summary>
                <pre>{s.body}</pre>
              </details>
            ))}
          </section>
        )}

        {/* Chat Session */}
        {chatSessions.length > 1 && (
          <section className="settings-section">
            <h3>Chat session</h3>
            <p className="settings-hint">
              這個專案有多個 Claude Code session。選一個當預設顯示：
            </p>
            <div className="chat-session-list">
              {chatSessions.map((s) => (
                <button key={s.sessionId}
                  className={`chat-session-item${s.active ? " active" : ""}`}
                  onClick={() => selectChatSession(s.sessionId)}>
                  <span className="chat-session-id">{s.sessionId.slice(0, 8)}...</span>
                  <span className="chat-session-time">
                    {new Date(s.mtime).toLocaleString()}
                  </span>
                  {s.active && <span className="chat-session-badge">目前</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* tmux session lifecycle — restart picks up cwd changes */}
        <section className="settings-section">
          <h3>Terminal Session</h3>
          <p className="settings-hint">
            重啟會結束目前的 tmux session 再用最新設定開一個新的 —
            改過工作目錄後要重啟，shell 才會落在新目錄。
            專案資料（hosts、notes、chat 紀錄）完全不受影響。
          </p>
          <button
            className="btn-sm"
            onClick={restartSession}
            disabled={restartBusy}
          >
            {restartBusy ? "重啟中..." : "重啟 session"}
          </button>
          {restartMsg && (
            <p className={restartMsg.startsWith("重啟失敗") ? "msg-err" : "msg-ok"}>{restartMsg}</p>
          )}
        </section>

        {/* Danger Zone */}
        <section className="settings-section danger-zone">
          <h3>危險區</h3>
          <p className="settings-hint">
            刪除會移除 DB 中的專案紀錄（hosts、notes、exchanges、issues 全部連帶消失）
            並結束 tmux session。不會動專案目錄裡的檔案。無法還原。
          </p>
          <button className="btn-danger" onClick={deleteProject}>
            刪除專案
          </button>
        </section>
      </div>
    </div>
  );
}
