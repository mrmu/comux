/**
 * 在自訂伺服器層（prod-server.js / server.ts）決定「可信的」連線來源位址，
 * 寫進內部 header 給 Next route handler（例如登入限流）使用。
 *
 * 為什麼不在 route handler 直接讀 X-Forwarded-For：那是客戶端可以任意偽造的標頭，
 * 拿來當限流 key 等於沒有限流。NextRequest 也拿不到 socket 位址，所以由持有
 * socket 的自訂伺服器來判斷：
 *   - 預設只採用 socket 的實際來源位址
 *   - 只有來源位址在 TRUSTED_PROXIES 裡（例如本機的 Tailscale Serve）時，才採用
 *     X-Forwarded-For —— 由右往左跳過可信 proxy，取第一個不可信的位址
 *   - 外部傳入的同名內部 header 一律先刪掉
 *
 * 另外在 globalThis 標記「自訂伺服器已設定此 header」：route handler 與自訂伺服器
 * 在同一個 Node 進程，看到標記才信任 header；沒有自訂伺服器（next dev）時不信任。
 */

const CLIENT_IP_HEADER = "x-comux-client-ip";
const MARK = Symbol.for("comux.clientIpHeaderTrusted");

/** @param {string | undefined} ip */
function normalizeIp(ip) {
  if (!ip) return "";
  let v = ip.trim();
  // [::1]:port 或 1.2.3.4:port 形式（XFF 一般不帶 port，保險起見處理）
  const bracket = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) v = bracket[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(v)) v = v.replace(/:\d+$/, "");
  if (v.toLowerCase().startsWith("::ffff:")) v = v.slice(7);
  return v.toLowerCase();
}

/** @returns {Set<string>} */
function trustedProxies() {
  return new Set(
    (process.env.TRUSTED_PROXIES || "")
      .split(",")
      .map((s) => normalizeIp(s))
      .filter(Boolean)
  );
}

/**
 * @param {import("http").IncomingMessage} req
 * @returns {string}
 */
function resolveClientIp(req) {
  const remote = normalizeIp(req.socket && req.socket.remoteAddress) || "unknown";
  const trusted = trustedProxies();
  if (!trusted.has(remote)) return remote;

  const raw = req.headers["x-forwarded-for"];
  const xff = (Array.isArray(raw) ? raw.join(",") : raw || "")
    .split(",")
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  for (let i = xff.length - 1; i >= 0; i--) {
    if (!trusted.has(xff[i])) return xff[i];
  }
  return remote;
}

/**
 * 每個 HTTP 請求進 Next 之前呼叫：刪掉外部傳入的內部 header，換成可信值。
 * @param {import("http").IncomingMessage} req
 */
function applyClientIpHeader(req) {
  delete req.headers[CLIENT_IP_HEADER];
  req.headers[CLIENT_IP_HEADER] = resolveClientIp(req);
}

/** 自訂伺服器啟動時呼叫，告訴同進程的 route handler 這個 header 可信。 */
function markClientIpHeaderTrusted() {
  /** @type {any} */ (globalThis)[MARK] = true;
}

/** route handler 用：自訂伺服器有設定才信任 header。 */
function isClientIpHeaderTrusted() {
  return /** @type {any} */ (globalThis)[MARK] === true;
}

module.exports = {
  CLIENT_IP_HEADER,
  normalizeIp,
  resolveClientIp,
  applyClientIpHeader,
  markClientIpHeaderTrusted,
  isClientIpHeaderTrusted,
};
