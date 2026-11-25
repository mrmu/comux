import { FixedWindowLimiter } from "./rate-limit";

/**
 * 登入相關的限流（記憶體內、單一進程）。放在 globalThis 上，dev 熱重載時不會每次換新的。
 *   ip:      來源位址每分鐘 10 次（密碼與驗證碼的嘗試都算；正常登入一次就用掉 2 次）
 *   account: 帳號 15 分鐘內失敗 10 次就暫停登入（成功登入會歸零）
 *   mfa:     每個帳號 5 分鐘內最多 5 次驗證碼錯誤 —— 6 位數的碼不能讓人慢慢猜
 */
const g = globalThis as unknown as {
  __comuxAuthLimiters?: {
    ip: FixedWindowLimiter;
    account: FixedWindowLimiter;
    mfa: FixedWindowLimiter;
  };
};

export const authLimiters = (g.__comuxAuthLimiters ??= {
  ip: new FixedWindowLimiter(10, 60_000),
  account: new FixedWindowLimiter(10, 15 * 60_000),
  mfa: new FixedWindowLimiter(5, 5 * 60_000),
});
