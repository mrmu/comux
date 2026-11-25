"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { api } from "@/lib/api";

interface EnrollmentInfo {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
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
 * 綁定驗證器 App：顯示 QR code（桌機掃）、otpauth 連結（手機上直接點）、手動輸入用的秘鑰，
 * 再輸入一次 App 顯示的碼確認。成功時把一次性備用碼交給 onDone。
 * 換手機（已綁定）時要帶目前的驗證碼 currentCode，由呼叫端先問好。
 */
export default function MfaEnroll({
  currentCode,
  onDone,
  onCancel,
}: {
  currentCode?: string;
  onDone: (backupCodes: string[]) => void;
  onCancel?: () => void;
}) {
  const [info, setInfo] = useState<EnrollmentInfo | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // 只送一次：StrictMode 下 effect 會跑兩次，而換手機時帶的目前驗證碼第二次用會被防重放擋掉
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    api
      .post("/api/auth/mfa/setup", currentCode ? { currentCode } : {})
      .then((d) => setInfo(d))
      .catch((err) => setError(errorText(err)));
  }, [currentCode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.post("/api/auth/mfa/enable", { code });
      onDone(r.backupCodes);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <div className="mfa-box">
        {error ? <p className="error-text">{error}</p> : <div className="spinner" />}
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    );
  }

  // secret 每 4 個字一組，手動輸入比較不會看錯
  const grouped = info.secret.match(/.{1,4}/g)?.join(" ") ?? info.secret;

  return (
    <div className="mfa-box">
      <ol className="mfa-steps">
        <li>
          在手機裝一個驗證器 App（Google Authenticator、Microsoft Authenticator、1Password、
          iPhone 內建「密碼」App 都可以）。
        </li>
        <li>
          <span className="mfa-only-mobile">
            <a className="btn-sm mfa-open-app" href={info.otpauthUrl}>
              在這支手機加入驗證器
            </a>
            ，或
          </span>
          用 App 掃這個 QR code：
          <div
            className="mfa-qr"
            // SVG 由伺服器端的 qrcode 套件產生，內容只有 otpauth 連結
            dangerouslySetInnerHTML={{ __html: info.qrSvg }}
          />
          <button type="button" className="link-btn" onClick={() => setShowSecret((v) => !v)}>
            {showSecret ? "隱藏秘鑰" : "沒辦法掃？改用手動輸入秘鑰"}
          </button>
          {showSecret && <code className="mfa-secret">{grouped}</code>}
        </li>
        <li>輸入 App 顯示的 6 位數驗證碼：</li>
      </ol>
      <form className="login-form" onSubmit={submit}>
        <input
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
        <button type="submit" disabled={busy}>
          {busy ? "..." : "確認綁定"}
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {onCancel && (
        <button type="button" className="link-btn" onClick={onCancel}>
          取消
        </button>
      )}
    </div>
  );
}

/** 顯示一次性備用碼（只顯示這一次），要使用者確認已存好才能繼續。 */
export function BackupCodesView({
  codes,
  onContinue,
  continueLabel = "繼續",
}: {
  codes: string[];
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* 不支援剪貼簿時使用者可以手動選取 */
    }
  };

  const download = () => {
    const blob = new Blob([`comux backup codes\n\n${text}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "comux-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mfa-box">
      <p className="login-hint">
        這是你的一次性備用碼。手機遺失時，用其中一組代替驗證碼登入，每組只能用一次。
        <strong>它們只會顯示這一次</strong>，請存到密碼管理器或印出來，不要跟密碼放在一起。
      </p>
      <ul className="mfa-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="mfa-code-actions">
        <button type="button" className="btn-sm" onClick={copy}>
          {copied ? "已複製" : "複製"}
        </button>
        <button type="button" className="btn-sm" onClick={download}>
          下載 .txt
        </button>
      </div>
      <label className="mfa-saved">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        我已經把備用碼存好了
      </label>
      <button type="button" className="btn-primary-wide" disabled={!saved} onClick={onContinue}>
        {continueLabel}
      </button>
    </div>
  );
}
