"use client";

import { useState, useEffect, FormEvent } from "react";
import { api } from "@/lib/api";

export default function LoginPage() {
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [projectsRoot, setProjectsRoot] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((auth) => {
        if (auth.authenticated) {
          window.location.href = "/projects";
          return;
        }
        setIsFirstUser(!auth.hasUsers);
        setLoading(false);
      })
      .catch(() => {
        setIsFirstUser(false);
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isFirstUser) {
        await api.post("/api/auth/register", { email, password, name, projectsRoot, setupToken });
      } else {
        await api.post("/api/auth/login", { email, password });
      }
      window.location.href = "/projects";
    } catch (err) {
      const msg = (err as Error).message;
      try { setError(JSON.parse(msg).error); } catch { setError(msg); }
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <div className="login-container">
          <div className="logo">
            <img src="/logo-robot.png" alt="" className="logo-icon" />
            <img src="/logo-text.png" alt="comux" className="logo-wordmark" />
          </div>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="login-container">
        <div className="logo">
            <img src="/logo-robot.png" alt="" className="logo-icon" />
            <img src="/logo-text.png" alt="comux" className="logo-wordmark" />
          </div>
        <p className="login-subtitle">
          {isFirstUser ? "Create admin account" : "Sign in to continue"}
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          {isFirstUser && (
            <>
              {/* 第一個管理員必須帶伺服器啟動時印在 log 的 setup token */}
              <input type="password" placeholder="Setup token (see server log)" required
                value={setupToken} onChange={(e) => setSetupToken(e.target.value)}
                autoComplete="one-time-code" />
              <p className="login-hint">
                Find it in the server log, e.g. <code>journalctl -u comux</code>
              </p>
            </>
          )}
          {isFirstUser && (
            <input type="text" placeholder="Name" value={name}
              onChange={(e) => setName(e.target.value)} autoComplete="name" />
          )}
          <input type="email" placeholder="Email" required value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input type="password" placeholder="Password" required
            minLength={isFirstUser ? 12 : undefined}
            value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={isFirstUser ? "new-password" : "current-password"} />
          {isFirstUser && (
            <input type="text" placeholder="Projects directory (e.g. /home/deploy/projects)"
              value={projectsRoot} onChange={(e) => setProjectsRoot(e.target.value)} required />
          )}
          <button type="submit" disabled={loading}>
            {isFirstUser ? "Create Account" : "Sign In"}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
