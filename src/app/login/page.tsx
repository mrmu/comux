"use client";

import { useState, useEffect, FormEvent } from "react";
import { api } from "@/lib/api";
import MfaEnroll, { BackupCodesView } from "@/components/MfaEnroll";

/**
 * 登入流程：
 *   credentials（帳密）→ verify（輸入驗證碼或備用碼）→ /projects
 *                      → enroll（還沒綁定：強制綁定）→ backup（顯示備用碼）→ /projects
 * 只過了密碼時拿到的是 10 分鐘的暫時 session；重新整理頁面會依 /api/auth/check 回到對應步驟。
 */
type Step = "loading" | "credentials" | "verify" | "enroll" | "backup";

function errorText(err: unknown): string {
  const msg = (err as Error).message;
  try {
    return JSON.parse(msg).error;
  } catch {
    return msg;
  }
}

function Logo() {
  return (
    <div className="logo">
      <img src="/logo-robot.png" alt="" className="logo-icon" />
      <img src="/logo-text.png" alt="comux" className="logo-wordmark" />
    </div>
  );
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("loading");
  const [isFirstUser, setIsFirstUser] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [projectsRoot, setProjectsRoot] = useState("");
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [lowBackupWarning, setLowBackupWarning] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/check")
      .then((r) => r.json())
      .then((auth) => {
        if (auth.authenticated) {
          window.location.href = "/projects";
          return;
        }
        if (auth.mfaStep === "verify" || auth.mfaStep === "enroll") {
          setEmail(auth.user?.email || "");
          setStep(auth.mfaStep);
          return;
        }
        setIsFirstUser(!auth.hasUsers);
        setStep("credentials");
      })
      .catch(() => setStep("credentials"));
  }, []);

  const goHome = () => {
    window.location.href = "/projects";
  };

  const signOut = async () => {
    await api.post("/api/auth/logout", {}).catch(() => {});
    setCode("");
    setPassword("");
    setError("");
    setStep("credentials");
  };

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = isFirstUser
        ? await api.post("/api/auth/register", { email, password, name, projectsRoot, setupToken })
        : await api.post("/api/auth/login", { email, password });
      setPassword("");
      setStep(r.next === "verify" ? "verify" : "enroll");
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.post("/api/auth/mfa/verify", { code });
      if (typeof r.backupCodesRemaining === "number" && r.backupCodesRemaining <= 3) {
        // 備用碼快用完：先提醒，再進首頁
        setLowBackupWarning(r.backupCodesRemaining);
        setBusy(false);
        return;
      }
      goHome();
    } catch (err) {
      setError(errorText(err));
      setCode("");
      setBusy(false);
    }
  };

  if (step === "loading") {
    return (
      <div className="screen">
        <div className="login-container">
          <Logo />
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (step === "enroll") {
    return (
      <div className="screen">
        <div className="login-container login-container-wide">
          <Logo />
          <p className="login-subtitle">設定第二道驗證</p>
          <p className="login-hint">
            comux 等於主機的網頁 shell，登入除了密碼還需要手機上的驗證碼。{email && <>帳號：{email}</>}
          </p>
          <MfaEnroll
            onDone={(codes) => {
              setBackupCodes(codes);
              setStep("backup");
            }}
            onCancel={signOut}
          />
        </div>
      </div>
    );
  }

  if (step === "backup") {
    return (
      <div className="screen">
        <div className="login-container login-container-wide">
          <Logo />
          <p className="login-subtitle">第二道驗證已啟用</p>
          <BackupCodesView codes={backupCodes} onContinue={goHome} continueLabel="進入 comux" />
        </div>
      </div>
    );
  }

  if (step === "verify") {
    if (lowBackupWarning !== null) {
      return (
        <div className="screen">
          <div className="login-container">
            <Logo />
            <p className="login-subtitle">備用碼只剩 {lowBackupWarning} 組</p>
            <p className="login-hint">
              登入後到 Account 頁重新產生一組備用碼；如果手機遺失了，也在那裡換綁新手機。
            </p>
            <button type="button" className="btn-primary-wide" onClick={goHome}>
              知道了，進入 comux
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="screen">
        <div className="login-container">
          <Logo />
          <p className="login-subtitle">{useBackup ? "輸入一組備用碼" : "輸入驗證器 App 上的 6 位數碼"}</p>
          <form className="login-form" onSubmit={submitCode}>
            {useBackup ? (
              <input
                key="backup"
                type="text"
                placeholder="xxxx-xxxx"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            ) : (
              <input
                key="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                autoComplete="one-time-code"
                placeholder="123456"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
            <button type="submit" disabled={busy}>
              {busy ? "..." : "驗證"}
            </button>
          </form>
          {error && <p className="error-text">{error}</p>}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setUseBackup((v) => !v);
              setCode("");
              setError("");
            }}
          >
            {useBackup ? "改用驗證器 App 的碼" : "手機不在身邊？改用備用碼"}
          </button>
          <button type="button" className="link-btn" onClick={signOut}>
            換一個帳號登入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="login-container">
        <Logo />
        <p className="login-subtitle">
          {isFirstUser ? "Create admin account" : "Sign in to continue"}
        </p>
        <form className="login-form" onSubmit={submitCredentials}>
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
          <button type="submit" disabled={busy}>
            {isFirstUser ? "Create Account" : "Sign In"}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
