/**
 * Terminal WebSocket 的驗證（prod-server.js 與開發用 ws-server.ts 共用）。
 *
 * WebSocket 的 upgrade 不經過 Next 的 route handler，所以要在這裡自己做跟
 * requireAuth 一樣的檢查：驗 JWT 簽章 → 查 DB 確認使用者還在且 tokenVersion 相符。
 *
 * 用 pg 直接查（而不是 Prisma client）：Prisma 產生的 client 是 TS，prod-server.js
 * 是不經編譯的純 JS 跑不了；兩個查詢都很單純，直接寫 SQL 即可。
 * 任何 DB 錯誤一律視為驗證失敗（fail-closed）。
 */

const jwt = require("jsonwebtoken");
const { getComuxSecret } = require("./comux-secret");

/** @type {import("pg").Pool | null} */
let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");
  const { Pool } = require("pg");
  pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 30_000 });
  // 閒置連線斷掉時 pool 會 emit error，不處理會讓整個進程掛掉
  pool.on("error", (err) => console.error("[comux-ws] pg pool error:", err.message));
  return pool;
}

/**
 * 驗證 comux_token：簽章、欄位形狀、DB 的 tokenVersion。
 * @param {string | null | undefined} token
 * @returns {Promise<boolean>}
 */
async function verifySessionToken(token) {
  if (!token) return false;
  /** @type {any} */
  let payload;
  try {
    payload = jwt.verify(token, getComuxSecret(), { algorithms: ["HS256"] });
  } catch {
    return false;
  }
  if (!payload || typeof payload.userId !== "number" || typeof payload.tv !== "number") {
    return false;
  }
  try {
    const { rows } = await getPool().query(
      "SELECT token_version FROM users WHERE id = $1",
      [payload.userId]
    );
    return rows.length === 1 && rows[0].token_version === payload.tv;
  } catch (err) {
    console.error("[comux-ws] token check failed:", /** @type {Error} */ (err).message);
    return false;
  }
}

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

module.exports = { verifySessionToken, getCookieValue, getPool };
