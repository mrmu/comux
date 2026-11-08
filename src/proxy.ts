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

// ─── CSRF ──────────────────────────────────────────────────────────

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 需要非 JSON body 的 API（例如檔案上傳）在這裡個別列出。目前所有寫入都走
// src/lib/api.ts，一律送 application/json，所以清單是空的。
const NON_JSON_API_PATHS: string[] = [];

function allowedOriginHosts(): Set<string> {
  return new Set(
    (process.env.ALLOWED_ORIGINS || process.env.VIRTUAL_HOST || "localhost")
      .split(",")
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * 對 /api/* 的寫入請求做 CSRF 檢查，不通過回傳錯誤 response：
 *   1. Sec-Fetch-Site（現代瀏覽器都會送）必須是 same-origin
 *   2. 沒有 Sec-Fetch-Site 時看 Origin：host 要等於請求的 Host，或在 ALLOWED_ORIGINS 內
 *      （兩者都沒有 = 非瀏覽器的 client，不是 CSRF 的情境，交給後面的認證處理）
 *   3. Content-Type 必須是 application/json —— 跨站的 <form> / 簡單請求送不出這個類型
 */
function checkCsrf(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || SAFE_METHODS.has(request.method)) return null;

  const site = request.headers.get("sec-fetch-site");
  if (site) {
    if (site !== "same-origin") {
      return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
    }
  } else {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* 格式錯誤 → 視為不同源 */
      }
      const host = (request.headers.get("host") || "").toLowerCase();
      const originHostname = originHost.replace(/:\d+$/, "");
      if (!originHost || (originHost !== host && !allowedOriginHosts().has(originHostname))) {
        return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
      }
    }
  }

  if (!NON_JSON_API_PATHS.some((p) => pathname.startsWith(p))) {
    const type = (request.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 }
      );
    }
  }
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF：連公開的 /api/auth/login、register 也要擋（避免 login CSRF）
  const csrf = checkCsrf(request);
  if (csrf) return csrf;

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
