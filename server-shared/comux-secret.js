/**
 * COMUX_SECRET（JWT 簽章金鑰）的唯一取得入口。
 *
 * 刻意寫成 CommonJS：prod-server.js 是純 JS 直接用 node 跑（沒有編譯），
 * 而 Next.js 的 route handler / proxy 與 tsx 跑的 ws-server.ts 也都能 import
 * CJS 模組，所以全部共用這一份，不會再有哪一處偷偷退回預設值。
 *
 * comux 等於主機的網頁 shell，repo 又是公開的 —— 只要秘鑰是公開的預設值，
 * 任何人都能自己簽出合法 JWT 直接拿到 shell。所以：
 *   - 未設定、長度不足 32、或等於任何已知的公開預設值 → 直接丟錯，伺服器起不來
 *   - 不提供任何 fallback（開發環境也一樣）
 */

const MIN_LENGTH = 32;

// 曾經出現在 repo（程式碼、.env.example、文件）裡的預設值。公開過就等於外洩。
const KNOWN_PUBLIC_DEFAULTS = new Set([
  "dev-secret-change-in-production",
  "change-me-in-production",
  "change-me",
  "changeme",
  "secret",
]);

const HOW_TO_FIX =
  "請用 `openssl rand -hex 32` 產生一組隨機值，寫進 .env 的 COMUX_SECRET（本機開發也要設）。";

/**
 * 檢查秘鑰，回傳錯誤訊息；合格則回傳 null。
 * @param {string | undefined} value
 * @returns {string | null}
 */
function validateComuxSecret(value) {
  if (!value) return "COMUX_SECRET 未設定。" + HOW_TO_FIX;
  if (KNOWN_PUBLIC_DEFAULTS.has(value.trim().toLowerCase())) {
    return "COMUX_SECRET 是公開 repo 裡的預設值，等於沒有設。" + HOW_TO_FIX;
  }
  if (value.length < MIN_LENGTH) {
    return `COMUX_SECRET 長度不足 ${MIN_LENGTH} 字元（目前 ${value.length}）。` + HOW_TO_FIX;
  }
  return null;
}

/**
 * 取得 JWT 秘鑰；不合格就丟錯（呼叫端不要 catch 後改用別的值）。
 * 每次呼叫都重新讀 process.env，避免 build 階段（沒有 .env）就在模組載入時爆掉。
 * @returns {string}
 */
function getComuxSecret() {
  const value = process.env.COMUX_SECRET;
  const error = validateComuxSecret(value);
  if (error) throw new Error(error);
  return /** @type {string} */ (value);
}

/**
 * 伺服器啟動時呼叫：秘鑰不合格就印出原因與產生方式並結束程序。
 * @param {string} [who] log 前綴，標示是哪個進程
 */
function assertComuxSecretOrExit(who = "comux") {
  const error = validateComuxSecret(process.env.COMUX_SECRET);
  if (!error) return;
  console.error(`\n[${who}] 拒絕啟動：${error}\n`);
  process.exit(1);
}

module.exports = {
  getComuxSecret,
  validateComuxSecret,
  assertComuxSecretOrExit,
  KNOWN_PUBLIC_DEFAULTS,
  MIN_LENGTH,
};
