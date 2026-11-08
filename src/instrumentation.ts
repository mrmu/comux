/**
 * Next.js 啟動時（next dev / next start / prod-server.js 的 getRequestHandlers）
 * 在伺服器進程內執行一次。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // COMUX_SECRET 不合格就讓 Next 進程直接結束 —— 不要等到第一個請求才發現
  const { assertComuxSecretOrExit } = await import("../server-shared/comux-secret");
  assertComuxSecretOrExit("comux-next");
}
