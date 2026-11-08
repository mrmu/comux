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

export async function register(
  email: string,
  password: string,
  name?: string
): Promise<{ token: string } | { error: string }> {
  const normalized = email.toLowerCase().trim();
  if (!normalized || !normalized.includes("@")) {
    return { error: "Invalid email" };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }

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

export async function checkAuth(): Promise<{
  authenticated: boolean;
  user: { email: string; name: string } | null;
  hasUsers: boolean;
}> {
  const userCount = await prisma.user.count().catch(() => 0);
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
