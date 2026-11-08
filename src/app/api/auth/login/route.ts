import { NextRequest, NextResponse } from "next/server";
import { login, COOKIE_NAME } from "@/lib/auth";
import { FixedWindowLimiter } from "@/lib/rate-limit";
import {
  CLIENT_IP_HEADER,
  isClientIpHeaderTrusted,
} from "../../../../../server-shared/client-ip";

// 來源位址：每分鐘 5 次（所有嘗試都算）
// 帳號：15 分鐘內失敗 10 次就暫停該帳號登入（成功登入會歸零）
// 放在 globalThis 上，dev 熱重載時不會每次都換一個新的（也不會累積計時器）
const g = globalThis as unknown as {
  __comuxLoginLimiters?: { ip: FixedWindowLimiter; account: FixedWindowLimiter };
};
const limiters = (g.__comuxLoginLimiters ??= {
  ip: new FixedWindowLimiter(5, 60_000),
  account: new FixedWindowLimiter(10, 15 * 60_000),
});

/**
 * 連線的實際來源位址。由自訂伺服器（prod-server.js / server.ts）依 socket 位址與
 * TRUSTED_PROXIES 決定後寫進內部 header；外部傳入的同名 header 已被刪掉。
 * 沒有自訂伺服器（next dev，只聽 127.0.0.1）時不信任任何標頭。
 */
function clientIp(request: NextRequest): string {
  if (!isClientIpHeaderTrusted()) return "local-dev";
  return request.headers.get(CLIENT_IP_HEADER) || "unknown";
}

export async function POST(request: NextRequest) {
  if (limiters.ip.hit(`ip:${clientIp(request)}`)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const accountKey = `acct:${email.toLowerCase().trim()}`;

  if (limiters.account.isLimited(accountKey)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const token = await login(email, password);

  if (!token) {
    limiters.account.hit(accountKey);
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }
  limiters.account.reset(accountKey);

  const isProduction = process.env.NODE_ENV === "production";
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    maxAge: 7 * 86400,
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
  });
  return response;
}
