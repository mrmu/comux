/**
 * Next.js 啟動時（next dev / next start / prod-server.js 的 getRequestHandlers）
 * 在伺服器進程內執行一次。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // COMUX_SECRET 不合格就讓 Next 進程直接結束 —— 不要等到第一個請求才發現
  const { assertComuxSecretOrExit } = await import("../server-shared/comux-secret");
  assertComuxSecretOrExit("comux-next");

  // 還沒有任何使用者 → 產生（或讀 COMUX_SETUP_TOKEN）第一個管理員的 setup token 並印到 log。
  // 查 DB 失敗就先跳過；第一次有人嘗試註冊時會再產生並印出。
  try {
    const { prisma } = await import("./lib/db");
    if ((await prisma.user.count()) === 0) {
      const { getOrCreateSetupToken } = await import("./lib/setup-token");
      getOrCreateSetupToken();
    }
  } catch (err) {
    console.warn("[comux] 啟動時無法檢查使用者數量（DB 未就緒？）：", (err as Error).message);
  }
}
