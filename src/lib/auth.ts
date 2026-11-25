import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import { getComuxSecret } from "../../server-shared/comux-secret";

const COOKIE_NAME = "comux_token";
/** 完整 session 的效期 */
export const SESSION_MAX_AGE_SEC = 7 * 86400;
/** 只過了密碼、還在第二道驗證（輸入碼或綁定）階段的暫時 session */
export const PARTIAL_MAX_AGE_SEC = 10 * 60;
// 只套用在新設定的密碼（註冊、新增使用者、改密碼）；既有密碼照常可登入
export const MIN_PASSWORD_LENGTH = 12;

export interface JwtPayload {
  userId: number;
  email: string;
  /** 對應 User.tokenVersion；不符（或沒有這個欄位的舊 token）一律視為失效 */
  tv: number;
  /**
   * 是否已通過第二道驗證。false = 只過了密碼，只能用來輸入驗證碼或綁定驗證器。
   * 沒有這個欄位的舊 token（第二道驗證上線前簽的）一律視為無效 → 部署後要重新登入一次。
   */
  mfa: boolean;
}

type TokenUser = { id: number; email: string; tokenVersion: number };

// ─── Token management ──────────────────────────────────────────────

function generateToken(user: TokenUser, mfa: boolean): string {
  return jwt.sign(
    { userId: user.id, email: user.email, tv: user.tokenVersion, mfa },
    getComuxSecret(),
    { algorithm: "HS256", expiresIn: mfa ? SESSION_MAX_AGE_SEC : PARTIAL_MAX_AGE_SEC }
  );
}

/** 只驗簽章與欄位形狀，不查 DB。 */
function verifyToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, getComuxSecret(), {
      algorithms: ["HS256"],
    }) as Partial<JwtPayload>;
    if (
      typeof payload.userId !== "number" ||
      typeof payload.tv !== "number" ||
      typeof payload.mfa !== "boolean"
    )
      return null;
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

function getTokenFromRequest(request: NextRequest): string | null {
  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie) return cookie.value;
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

/**
 * 驗簽章後再查 DB：使用者還在、且 tokenVersion 與 JWT 內的 tv 相同才算有效。
 * 預設只接受已通過第二道驗證的 session；allowPartial 只給第二道驗證流程本身用。
 * DB 錯誤一律視為無效（fail-closed）。
 */
async function verifySession(
  token: string,
  opts: { allowPartial?: boolean } = {}
): Promise<JwtPayload | null> {
  const payload = verifyToken(token);
  if (!payload) return null;
  if (!payload.mfa && !opts.allowPartial) return null;
  const user = await prisma.user
    .findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } })
    .catch(() => null);
  if (!user || user.tokenVersion !== payload.tv) return null;
  return payload;
}

// ─── Public API ────────────────────────────────────────────────────

export async function requireAuth(request: NextRequest): Promise<boolean> {
  return (await getAuthenticatedUser(request)) !== null;
}

/** 回傳已驗證（含 DB tokenVersion 比對、已過第二道驗證）的 JWT payload，失敗回 null。 */
export async function getAuthenticatedUser(
  request: NextRequest
): Promise<JwtPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifySession(token);
}

/**
 * 第二道驗證流程用：接受完整或只過密碼的 session。
 * 只能用在輸入驗證碼、綁定驗證器、登出這幾個 API。
 */
export async function getSessionAllowPartial(
  request: NextRequest
): Promise<JwtPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifySession(token, { allowPartial: true });
}

/** 只解出 email 當操作者記錄用；呼叫前必須已經通過 requireAuth。 */
export function getCurrentUserEmail(request: NextRequest): string {
  const token = getTokenFromRequest(request);
  if (!token) return "";
  return verifyToken(token)?.email || "";
}

/**
 * 遞增使用者的 tokenVersion，讓該使用者所有已簽發的 token 立即失效。
 * 回傳新的 user（用來替目前的連線重新簽 token），找不到回 null。
 */
export async function revokeUserSessions(userId: number) {
  return prisma.user
    .update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, email: true, tokenVersion: true },
    })
    .catch(() => null);
}

/** 簽一張已通過第二道驗證的完整 session token（改密碼後換發、驗證碼正確後）。 */
export function issueToken(user: TokenUser): string {
  return generateToken(user, true);
}

/** 簽一張只過了密碼的暫時 token（10 分鐘，只能用來輸入驗證碼或綁定）。 */
export function issuePartialToken(user: TokenUser): string {
  return generateToken(user, false);
}

/** 把 token 寫進 cookie（完整 session 7 天、暫時 session 10 分鐘）。 */
export function setSessionCookie(
  response: { cookies: { set: (name: string, value: string, opts: object) => void } },
  token: string,
  partial: boolean
) {
  response.cookies.set(COOKIE_NAME, token, {
    maxAge: partial ? PARTIAL_MAX_AGE_SEC : SESSION_MAX_AGE_SEC,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}

// 帳號不存在時也對一個假雜湊做一次 bcrypt 比對，回應時間不洩漏帳號是否存在
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (dummyHash ??= bcrypt.hash("comux-dummy-password", 12));
}

/**
 * 驗證帳號密碼（第一關）。成功回傳使用者與是否已綁定第二道驗證；失敗回 null。
 * 呼叫端依 mfaEnabled 決定下一步是「輸入驗證碼」還是「強制綁定」。
 */
export async function checkPassword(
  email: string,
  password: string
): Promise<{ user: TokenUser; mfaEnabled: boolean } | null> {
  const user = await prisma.user
    .findUnique({ where: { email: email.toLowerCase().trim() } })
    .catch(() => null);
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    return null;
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  return {
    user: { id: user.id, email: user.email, tokenVersion: user.tokenVersion },
    mfaEnabled: user.totpEnabledAt !== null,
  };
}

function validateNewAccount(email: string, password: string): string | null {
  if (!email || !email.includes("@")) return "Invalid email";
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  return null;
}

export async function register(
  email: string,
  password: string,
  name?: string
): Promise<{ ok: true } | { error: string }> {
  const normalized = email.toLowerCase().trim();
  const invalid = validateNewAccount(normalized, password);
  if (invalid) return { error: invalid };

  const existing = await prisma.user
    .findUnique({ where: { email: normalized } })
    .catch(() => null);
  if (existing) {
    return { error: "Email already registered" };
  }

  const hash = await bcrypt.hash(password, 12);
  // 新帳號還沒綁定第二道驗證：第一次登入時會被要求綁定
  await prisma.user.create({
    data: { email: normalized, password: hash, name: name || "" },
  });

  return { ok: true };
}

// pg_advisory_xact_lock 的鍵：任意固定值，只用來讓「建立第一個使用者」互斥
const FIRST_USER_LOCK_KEY = 72_635_001;

/**
 * 建立第一個管理員。在 transaction 內先拿 advisory lock 再數一次使用者，
 * 確保兩個請求同時進來時只有一個會成功（另一個會看到 count > 0 而被拒）。
 * 任何 DB 錯誤都往外丟，由呼叫端一律拒絕（fail-closed）。
 */
export async function registerFirstUser(
  email: string,
  password: string,
  name?: string
): Promise<{ token: string } | { error: string; status: number }> {
  const normalized = email.toLowerCase().trim();
  const invalid = validateNewAccount(normalized, password);
  if (invalid) return { error: invalid, status: 400 };

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FIRST_USER_LOCK_KEY})`;
    if ((await tx.user.count()) > 0) return null;
    return tx.user.create({
      data: { email: normalized, password: hash, name: name || "" },
    });
  });
  if (!user) return { error: "Registration disabled. Contact admin.", status: 403 };

  // 第一個管理員也一樣：先拿暫時 session，綁好第二道驗證才拿得到完整 session
  return { token: issuePartialToken(user) };
}

export async function checkAuth(): Promise<{
  authenticated: boolean;
  user: { email: string; name: string } | null;
  hasUsers: boolean;
  /** 只過了密碼時：下一步是 verify（輸入驗證碼）或 enroll（綁定驗證器） */
  mfaStep: "verify" | "enroll" | null;
}> {
  // DB 錯誤時當作「已有使用者」：前端只會顯示登入表單，不會引導去註冊
  const userCount = await prisma.user.count().catch(() => 1);
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    const payload = await verifySession(token, { allowPartial: true });
    if (payload) {
      const user = await prisma.user
        .findUnique({
          where: { id: payload.userId },
          select: { email: true, name: true, totpEnabledAt: true },
        })
        .catch(() => null);
      if (user) {
        const profile = { email: user.email, name: user.name };
        if (payload.mfa) return { authenticated: true, user: profile, hasUsers: true, mfaStep: null };
        return {
          authenticated: false,
          user: profile,
          hasUsers: true,
          mfaStep: user.totpEnabledAt ? "verify" : "enroll",
        };
      }
    }
  }

  return { authenticated: false, user: null, hasUsers: userCount > 0, mfaStep: null };
}

export { COOKIE_NAME };
