/**
 * 網頁終端機與 SSH 的稽核（跑在持有 WebSocket 的進程：prod-server.js / ws-dev-server.ts）。
 *
 * 1. 終端機：每條 WebSocket 連線（誰、哪個 session、從哪裡、多久）寫一筆 `terminal`。
 * 2. SSH：comux 沒有「SSH 按鈕」—— SSH 是在網頁終端機（tmux pane）裡由人或 agent 下指令。
 *    這裡定期掃 comux 這個 tmux server 底下每個 pane 的子行程，找出 `ssh` 行程，
 *    出現時寫一筆 `ssh`、消失時補上結束時間與時長。
 *    「誰」= 那一刻開著這個 session 終端機的使用者；沒有人開著時留空（多半是 agent 或背景程式）。
 *
 * 限制（寫在 PR 與文件）：
 *   - 輪詢間隔（預設 5 秒）內就結束的一次性指令（例如 `ssh host uptime`）可能掃不到。
 *   - 只看得到 comux 這個 tmux server 的 pane；主機上其他地方開的 ssh 不在範圍內。
 *   - 只記目的地與「有沒有帶遠端指令」，不記指令內容（可能含密碼等敏感資料）。
 */

const { execFile } = require("child_process");
const { recordAudit, endAudit, closeDanglingAudits } = require("./audit");

// ─── 誰開著哪個 session 的終端機 ───────────────────────────────────

/** @type {Map<string, Map<number, string>>} sessionName → (連線編號 → email) */
const attached = new Map();
let connSeq = 0;

/** @param {string} sessionName */
function attachedEmails(sessionName) {
  const m = attached.get(sessionName);
  return m ? [...new Set(m.values())].sort() : [];
}

/**
 * 終端機 WebSocket 建立時呼叫；回傳一個在連線關閉時呼叫的函式。
 * @param {{ userId: number, email: string }} user
 * @param {{ sessionName: string, windowIndex?: number, ip?: string, userAgent?: string }} info
 * @returns {() => void}
 */
function trackTerminal(user, info) {
  const id = ++connSeq;
  if (!attached.has(info.sessionName)) attached.set(info.sessionName, new Map());
  /** @type {Map<number, string>} */ (attached.get(info.sessionName)).set(id, user.email);

  const auditId = recordAudit({
    type: "terminal",
    userId: user.userId,
    email: user.email,
    ip: info.ip,
    userAgent: info.userAgent,
    sessionName: info.sessionName,
    detail: info.windowIndex !== undefined ? { window: info.windowIndex } : {},
  });

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    const m = attached.get(info.sessionName);
    if (m) {
      m.delete(id);
      if (m.size === 0) attached.delete(info.sessionName);
    }
    void auditId.then((aid) => endAudit(aid));
  };
}

// ─── ssh 指令列解析 ───────────────────────────────────────────────

// 會吃掉下一個參數的 ssh 選項（OpenSSH 9.x 的 man ssh）
const SSH_OPTS_WITH_ARG = new Set("BbcDEeFIiJLlmOoPpQRSWw".split(""));
const GIT_TRANSPORT_RE = /^(git-upload-pack|git-receive-pack|git-upload-archive|git-lfs-authenticate)\b/;

/**
 * 解析 ssh 的 argv（不含 argv[0]）。
 * 回傳 null 表示不是「連到主機」的 ssh（控制指令 -O、git 傳輸、查詢 -G/-Q 等）。
 * @param {string[]} args
 * @returns {{ target: string, interactive: boolean } | null}
 */
function parseSshArgs(args) {
  let user = "";
  let host = "";
  let port = "";
  let i = 0;
  let sawSubsystem = false;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      i++;
      break;
    }
    if (!a.startsWith("-") || a === "-") break;
    // 合併寫法：-p22、-luser、-vvv、-tt
    for (let j = 1; j < a.length; j++) {
      const opt = a[j];
      if (opt === "G" || opt === "Q" || opt === "V") return null; // 只查設定／版本，沒有連線
      if (opt === "s") sawSubsystem = true;
      if (SSH_OPTS_WITH_ARG.has(opt)) {
        const val = j + 1 < a.length ? a.slice(j + 1) : args[++i] || "";
        if (opt === "O") return null; // ControlMaster 控制指令
        if (opt === "l") user = val;
        if (opt === "p") port = val;
        break;
      }
    }
  }
  const dest = args[i];
  if (!dest) return null;
  const rest = args.slice(i + 1);
  if (rest.length && GIT_TRANSPORT_RE.test(rest.join(" "))) return null;

  // ssh://user@host:port 與 user@host 兩種寫法
  let d = dest;
  const url = d.match(/^ssh:\/\/(?:([^@/]+)@)?([^:/]+)(?::(\d+))?/);
  if (url) {
    user = url[1] || user;
    host = url[2];
    port = url[3] || port;
  } else {
    const at = d.lastIndexOf("@");
    if (at >= 0) {
      user = d.slice(0, at);
      d = d.slice(at + 1);
    }
    host = d;
  }
  if (!host) return null;
  const target = `${user ? `${user}@` : ""}${host}${port && port !== "22" ? `:${port}` : ""}`;
  return { target, interactive: rest.length === 0 && !sawSubsystem };
}

/**
 * 把 `ps -o args=` 的一行切成 argv。ps 不保留引號，帶空白的參數會被切開 ——
 * 只影響遠端指令那段（我們不記內容，只看有沒有），目的地前的選項不受影響。
 * @param {string} line
 */
function splitArgs(line) {
  return line.trim().split(/\s+/).filter(Boolean);
}

// ─── 行程掃描 ─────────────────────────────────────────────────────

/** @param {string} cmd @param {string[]} args @returns {Promise<string>} */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
  });
}

/**
 * 找出 comux tmux server 底下所有 pane 的 ssh 行程。
 * @returns {Promise<Map<string, { pid: number, sessionName: string, target: string, interactive: boolean }>>}
 *   key = `${pid}|${args}`（pid 可能被重複使用，連指令列一起當作身分）
 */
async function scanSsh() {
  const socketArgs = process.env.TMUX_SOCKET ? ["-S", process.env.TMUX_SOCKET] : [];
  /** @type {Map<number, string>} pane pid → session */
  const panes = new Map();
  try {
    const out = await run("tmux", [...socketArgs, "list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"]);
    for (const line of out.split("\n")) {
      const [name, pid] = line.split("\t");
      if (name && pid) panes.set(Number(pid), name);
    }
  } catch {
    return new Map(); // tmux server 沒在跑 = 沒有 pane
  }
  if (panes.size === 0) return new Map();

  const ps = await run("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "args="]);
  /** @type {Map<number, number>} */
  const parent = new Map();
  /** @type {{ pid: number, args: string }[]} */
  const sshProcs = [];
  for (const line of ps.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    parent.set(pid, Number(m[2]));
    const argv0 = m[3].split(/\s+/)[0] || "";
    if (argv0 === "ssh" || argv0.endsWith("/ssh")) sshProcs.push({ pid, args: m[3] });
  }

  const found = new Map();
  for (const p of sshProcs) {
    // 往上找到 pane 的 shell 為止（限制層數避免異常資料造成無窮迴圈）
    let cur = p.pid;
    let sessionName = null;
    for (let depth = 0; depth < 64 && cur > 1; depth++) {
      if (panes.has(cur)) {
        sessionName = panes.get(cur);
        break;
      }
      const next = parent.get(cur);
      if (next === undefined || next === cur) break;
      cur = next;
    }
    if (!sessionName) continue;
    const parsed = parseSshArgs(splitArgs(p.args).slice(1));
    if (!parsed) continue;
    found.set(`${p.pid}|${p.args}`, { pid: p.pid, sessionName, ...parsed });
  }
  return found;
}

/** @type {Map<string, Promise<number | null>>} 進行中的 ssh → 稽核紀錄 id */
const activeSsh = new Map();
let monitorStarted = false;

/**
 * 啟動 SSH 監看。COMUX_SSH_AUDIT=off 可關閉；COMUX_SSH_POLL_MS 調整間隔（最少 1 秒）。
 */
async function startSessionAudit() {
  if (monitorStarted) return;
  monitorStarted = true;
  await closeDanglingAudits();
  if ((process.env.COMUX_SSH_AUDIT || "").toLowerCase() === "off") {
    console.log("> audit: ssh monitor disabled (COMUX_SSH_AUDIT=off)");
    return;
  }
  const interval = Math.max(1000, parseInt(process.env.COMUX_SSH_POLL_MS || "5000", 10) || 5000);
  let first = true;
  let running = false;
  let lastError = "";

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = await scanSsh();
      for (const [key, s] of now) {
        if (activeSsh.has(key)) continue;
        const emails = attachedEmails(s.sessionName);
        activeSsh.set(
          key,
          recordAudit({
            type: "ssh",
            email: emails.join(", "),
            sessionName: s.sessionName,
            target: s.target,
            detail: {
              interactive: s.interactive,
              pid: s.pid,
              // comux 重啟前就在跑的連線：開始時間不精確，也不通知
              ...(first ? { preexisting: true } : {}),
            },
          })
        );
      }
      for (const [key, idPromise] of activeSsh) {
        if (now.has(key)) continue;
        activeSsh.delete(key);
        void idPromise.then((id) => endAudit(id));
      }
      first = false;
      lastError = "";
    } catch (err) {
      const msg = /** @type {Error} */ (err).message;
      if (msg !== lastError) console.error("[comux] ssh monitor scan failed:", msg);
      lastError = msg;
    } finally {
      running = false;
    }
  };

  await tick();
  const timer = setInterval(tick, interval);
  timer.unref?.();
  console.log(`> audit: ssh monitor every ${interval}ms`);
}

module.exports = { trackTerminal, startSessionAudit, parseSshArgs, attachedEmails };
