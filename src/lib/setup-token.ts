/**
 * 第一個管理員註冊用的一次性 setup token。
 *
 * 以前只要 DB 裡沒有使用者，任何連得到 comux 的人都能註冊成管理員（等於直接拿到
 * 主機 shell）。現在註冊必須帶這個 token，而 token 只印在伺服器 log（或由部署者
 * 用 COMUX_SETUP_TOKEN 環境變數指定），所以只有看得到 log／設得了 env 的人能註冊。
 *
 * 存放位置：globalThis（同一個 Node 進程內共用）。
 *   - instrumentation.ts 與 route handler 雖然是不同的 bundle，但都跑在 Next 的
 *     伺服器進程裡（prod-server.js 透過 getRequestHandlers 在同一進程載入 Next；
 *     next dev 則是 instrumentation 與 route 都在 dev server 子進程）→ globalThis 共用
 *   - 刻意不寫回 process.env，避免被 tmux / 子進程繼承而外洩
 */

import crypto from "crypto";

const KEY = Symbol.for("comux.setupToken");
const MIN_ENV_TOKEN_LENGTH = 16;

type Holder = { [KEY]?: string };

function holder(): Holder {
  return globalThis as unknown as Holder;
}

/** 取得目前的 setup token；還沒有就建立（優先用 COMUX_SETUP_TOKEN）並印到 log。 */
export function getOrCreateSetupToken(): string {
  const h = holder();
  if (h[KEY]) return h[KEY];

  const fromEnv = (process.env.COMUX_SETUP_TOKEN || "").trim();
  if (fromEnv && fromEnv.length >= MIN_ENV_TOKEN_LENGTH) {
    h[KEY] = fromEnv;
    console.log(
      "\n[comux] 尚未建立任何使用者。首次註冊請輸入 COMUX_SETUP_TOKEN 環境變數設定的 setup token。\n"
    );
    return fromEnv;
  }
  if (fromEnv) {
    console.warn(
      `[comux] COMUX_SETUP_TOKEN 短於 ${MIN_ENV_TOKEN_LENGTH} 字元，忽略並改用隨機產生的 token。`
    );
  }

  const token = crypto.randomBytes(24).toString("base64url");
  h[KEY] = token;
  console.log(
    [
      "",
      "================================================================",
      "[comux] 尚未建立任何使用者。建立第一個管理員帳號時請輸入 setup token：",
      "",
      `    ${token}`,
      "",
      "（只在本次啟動有效；重啟會換新的。也可用 COMUX_SETUP_TOKEN 環境變數自行指定）",
      "================================================================",
      "",
    ].join("\n")
  );
  return token;
}

/** 常數時間比對。先各自 sha256 讓長度一致，避免 timingSafeEqual 因長度不同直接丟錯而洩漏長度。 */
export function verifySetupToken(input: unknown): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  const expected = getOrCreateSetupToken();
  const a = crypto.createHash("sha256").update(input.trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 第一個管理員建立後作廢 token。 */
export function clearSetupToken(): void {
  delete holder()[KEY];
}
