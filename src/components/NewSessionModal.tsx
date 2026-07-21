"use client";

import { useState, useEffect, FormEvent } from "react";
import { api } from "@/lib/api";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#3b82f6", "#ef4444", "#64748b",
];

interface MachineOpt {
  id: number;
  hostname: string;
  is_self: boolean;
  online: boolean;
}

export default function NewSessionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [projectsRoot, setProjectsRoot] = useState("");
  const [name, setName] = useState("");
  const [display, setDisplay] = useState("");
  const [cwd, setCwd] = useState("");
  const [cwdManual, setCwdManual] = useState(false);
  const [command, setCommand] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  // Optional: repo + deploy targets, all fillable later in settings
  const [repoUrl, setRepoUrl] = useState("");
  const [showDeploy, setShowDeploy] = useState(false);
  const [machines, setMachines] = useState<MachineOpt[]>([]);
  const [selfHostname, setSelfHostname] = useState("");
  const [prod, setProd] = useState({ machine_id: "", path: "" });
  const [stage, setStage] = useState({ machine_id: "", path: "" });

  useEffect(() => {
    (async () => {
      try {
        const config = await api.get("/api/config");
        setProjectsRoot(config.projectsRoot);
        setCwd(config.projectsRoot + "/");
      } catch { /* ignore */ }
      try {
        const data = await api.get("/api/machines");
        setSelfHostname(data.self?.hostname || "");
        setMachines(data.machines);
      } catch { /* machines page not synced yet — hide the dropdowns */ }
    })();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const projectName = name.trim();
    try {
      await api.post("/api/sessions", {
        name: projectName,
        display_name: display.trim() || projectName,
        cwd: cwd.trim() || null,
        command: command.trim() || null,
        color,
      });
    } catch (err) {
      alert("Failed to create session: " + (err as Error).message);
      setBusy(false);
      return;
    }

    // Best-effort extras — the project exists already; failures here are
    // reported but don't roll anything back (all fixable in settings).
    const warnings: string[] = [];
    if (repoUrl.trim()) {
      try {
        await api.put(`/api/projects/${projectName}`, { repo_url: repoUrl.trim() });
        try {
          await api.post(`/api/sessions/${projectName}/git/clone`, {});
        } catch (err) {
          warnings.push("git clone 失敗：" + parseErr(err) + "（可稍後在設定頁重試）");
        }
      } catch (err) {
        warnings.push("repo URL 儲存失敗：" + parseErr(err));
      }
    }
    for (const [env, target] of [["production", prod], ["staging", stage]] as const) {
      if (!target.machine_id) continue;
      const m = machines.find((x) => String(x.id) === target.machine_id);
      try {
        await api.post(`/api/sessions/${projectName}/hosts`, {
          name: env === "production" ? "正式機" : "Stage",
          machine_id: parseInt(target.machine_id),
          path: target.path.trim(),
          deploy_type: "ssh",
          env,
          description: "",
        });
      } catch (err) {
        warnings.push(`${env} 主機（${m?.hostname || "?"}）設定失敗：` + parseErr(err));
      }
    }

    setBusy(false);
    if (warnings.length > 0) alert("專案已建立，但有部分設定沒完成：\n\n" + warnings.join("\n"));
    onCreated();
  };

  const machineSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {machines.filter((m) => !m.is_self).map((m) => (
        <option key={m.id} value={m.id}>
          {m.hostname}{!m.online ? "（離線）" : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>New Project</h2>
        {selfHostname && (
          <p className="settings-hint" style={{ marginTop: "-0.5rem" }}>
            將建立於主開發機 <code>{selfHostname}</code>
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <label>
            Project Name
            <input
              type="text"
              placeholder="my-project"
              required
              pattern="[a-zA-Z0-9_\-]+"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!cwdManual) {
                  setCwd(v ? `${projectsRoot}/${v}` : `${projectsRoot}/`);
                }
              }}
            />
          </label>
          <label>
            Display Name
            <input
              type="text"
              placeholder="My Project"
              value={display}
              onChange={(e) => setDisplay(e.target.value)}
            />
          </label>
          <label>
            Working Directory{selfHostname ? `（在 ${selfHostname} 上）` : ""}
            <input
              type="text"
              placeholder={projectsRoot ? `${projectsRoot}/my-project` : "loading..."}
              value={cwd}
              onChange={(e) => {
                setCwd(e.target.value);
                setCwdManual(true);
              }}
            />
          </label>
          <label>
            Git Repo URL（選填）
            <input
              type="text"
              placeholder="git@github.com:user/repo.git — 填了就自動 clone；留空 = 空目錄新專案"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </label>

          <button
            type="button"
            onClick={() => setShowDeploy((v) => !v)}
            style={{
              border: "none", background: "transparent", color: "var(--text-muted)",
              fontSize: "0.78rem", padding: "0.25rem 0", cursor: "pointer", textAlign: "left",
            }}
          >
            {showDeploy ? "▾" : "▸"} 部署站點（選填，之後可在設定頁補）
          </button>
          {showDeploy && (
            machines.length === 0 ? (
              <p className="settings-hint">
                還沒有站點資料 — 先到 <a href="/machines">Machines</a> 頁「從 Tailscale 同步」。
              </p>
            ) : (
              <>
                <label>
                  正式機
                  <div className="modal-host-row">
                    {machineSelect(prod.machine_id, (v) => setProd({ ...prod, machine_id: v }), "（不設定）")}
                    <input
                      type="text"
                      placeholder="路徑（例：/srv/my-app）"
                      value={prod.path}
                      onChange={(e) => setProd({ ...prod, path: e.target.value })}
                      disabled={!prod.machine_id}
                    />
                  </div>
                </label>
                <label>
                  Stage 機
                  <div className="modal-host-row">
                    {machineSelect(stage.machine_id, (v) => setStage({ ...stage, machine_id: v }), "（不設定）")}
                    <input
                      type="text"
                      placeholder="路徑（例：/srv/my-app）"
                      value={stage.path}
                      onChange={(e) => setStage({ ...stage, path: e.target.value })}
                      disabled={!stage.machine_id}
                    />
                  </div>
                </label>
              </>
            )
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              border: "none", background: "transparent", color: "var(--text-muted)",
              fontSize: "0.78rem", padding: "0.25rem 0", cursor: "pointer", textAlign: "left",
            }}
          >
            {showAdvanced ? "▾" : "▸"} 進階設定
          </button>
          {showAdvanced && (
            <label>
              Start Command (optional)
              <input
                type="text"
                placeholder="一般情況留空 — 之後在 Terminal 用「啟用 AI agent」按鈕"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
          )}
          <label>
            Color
            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "建立中..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function parseErr(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  try { return JSON.parse(msg).error || msg; } catch { return msg; }
}
