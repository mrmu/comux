"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import SectionSwitcher from "@/components/SectionSwitcher";
import MachineBadge from "@/components/MachineBadge";

interface AuditEvent {
  id: number;
  type: string;
  userId: number | null;
  email: string;
  ip: string;
  userAgent: string;
  sessionName: string;
  target: string;
  detail: Record<string, unknown>;
  createdAt: string;
  endedAt: string | null;
  durationSec: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  login_success: "登入成功",
  login_failed: "密碼錯誤",
  mfa_failed: "驗證碼錯誤",
  mfa_enabled: "綁定第二道驗證",
  backup_codes_regenerated: "重新產生備用碼",
  backup_code_used: "使用備用碼",
  mfa_reset: "重設第二道驗證",
  terminal: "終端機",
  ssh: "SSH",
};

const BAD = new Set(["login_failed", "mfa_failed", "mfa_reset", "backup_code_used"]);

const TABS = [
  { key: "", label: "全部" },
  { key: "login", label: "登入" },
  { key: "ssh", label: "SSH" },
  { key: "terminal", label: "終端機" },
  { key: "security", label: "安全設定" },
];

function fmtDuration(sec: number | null, ended: string | null): string {
  if (!ended) return "進行中";
  if (sec === null) return "";
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  return `${Math.floor(sec / 3600)} 小時 ${Math.floor((sec % 3600) / 60)} 分`;
}

/** 從 user agent 抓個大概（裝置／瀏覽器），完整字串放在 title 裡 */
function shortUa(ua: string): string {
  if (!ua) return "";
  const device = /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(ua)?.[0] || "";
  const browser = /Edg|Firefox|Chrome|Safari/.exec(ua)?.[0] || "";
  return [device, browser === "Edg" ? "Edge" : browser].filter(Boolean).join(" · ");
}

function DetailChips({ e }: { e: AuditEvent }) {
  const d = e.detail || {};
  const chips: string[] = [];
  if (e.type === "ssh") chips.push(d.interactive ? "互動式" : "遠端指令");
  if (d.preexisting) chips.push("comux 重啟前已連線");
  if (d.endedBy === "restart") chips.push("結束時間不精確（comux 重啟）");
  if (d.method === "backup_code") chips.push(`備用碼，剩 ${String(d.remaining)} 組`);
  if (d.firstEnrollment) chips.push("首次綁定");
  if (d.rebind) chips.push("換手機");
  if (typeof d.via === "string") chips.push(d.via);
  if (typeof d.window === "number") chips.push(`window ${d.window}`);
  if (e.type === "ssh" && !e.email) chips.push("無人開著終端機（agent／背景）");
  return (
    <>
      {chips.map((c) => (
        <span key={c} className="machine-tag">{c}</span>
      ))}
    </>
  );
}

export default function AuditPage() {
  const router = useRouter();
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPage = useCallback(
    (before?: number) => {
      const params = new URLSearchParams();
      if (tab) params.set("group", tab);
      if (query) params.set("q", query);
      if (before) params.set("before", String(before));
      return api.get(`/api/audit?${params.toString()}`) as Promise<{
        events: AuditEvent[];
        nextBefore: number | null;
      }>;
    },
    [tab, query]
  );

  // 篩選條件改變時重新載入第一頁
  useEffect(() => {
    let alive = true;
    fetchPage()
      .then((r) => {
        if (!alive) return;
        setEvents(r.events);
        setNextBefore(r.nextBefore);
        setError("");
      })
      .catch((err) => alive && setError((err as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoading(true);
    try {
      const r = await fetchPage(nextBefore);
      setEvents((prev) => [...prev, ...r.events]);
      setNextBefore(r.nextBefore);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };

  const logout = async () => {
    await api.post("/api/auth/logout", {});
    router.replace("/login");
  };

  return (
    <div className="screen">
      <header className="top-bar">
        <img src="/logo-robot.png" alt="" className="top-logo" />
        <SectionSwitcher current="audit" />
        <MachineBadge />
        <button className="logout-btn" onClick={logout}>Logout</button>
      </header>

      <div className="account-content audit-content">
        <div className="audit-filters">
          <div className="audit-tabs">
            {TABS.map((t) => (
              <button
                key={t.key || "all"}
                className={`audit-tab${tab === t.key ? " active" : ""}`}
                onClick={() => {
                  setLoading(true);
                  setTab(t.key);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <form
            className="form-input-group"
            onSubmit={(e) => {
              e.preventDefault();
              setLoading(true);
              setQuery(q.trim());
            }}
          >
            <input
              type="search"
              placeholder="帳號、主機、session、IP"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn-sm" type="submit">搜尋</button>
          </form>
        </div>

        {error && <p className="msg-err">{error}</p>}

        <div className="audit-list">
          {events.map((e) => (
            <div key={e.id} className={`audit-item${BAD.has(e.type) ? " audit-bad" : ""}`}>
              <div className="audit-row">
                <span className="audit-type">{TYPE_LABEL[e.type] || e.type}</span>
                {e.type === "ssh" && <span className="machine-hostname">→ {e.target}</span>}
                <span className="audit-time" title={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="audit-row audit-meta">
                {e.email && <span>{e.email}</span>}
                {e.sessionName && <span>session {e.sessionName}</span>}
                {(e.type === "ssh" || e.type === "terminal") && (
                  <span>{fmtDuration(e.durationSec, e.endedAt)}</span>
                )}
                {e.ip && <span>{e.ip}</span>}
                {e.userAgent && <span title={e.userAgent}>{shortUa(e.userAgent)}</span>}
                <DetailChips e={e} />
              </div>
            </div>
          ))}
          {!loading && events.length === 0 && <p className="settings-hint">沒有紀錄</p>}
        </div>

        {loading ? (
          <div className="spinner" />
        ) : (
          nextBefore && (
            <button className="btn-sm audit-more" onClick={loadMore}>
              載入更早的紀錄
            </button>
          )
        )}
      </div>
    </div>
  );
}
