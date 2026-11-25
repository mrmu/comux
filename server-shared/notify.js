/**
 * 安全事件通知（登入、第二道驗證變更、SSH）。
 *
 * 管道（設了哪個就送哪個，可同時設）：
 *   - Telegram Bot API：COMUX_TELEGRAM_BOT_TOKEN + COMUX_TELEGRAM_CHAT_ID
 *   - 通用 webhook：COMUX_NOTIFY_WEBHOOK_URL —— POST JSON `{ text, content }`，
 *     Slack / Google Chat 讀 text、Discord 讀 content，自架的接收端也能直接用
 * 都沒設就只寫稽核紀錄、不通知。
 *
 * 通知失敗只記 log，絕不影響登入或終端機本身（fire-and-forget、5 秒逾時）。
 */

const os = require("os");

const TIMEOUT_MS = 5000;

function instanceLabel() {
  return process.env.COMUX_INSTANCE_NAME || os.hostname();
}

/** @param {string} url @param {object} body */
async function postJson(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

function isNotifyConfigured() {
  return Boolean(
    (process.env.COMUX_TELEGRAM_BOT_TOKEN && process.env.COMUX_TELEGRAM_CHAT_ID) ||
      process.env.COMUX_NOTIFY_WEBHOOK_URL
  );
}

/**
 * 送出一則通知。回傳的 promise 永遠 resolve（錯誤只記 log）。
 * @param {string} message
 */
async function notify(message) {
  const text = `[comux · ${instanceLabel()}] ${message}`;
  const jobs = [];

  const tgToken = process.env.COMUX_TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.COMUX_TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    jobs.push(
      postJson(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        chat_id: tgChat,
        text,
        disable_web_page_preview: true,
      }).catch((err) => console.error("[comux] telegram notify failed:", err.message))
    );
  }

  const webhook = process.env.COMUX_NOTIFY_WEBHOOK_URL;
  if (webhook) {
    jobs.push(
      postJson(webhook, { text, content: text }).catch((err) =>
        console.error("[comux] webhook notify failed:", err.message)
      )
    );
  }

  await Promise.all(jobs);
}

module.exports = { notify, isNotifyConfigured };
