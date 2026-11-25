"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { api } from "@/lib/api";
import { TrashIcon } from "./icons";
import SectionSwitcher from "./SectionSwitcher";
import MachineBadge from "./MachineBadge";
import MfaEnroll, { BackupCodesView } from "./MfaEnroll";

interface User {
  id: number;
  email: string;
  name: string;
  createdAt: string;
  mfaEnabled: boolean;
}

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number;
}

function errorText(err: unknown): string {
  const msg = (err as Error).message;
  try {
    return JSON.parse(msg).error;
  } catch {
    return msg;
  }
}

/**
 * 第二道驗證：狀態、重新產生備用碼、換手機（重新綁定）。
 * 兩個動作都要先輸入一次目前的驗證碼，避免被偷走的 session 直接改設定。
 */
function MfaSection() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<"idle" | "regen" | "rebind">("idle");
  const [code, setCode] = useState("");
  const [rebindCode, setRebindCode] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);
  useEffect(() => {
    api.get("/api/auth/mfa/status").then(setStatus).catch(() => { /* ignore */ });
  }, [reloadKey]);

  const reset = () => { setMode("idle"); setCode(""); setRebindCode(null); setMsg(""); setBusy(false); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    if (mode === "rebind") { setRebindCode(code); return; }
    setBusy(true);
    try {
      const r = await api.post("/api/auth/mfa/backup-codes", { code });
      setCodes(r.backupCodes);
      reset();
    } catch (err) {
      setMsg(errorText(err));
      setBusy(false);
    }
  };

  if (codes) {
    return (
      <BackupCodesView
        codes={codes}
        continueLabel="完成"
        onContinue={() => { setCodes(null); load(); }}
      />
    );
  }

  if (mode === "rebind" && rebindCode) {
    return (
      <MfaEnroll
        currentCode={rebindCode}
        onDone={(c) => { reset(); setCodes(c); }}
        onCancel={reset}
      />
    );
  }

  return (
    <>
      {status && (
        <p className="settings-hint">
          {status.enabled
            ? <>已啟用（{status.enabledAt ? new Date(status.enabledAt).toLocaleDateString() : ""} 綁定）。
                備用碼剩 <strong>{status.backupCodesRemaining}</strong> 組。</>
            : "尚未啟用"}
        </p>
      )}
      {mode === "idle" ? (
        <div className="form-input-group">
          <button className="btn-sm" onClick={() => setMode("regen")}>重新產生備用碼</button>
          <button className="btn-sm" onClick={() => setMode("rebind")}>換一支手機</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="form-row">
            <label>
              {mode === "regen"
                ? "輸入目前驗證器上的碼（舊的備用碼會全部作廢）"
                : "輸入目前（舊手機）驗證器上的碼；手機已遺失請改用登入時的備用碼登入後再來這裡，或請管理員在主機上執行 npm run mfa:reset"}
            </label>
            <div className="form-input-group">
              <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
              <button className="btn-sm" type="submit" disabled={busy}>{busy ? "..." : "下一步"}</button>
              <button className="btn-sm" type="button" onClick={reset}>取消</button>
            </div>
            {msg && <p className="msg-err">{msg}</p>}
          </div>
        </form>
      )}
    </>
  );
}

export default function AccountPage({
  currentEmail,
  onLogout,
}: {
  currentEmail: string;
  onLogout: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newUserPw, setNewUserPw] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [projectsRoot, setProjectsRoot] = useState("");
  const [localHost, setLocalHost] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");

  const loadUsers = useCallback(async () => {
    try { setUsers(await api.get("/api/auth/users")); }
    catch { setUsers([]); }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get("/api/settings");
      setProjectsRoot(s.projectsRoot || "");
      setLocalHost(s.localHost || "");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadUsers(); loadSettings(); }, [loadUsers, loadSettings]);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(""); setPwSaving(true);
    try {
      await api.put("/api/auth/password", { currentPassword: currentPw, newPassword: newPw });
      setPwMsg("Password updated"); setCurrentPw(""); setNewPw("");
    } catch (err) {
      const msg = (err as Error).message;
      try { setPwMsg(JSON.parse(msg).error); } catch { setPwMsg(msg); }
    }
    setPwSaving(false);
  };

  const addUser = async (e: FormEvent) => {
    e.preventDefault(); setAddMsg("");
    try {
      await api.post("/api/auth/users", { email: newEmail, password: newUserPw, name: newName });
      setNewEmail(""); setNewName(""); setNewUserPw("");
      setAddMsg("User created"); loadUsers();
    } catch (err) {
      const msg = (err as Error).message;
      try { setAddMsg(JSON.parse(msg).error); } catch { setAddMsg(msg); }
    }
  };

  const deleteUser = async (id: number, email: string) => {
    if (!confirm(`Delete user ${email}?`)) return;
    try { await api.del(`/api/auth/users/${id}`); loadUsers(); }
    catch (err) { alert((err as Error).message); }
  };

  const saveSettings = async () => {
    setSettingsMsg("");
    try {
      await api.put("/api/settings", { projectsRoot, localHost });
      setSettingsMsg("Saved");
    } catch { setSettingsMsg("Failed"); }
  };

  const logout = async () => {
    await api.post("/api/auth/logout", {});
    onLogout();
  };

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="account" />
        <MachineBadge />
        <button className="logout-btn" onClick={logout}>Logout</button>
      </header>

      <div className="account-content">
        {/* System Settings */}
        <section className="account-section">
          <h3>System</h3>
          <div className="form-row">
            <label>Projects Root</label>
            <input type="text" value={projectsRoot} onChange={(e) => setProjectsRoot(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Local SSH Host</label>
            <input type="text" placeholder="e.g. deploy-user@your-host" value={localHost} onChange={(e) => setLocalHost(e.target.value)} />
            <p className="settings-hint">
              （舊機制）手動標記本機的 ssh 名稱。現在建議改用 Machines 頁「從 Tailscale 同步」，
              comux 會自動辨識主開發機；這欄僅供沒掛站點的舊 host 判斷本機用。
            </p>
          </div>
          <div className="form-row">
            <div className="form-input-group">
              <button className="btn-sm" onClick={saveSettings}>Save</button>
            </div>
            {settingsMsg && <p className={settingsMsg === "Saved" ? "msg-ok" : "msg-err"}>{settingsMsg}</p>}
          </div>
        </section>

        {/* Password */}
        <section className="account-section">
          <h3>Change Password</h3>
          <form onSubmit={changePassword}>
            <div className="form-row">
              <label>Current Password</label>
              <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>New Password</label>
              <div className="form-input-group">
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={12} />
                <button className="btn-sm" type="submit" disabled={pwSaving}>{pwSaving ? "..." : "Update"}</button>
              </div>
              {pwMsg && <p className={pwMsg.includes("updated") ? "msg-ok" : "msg-err"}>{pwMsg}</p>}
            </div>
          </form>
        </section>

        {/* Second factor */}
        <section className="account-section">
          <h3>Two-factor authentication</h3>
          <MfaSection />
        </section>

        {/* Users */}
        <section className="account-section">
          <h3>Users</h3>
          <div className="user-list">
            {users.map((u) => (
              <div key={u.id} className="user-item">
                <div className="user-info">
                  <span className="user-email">{u.email}</span>
                  {u.name && <span className="user-name">{u.name}</span>}
                  {!u.mfaEnabled && <span className="user-name msg-err">尚未綁定第二道驗證（下次登入會要求綁定）</span>}
                </div>
                {u.email === currentEmail
                  ? <span className="user-badge">you</span>
                  : <button className="user-del" onClick={() => deleteUser(u.id, u.email)} title="Delete user" aria-label="Delete user"><TrashIcon /></button>
                }
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: "1rem" }}>Add User</h3>
          <form onSubmit={addUser} className="add-user-form">
            <div className="form-row-inline">
              <input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
              <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input type="password" placeholder="Password" value={newUserPw} onChange={(e) => setNewUserPw(e.target.value)} required minLength={12} />
              <button className="btn-sm" type="submit">Add</button>
            </div>
            {addMsg && <p className={addMsg.includes("created") ? "msg-ok" : "msg-err"}>{addMsg}</p>}
          </form>
        </section>
      </div>
    </div>
  );
}
