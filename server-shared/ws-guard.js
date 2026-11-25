/**
 * Terminal WebSocket 的驗證（prod-server.js 與開發用 ws-server.ts 共用）。
 *
 * WebSocket 的 upgrade 不經過 Next 的 route handler，所以要在這裡自己做跟
 * requireAuth 一樣的檢查：驗 JWT 簽章 → 查 DB 確認使用者還在且 tokenVersion 相符。
 *
 * 用 pg 直接查（見 db-pool.js）。任何 DB 錯誤一律視為驗證失敗（fail-closed）。
 * 只接受通過第二道驗證的 session（JWT 的 mfa === true）；只過了密碼那一關的
 * 暫時 token 不能開終端機。
 */

const jwt = require("jsonwebtoken");
const { getComuxSecret } = require("./comux-secret");
const { getPool } = require("./db-pool");

/**
 * 驗證 comux_token：簽章、欄位形狀、第二道驗證已完成、DB 的 tokenVersion。
 * 通過回傳 { userId, email }（給稽核紀錄用），否則回 null。
 * @param {string | null | undefined} token
 * @returns {Promise<{ userId: number, email: string } | null>}
 */
async function verifySessionToken(token) {
  if (!token) return null;
  /** @type {any} */
  let payload;
  try {
    payload = jwt.verify(token, getComuxSecret(), { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.userId !== "number" ||
    typeof payload.tv !== "number" ||
    payload.mfa !== true
  ) {
    return null;
  }
  try {
    const { rows } = await getPool().query(
      "SELECT token_version, email FROM users WHERE id = $1",
      [payload.userId]
    );
    if (rows.length !== 1 || rows[0].token_version !== payload.tv) return null;
    return { userId: payload.userId, email: rows[0].email };
  } catch (err) {
    console.error("[comux-ws] token check failed:", /** @type {Error} */ (err).message);
    return null;
  }
}

/**
 * 只允許 attach 到 comux 自己管理的 tmux session。
 * comux 的 session 名稱就是 projects.name（建立專案時以 validate.ts 驗證後
 * 拿來當 tmux session 名稱），所以以 DB 有沒有這個專案為準；
 * 主機上其他人／其他工具開的 tmux session 一律不給連。
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function isManagedSession(name) {
  try {
    const { rows } = await getPool().query("SELECT 1 FROM projects WHERE name = $1", [name]);
    return rows.length === 1;
  } catch (err) {
    console.error("[comux-ws] session check failed:", /** @type {Error} */ (err).message);
    return false;
  }
}

/** session 名稱規則（同 src/lib/validate.ts）。 */
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;
/** @param {string} name */
function isValidSessionName(name) {
  return name.length > 0 && name.length <= 100 && SAFE_NAME_RE.test(name);
}

/**
 * 解析 /ws/terminal/{session}/{window}。格式不對回 null。
 * @param {string} pathname
 * @returns {{ sessionName: string, windowIndex: number | undefined } | null}
 */
function parseTerminalPath(pathname) {
  const parts = pathname.slice("/ws/terminal/".length).split("/");
  if (parts.length > 2) return null;
  let sessionName;
  try {
    sessionName = decodeURIComponent(parts[0]);
  } catch {
    return null;
  }
  if (!isValidSessionName(sessionName)) return null;
  if (parts[1] === undefined || parts[1] === "") return { sessionName, windowIndex: undefined };
  if (!/^\d{1,4}$/.test(parts[1])) return null;
  return { sessionName, windowIndex: parseInt(parts[1], 10) };
}

/**
 * tmux 的 target：前綴 `=` 強制精確比對 session 名稱，避免 `foo` 被前綴比對到 `foo-bar`。
 * @param {string} sessionName
 * @param {number | undefined} windowIndex
 */
function tmuxTarget(sessionName, windowIndex) {
  return windowIndex !== undefined ? `=${sessionName}:${windowIndex}` : `=${sessionName}`;
}

/** 單一 WebSocket 訊息上限：鍵盤輸入／貼上／resize 都很小，1 MiB 綽綽有餘 */
const WS_MAX_PAYLOAD = 1024 * 1024;

/**
 * @param {string | undefined} header
 * @param {string} name
 * @returns {string | null}
 */
function getCookieValue(header, name) {
  if (!header) return null;
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}

module.exports = {
  verifySessionToken,
  isManagedSession,
  isValidSessionName,
  parseTerminalPath,
  tmuxTarget,
  getCookieValue,
  getPool,
  WS_MAX_PAYLOAD,
};
