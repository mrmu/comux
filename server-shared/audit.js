/**
 * 稽核紀錄（audit_events 表）＋ 安全事件通知。Next 的 API route 與 prod-server.js /
 * ws-server.ts（終端機、SSH 監看）共用同一套，訊息格式一致。
 *
 * 寫入失敗只記 log，不讓登入或終端機因為稽核表出問題而壞掉；但會印出明顯的錯誤，
 * 方便從 journalctl 發現。
 */

const { getPool } = require("./db-pool");
const { notify } = require("./notify");

const TYPE_LABEL = {
  login_success: "登入成功",
  login_failed: "登入失敗（密碼錯誤）",
  mfa_failed: "登入失敗（第二道驗證碼錯誤）",
  mfa_enabled: "已綁定第二道驗證",
  backup_codes_regenerated: "已重新產生備用碼",
  backup_code_used: "用備用碼登入",
  mfa_reset: "第二道驗證已被重設",
  terminal: "開啟網頁終端機",
  ssh: "從終端機 SSH 連線",
};

// 失敗通知節流：同一個帳號＋來源 10 分鐘內只通知一次，後面附上這段時間累計的次數
const FAIL_NOTIFY_WINDOW_MS = 10 * 60_000;
/** @type {Map<string, { until: number, suppressed: number }>} */
const failThrottle = new Map();

/** @param {string} key @returns {number | null} 該通知時回傳被壓下的次數，不通知回 null */
function shouldNotifyFailure(key) {
  const now = Date.now();
  for (const [k, v] of failThrottle) if (v.until < now) failThrottle.delete(k);
  const entry = failThrottle.get(key);
  if (entry && entry.until > now) {
    entry.suppressed++;
    return null;
  }
  const suppressed = entry ? entry.suppressed : 0;
  failThrottle.set(key, { until: now + FAIL_NOTIFY_WINDOW_MS, suppressed: 0 });
  return suppressed;
}

/**
 * SSH 通知範圍：COMUX_NOTIFY_SSH=interactive（預設，只通知互動式登入）/ all / none。
 * agent 常常一次跑很多 `ssh host 'cmd'`，全部通知會洗版；那些照樣寫進稽核紀錄。
 * @param {any} detail
 */
function shouldNotifySsh(detail) {
  const mode = (process.env.COMUX_NOTIFY_SSH || "interactive").toLowerCase();
  if (mode === "none") return false;
  if (detail && detail.preexisting) return false;
  if (mode === "all") return true;
  return Boolean(detail && detail.interactive);
}

/**
 * @typedef {object} AuditInput
 * @property {string} type
 * @property {number | null} [userId]
 * @property {string} [email]
 * @property {string} [ip]
 * @property {string} [userAgent]
 * @property {string} [sessionName]
 * @property {string} [target]
 * @property {Record<string, unknown>} [detail]
 */

/** @param {AuditInput} e */
function formatMessage(e) {
  const parts = [TYPE_LABEL[e.type] || e.type];
  if (e.email) parts.push(e.email);
  if (e.type === "ssh") {
    parts.push(`→ ${e.target || "?"}`);
    if (e.sessionName) parts.push(`（session ${e.sessionName}）`);
    if (!e.email) parts.push("（沒有人開著這個終端機，可能是 agent 或背景程式）");
  }
  if (e.ip) parts.push(`來源 ${e.ip}`);
  const d = /** @type {any} */ (e.detail || {});
  if (d.method === "backup_code" && typeof d.remaining === "number")
    parts.push(`剩 ${d.remaining} 組備用碼`);
  if (d.suppressedFailures) parts.push(`（前 10 分鐘另有 ${d.suppressedFailures} 次失敗未通知）`);
  if (d.via) parts.push(`（${d.via}）`);
  return parts.join(" ");
}

/** @type {Set<Promise<void>>} 送出中的通知（CLI 結束前要等它們送完） */
const pending = new Set();
/** @param {string} message */
function send(message) {
  const p = notify(message).finally(() => pending.delete(p));
  pending.add(p);
}

/** 等所有送出中的通知完成（短命的 CLI 在結束前呼叫）。 */
async function flushNotifications() {
  await Promise.all([...pending]);
}

/** @param {AuditInput} e */
function notifyFor(e) {
  switch (e.type) {
    case "login_failed":
    case "mfa_failed": {
      const suppressed = shouldNotifyFailure(`${e.type}|${e.email || ""}|${e.ip || ""}`);
      if (suppressed === null) return;
      const detail = { ...(e.detail || {}), suppressedFailures: suppressed || undefined };
      send(formatMessage({ ...e, detail }));
      return;
    }
    case "terminal":
      return; // 每次開頁面、重連都會有，太多；只寫紀錄
    case "ssh":
      if (shouldNotifySsh(e.detail)) send(formatMessage(e));
      return;
    default:
      send(formatMessage(e));
  }
}

/**
 * 寫一筆稽核紀錄並視事件類型通知。回傳新紀錄的 id（失敗回 null）。
 * @param {AuditInput} e
 * @returns {Promise<number | null>}
 */
async function recordAudit(e) {
  notifyFor(e);
  try {
    const { rows } = await getPool().query(
      `INSERT INTO audit_events (type, user_id, email, ip, user_agent, session_name, target, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        e.type,
        e.userId ?? null,
        (e.email || "").slice(0, 320),
        (e.ip || "").slice(0, 100),
        (e.userAgent || "").slice(0, 500),
        (e.sessionName || "").slice(0, 100),
        (e.target || "").slice(0, 300),
        JSON.stringify(e.detail || {}),
      ]
    );
    return rows[0].id;
  } catch (err) {
    console.error("[comux] AUDIT WRITE FAILED:", e.type, /** @type {Error} */ (err).message);
    return null;
  }
}

/**
 * 結束一筆有持續時間的紀錄（terminal / ssh）。
 * @param {number | null} id
 * @param {Record<string, unknown>} [extraDetail]
 */
async function endAudit(id, extraDetail) {
  if (!id) return;
  try {
    await getPool().query(
      `UPDATE audit_events
          SET ended_at = now(),
              duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (now() - created_at))::int),
              detail = detail || $2::jsonb
        WHERE id = $1 AND ended_at IS NULL`,
      [id, JSON.stringify(extraDetail || {})]
    );
  } catch (err) {
    console.error("[comux] AUDIT END FAILED:", id, /** @type {Error} */ (err).message);
  }
}

/**
 * 啟動時把上次進程留下、沒結束的 terminal / ssh 紀錄收尾（進程重啟時連線都斷了）。
 * 時長算到現在，並標記 endedBy=restart，表示結束時間不精確。
 */
async function closeDanglingAudits() {
  try {
    const { rowCount } = await getPool().query(
      `UPDATE audit_events
          SET ended_at = now(),
              duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (now() - created_at))::int),
              detail = detail || '{"endedBy":"restart"}'::jsonb
        WHERE type IN ('terminal', 'ssh') AND ended_at IS NULL`
    );
    if (rowCount) console.log(`> audit: closed ${rowCount} dangling terminal/ssh records`);
  } catch (err) {
    console.error("[comux] audit cleanup failed:", /** @type {Error} */ (err).message);
  }
}

module.exports = {
  recordAudit,
  endAudit,
  closeDanglingAudits,
  flushNotifications,
  formatMessage,
  TYPE_LABEL,
};
