import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import { getComuxSecret } from "../../server-shared/comux-secret";

const COOKIE_NAME = "comux_token";

interface JwtPayload {
  userId: number;
  email: string;
}

// ─── Token management ──────────────────────────────────────────────

function generateToken(user: { id: number; email: string }): string {
  return jwt.sign({ userId: user.id, email: user.email }, getComuxSecret(), {
    expiresIn: "7d",
  });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getComuxSecret()) as JwtPayload;
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

// ─── Public API ────────────────────────────────────────────────────

export function requireAuth(request: NextRequest): boolean {
  const token = getTokenFromRequest(request);
  if (!token) return false;
  return verifyToken(token) !== null;
}

export function getCurrentUserEmail(request: NextRequest): string {
  const token = getTokenFromRequest(request);
  if (!token) return "";
  return verifyToken(token)?.email || "";
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
  if (password.length < 6) return "Password must be at least 6 characters";
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
    const payload = verifyToken(token);
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
