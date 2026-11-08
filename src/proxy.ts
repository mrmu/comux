import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getComuxSecret } from "../server-shared/comux-secret";

// 秘鑰不合格時 getComuxSecret() 會丟錯 → 請求失敗，不會退回任何預設值
function jwtKey(): Uint8Array {
  return new TextEncoder().encode(getComuxSecret());
}

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/register", "/api/auth/check"];

/**
 * 這裡只驗簽章與欄位形狀（proxy 不查 DB）。tokenVersion 是否仍有效由 API 的
 * requireAuth 與 WebSocket 驗證查 DB 比對；沒有 tv 欄位的舊格式 token 直接擋掉。
 */
async function isValidToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, jwtKey(), { algorithms: ["HS256"] });
    return typeof payload.userId === "number" && typeof payload.tv === "number";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root → redirect based on auth
  if (pathname === "/") {
    const token = request.cookies.get("comux_token")?.value;
    if (token && (await isValidToken(token))) {
      return NextResponse.redirect(new URL("/projects", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Allow public paths and static assets. The extension check lets
  // everything under /public/ (logo, favicon, apple-touch-icon, plus any
  // future fonts/images) through without a cookie — they are served as-is
  // by Next.js static handling anyway and are not sensitive.
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/config") ||
    /\.(png|ico|svg|jpe?g|webp|gif|woff2?|ttf|avif)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("comux_token")?.value;
  if (!token || !(await isValidToken(token))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
