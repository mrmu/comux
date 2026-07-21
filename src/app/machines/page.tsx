"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";
import { TrashIcon } from "@/components/icons";

interface Machine {
  id: number;
  hostname: string;
  display_name: string;
  dns_name: string;
  tailscale_ip: string;
  os: string;
  ssh_user: string;
  tags: string[];
  note: string;
  online: boolean;
  is_self: boolean;
  source: string;
  last_seen_at: string | null;
}

interface DiscoveredNode {
  hostname: string;
  os: string;
  online: boolean;
  tailscale_ip: string;
  tags: string[];
}

/** ACL tags as-is from the tailnet (whatever naming scheme the tailnet
 *  owner uses) — display only, comux attaches no meaning to them. */
function TagChips({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="machine-tag">{t.replace(/^tag:/, "")}</span>
      ))}
    </>
  );
}

export default function MachinesPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ ssh_user: string; note: string }>({ ssh_user: "", note: "" });
  const [pingResult, setPingResult] = useState<Record<number, { ok: boolean; detail: string; hint?: string }>>({});
  const [pingBusy, setPingBusy] = useState<number | null>(null);
  const [manual, setManual] = useState({ hostname: "", ssh_user: "" });
  const [manualMsg, setManualMsg] = useState("");
  // Live tailnet nodes not yet in the registry — opt-in import only, so a
  // shared tailnet doesn't leak unrelated machines into this instance's DB.
  const [discovered, setDiscovered] = useState<DiscoveredNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importBusy, setImportBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/machines");
      setMachines(data.machines);
    } catch { setMachines([]); }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncBusy(true);
    setSyncMsg("");
    try {
      const data = await api.post("/api/machines/sync", {});
      setMachines(data.machines);
      setDiscovered(data.discovered || []);
      setSelected(new Set());
      // Self may have changed — refresh the badge cache
      sessionStorage.removeItem("comux-self-machine");
      setSyncMsg(
        `已更新 ${data.machines.length} 台已納管站點` +
        (data.discovered?.length ? `，另發現 ${data.discovered.length} 台未納管（見下方清單）` : "")
      );
    } catch (err) {
      let msg = (err as Error).message;
      try { msg = JSON.parse(msg).error; } catch { /* raw */ }
      setSyncMsg(`同步失敗：${msg}`);
    }
    setSyncBusy(false);
  };

  const startEdit = (m: Machine) => {
    setEditingId(m.id);
    setDraft({ ssh_user: m.ssh_user, note: m.note });
  };

  const saveEdit = async (id: number) => {
    try {
      await api.put(`/api/machines/${id}`, draft);
      setEditingId(null);
      load();
    } catch (err) {
      let msg = (err as Error).message;
      try { msg = JSON.parse(msg).error; } catch { /* raw */ }
      alert(msg);
    }
  };

  const ping = async (id: number) => {
    setPingBusy(id);
    try {
      const res = await api.post(`/api/machines/${id}/ping`, {});
      setPingResult((prev) => ({ ...prev, [id]: res }));
    } catch {
      setPingResult((prev) => ({ ...prev, [id]: { ok: false, detail: "測試失敗" } }));
    }
    setPingBusy(null);
  };

  const remove = async (m: Machine) => {
    if (!confirm(`刪除站點 ${m.hostname}？（只移除 comux 紀錄，不影響 Tailscale）`)) return;
    try {
      await api.del(`/api/machines/${m.id}`);
      load();
    } catch (err) {
      let msg = (err as Error).message;
      try { msg = JSON.parse(msg).error; } catch { /* raw */ }
      alert(msg);
    }
  };

  const toggleSelect = (hostname: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hostname)) next.delete(hostname);
      else next.add(hostname);
      return next;
    });
  };

  const importSelected = async () => {
    if (selected.size === 0) return;
    setImportBusy(true);
    try {
      const data = await api.post("/api/machines/import", { hostnames: [...selected] });
      setMachines(data.machines);
      setDiscovered((prev) => prev.filter((d) => !selected.has(d.hostname)));
      setSelected(new Set());
    } catch (err) {
      let msg = (err as Error).message;
      try { msg = JSON.parse(msg).error; } catch { /* raw */ }
      alert(msg);
    }
    setImportBusy(false);
  };

  const addManual = async () => {
    if (!manual.hostname) return;
    setManualMsg("");
    try {
      await api.post("/api/machines", manual);
      setManual({ hostname: "", ssh_user: "" });
      load();
    } catch (err) {
      let msg = (err as Error).message;
      try { msg = JSON.parse(msg).error; } catch { /* raw */ }
      setManualMsg(msg);
    }
  };

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="machines" />
        <MachineBadge />
      </header>

      <div className="account-content">
        <section className="account-section">
          <h3>
            Tailscale 站點
            <button className="btn-sm" style={{ marginLeft: "0.75rem" }} onClick={sync} disabled={syncBusy}>
              {syncBusy ? "同步中..." : "從 Tailscale 同步"}
            </button>
          </h3>
          <p className="settings-hint">
            同步只會<strong>更新已納管站點</strong>的狀態；tailnet 上其他機器會列在下方
            「發現的站點」等你勾選加入，不會自動進資料庫 —
            共用 tailnet 時，這台 comux 只納管和它相關的機器即可（例如公司 comux 不必、也不該加入個人站點）。
            納管後就能在各專案的「部署主機」下拉選單指定站點＋路徑。
          </p>
          {syncMsg && (
            <p className={syncMsg.startsWith("同步失敗") ? "msg-err" : "msg-ok"}>{syncMsg}</p>
          )}

          {!loaded ? null : machines.length === 0 ? (
            <div className="empty-state">
              <p>尚無納管站點 — 按「從 Tailscale 同步」，再從發現清單勾選要納管的機器。</p>
            </div>
          ) : (
            <div className="machine-list">
              {machines.map((m) => (
                <div key={m.id} className={`machine-item${m.is_self ? " self" : ""}`}>
                  <div className="machine-row">
                    <span className={`machine-dot${m.online ? " online" : ""}`} title={m.online ? "online" : "offline"} />
                    <span className="machine-hostname">{m.hostname}</span>
                    {m.is_self && <span className="machine-self-badge">主開發機</span>}
                    {m.source === "manual" && <span className="machine-src-badge">手動</span>}
                    <TagChips tags={m.tags} />
                    <span className="machine-meta">
                      {m.os}{m.tailscale_ip ? ` · ${m.tailscale_ip}` : ""}
                    </span>
                    <span className="machine-actions">
                      {!m.is_self && (
                        <button className="btn-sm" onClick={() => ping(m.id)} disabled={pingBusy === m.id}>
                          {pingBusy === m.id ? "測試中..." : "測試連線"}
                        </button>
                      )}
                      <button className="btn-sm" onClick={() => (editingId === m.id ? setEditingId(null) : startEdit(m))}>
                        {editingId === m.id ? "取消" : "編輯"}
                      </button>
                      {!m.is_self && (
                        <button className="host-delete" onClick={() => remove(m)} title="刪除站點" aria-label="刪除站點">
                          <TrashIcon />
                        </button>
                      )}
                    </span>
                  </div>
                  {(m.ssh_user || m.note) && editingId !== m.id && (
                    <div className="machine-sub">
                      {m.ssh_user && <code>ssh {m.ssh_user}@{m.hostname}</code>}
                      {m.note && <span className="machine-note">{m.note}</span>}
                    </div>
                  )}
                  {editingId === m.id && (
                    <div className="machine-edit">
                      <input
                        type="text"
                        placeholder="SSH 使用者（例：devops，留空 = 目前使用者）"
                        value={draft.ssh_user}
                        onChange={(e) => setDraft({ ...draft, ssh_user: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="備註（例：個人正式機）"
                        value={draft.note}
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      />
                      <button className="btn-sm" onClick={() => saveEdit(m.id)}>儲存</button>
                    </div>
                  )}
                  {pingResult[m.id] && (
                    <div className={`machine-ping ${pingResult[m.id].ok ? "ok" : "err"}`}>
                      {pingResult[m.id].ok ? "✅" : "❌"} {pingResult[m.id].detail}
                      {pingResult[m.id].hint && <div className="settings-hint">{pingResult[m.id].hint}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {discovered.length > 0 && (
            <div className="machine-discovered">
              <h4>發現的站點（未納管）</h4>
              <p className="settings-hint">
                勾選這台 comux 需要管理的機器再按「納管選取站點」；其餘的不會被儲存。
              </p>
              <div className="machine-list">
                {discovered.map((d) => (
                  <label key={d.hostname} className="machine-item machine-discover-item">
                    <input
                      type="checkbox"
                      checked={selected.has(d.hostname)}
                      onChange={() => toggleSelect(d.hostname)}
                    />
                    <span className={`machine-dot${d.online ? " online" : ""}`} />
                    <span className="machine-hostname">{d.hostname}</span>
                    <TagChips tags={d.tags} />
                    <span className="machine-meta">
                      {d.os}{d.tailscale_ip ? ` · ${d.tailscale_ip}` : ""}
                    </span>
                  </label>
                ))}
              </div>
              <button
                className="btn-sm"
                style={{ marginTop: "0.5rem" }}
                onClick={importSelected}
                disabled={importBusy || selected.size === 0}
              >
                {importBusy ? "納管中..." : `納管選取站點（${selected.size}）`}
              </button>
            </div>
          )}
        </section>

        <section className="account-section">
          <h3>手動新增站點</h3>
          <p className="settings-hint">
            不在 tailnet 上、但可以直接 ssh 到的機器（例：傳統 VPS）。
          </p>
          <div className="form-row-inline">
            <input
              type="text"
              placeholder="hostname 或 IP"
              value={manual.hostname}
              onChange={(e) => setManual({ ...manual, hostname: e.target.value })}
            />
            <input
              type="text"
              placeholder="SSH 使用者（選填）"
              value={manual.ssh_user}
              onChange={(e) => setManual({ ...manual, ssh_user: e.target.value })}
            />
            <button className="btn-sm" onClick={addManual}>新增</button>
          </div>
          {manualMsg && <p className="msg-err">{manualMsg}</p>}
        </section>
      </div>
    </div>
  );
}
