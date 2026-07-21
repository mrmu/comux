"use client";

import { useState, useEffect, useCallback, FormEvent } from "react";
import { api } from "@/lib/api";
import { TrashIcon } from "./icons";
import SectionSwitcher from "./SectionSwitcher";
import MachineBadge from "./MachineBadge";

interface User {
  id: number;
  email: string;
  name: string;
  createdAt: string;
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
            <input type="text" placeholder="e.g. devops@linode-audi-inv" value={localHost} onChange={(e) => setLocalHost(e.target.value)} />
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
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={6} />
                <button className="btn-sm" type="submit" disabled={pwSaving}>{pwSaving ? "..." : "Update"}</button>
              </div>
              {pwMsg && <p className={pwMsg.includes("updated") ? "msg-ok" : "msg-err"}>{pwMsg}</p>}
            </div>
          </form>
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
              <input type="password" placeholder="Password" value={newUserPw} onChange={(e) => setNewUserPw(e.target.value)} required minLength={6} />
              <button className="btn-sm" type="submit">Add</button>
            </div>
            {addMsg && <p className={addMsg.includes("created") ? "msg-ok" : "msg-err"}>{addMsg}</p>}
          </form>
        </section>
      </div>
    </div>
  );
}
