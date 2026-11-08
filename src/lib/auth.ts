import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import { getComuxSecret } from "../../server-shared/comux-secret";

const COOKIE_NAME = "comux_token";
// 只套用在新設定的密碼（註冊、新增使用者、改密碼）；既有密碼照常可登入
export const MIN_PASSWORD_LENGTH = 12;

interface JwtPayload {
  userId: number;
  email: string;
  /** 對應 User.tokenVersion；不符（或沒有這個欄位的舊 token）一律視為失效 */
  tv: number;
}

// ─── Token management ──────────────────────────────────────────────

function generateToken(user: { id: number; email: string; tokenVersion: number }): string {
  return jwt.sign(
    { userId: user.id, email: user.email, tv: user.tokenVersion },
    getComuxSecret(),
    { algorithm: "HS256", expiresIn: "7d" }
  );
}

/** 只驗簽章與欄位形狀，不查 DB。 */
function verifyToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, getComuxSecret(), {
      algorithms: ["HS256"],
    }) as Partial<JwtPayload>;
    if (typeof payload.userId !== "number" || typeof payload.tv !== "number") return null;
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
 * DB 錯誤一律視為無效（fail-closed）。
 */
async function verifySession(token: string): Promise<JwtPayload | null> {
  const payload = verifyToken(token);
  if (!payload) return null;
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

/** 回傳已驗證（含 DB tokenVersion 比對）的 JWT payload，失敗回 null。 */
export async function getAuthenticatedUser(
  request: NextRequest
): Promise<JwtPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifySession(token);
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

/** 用新的 tokenVersion 重新簽一張 token（例如改密碼後讓目前裝置維持登入）。 */
export function issueToken(user: { id: number; email: string; tokenVersion: number }): string {
  return generateToken(user);
}

export async function login(
  email: string,
  password: string
): Promise<string | null> {
  const user = await prisma.user
    .findUnique({ where: { email: email.toLowerCase().trim() } })
    .catch(() => null);
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return null;
  return generateToken(user);
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
): Promise<{ token: string } | { error: string }> {
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
  const user = await prisma.user.create({
    data: { email: normalized, password: hash, name: name || "" },
  });

  return { token: generateToken(user) };
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

  return { token: generateToken(user) };
}

export async function checkAuth(): Promise<{
  authenticated: boolean;
  user: { email: string; name: string } | null;
  hasUsers: boolean;
}> {
  // DB 錯誤時當作「已有使用者」：前端只會顯示登入表單，不會引導去註冊
  const userCount = await prisma.user.count().catch(() => 1);
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    const payload = await verifySession(token);
    if (payload) {
      const user = await prisma.user
        .findUnique({ where: { id: payload.userId }, select: { email: true, name: true } })
        .catch(() => null);
      if (user) {
        return { authenticated: true, user, hasUsers: true };
      }
    }
  }

  return { authenticated: false, user: null, hasUsers: userCount > 0 };
}

export { COOKIE_NAME };
