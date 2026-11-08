import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidCwd } from "@/lib/validate";
import { getAllowedCwdRoots } from "@/lib/settings";

/** Read / write the user-owned docs in `{cwd}/.comux/`. The files
 *  themselves are the source of truth — DB no longer mirrors them. */

interface DocsPayload {
  deploy: string;
  test: string;
}

const FILES = ["deploy.md", "test.md"] as const;
type DocFile = (typeof FILES)[number];
const FIELD_BY_FILE: Record<DocFile, "deploy" | "test"> = {
  "deploy.md": "deploy",
  "test.md": "test",
};

async function getProjectCwd(name: string): Promise<string | null> {
  const p = await prisma.project
    .findUnique({ where: { name }, select: { cwd: true } })
    .catch(() => null);
  return p?.cwd || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json({ error: "Project working directory not set" }, { status: 404 });
  }

  const allowedRoots = await getAllowedCwdRoots();
  if (!isValidCwd(cwd, ...allowedRoots)) {
    return NextResponse.json({ error: "Working directory outside allowed roots" }, { status: 400 });
  }

  const dir = path.join(cwd, ".comux");
  const out: DocsPayload = { deploy: "", test: "" };
  for (const f of FILES) {
    try { out[FIELD_BY_FILE[f]] = await fs.readFile(path.join(dir, f), "utf-8"); }
    catch { /* missing — return empty string */ }
  }
  return NextResponse.json(out);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) {
    return NextResponse.json({ error: "Project working directory not set" }, { status: 404 });
  }

  const allowedRoots = await getAllowedCwdRoots();
  if (!isValidCwd(cwd, ...allowedRoots)) {
    return NextResponse.json({ error: "Working directory outside allowed roots" }, { status: 400 });
  }

  const body = (await request.json()) as Partial<DocsPayload>;
  const dir = path.join(cwd, ".comux");
  try { await fs.mkdir(dir, { recursive: true }); }
  catch (e) {
    return NextResponse.json(
      { error: `Cannot create .comux/: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const written: string[] = [];
  for (const f of FILES) {
    const value = body[FIELD_BY_FILE[f]];
    if (typeof value !== "string") continue;
    try {
      await fs.writeFile(path.join(dir, f), value, "utf-8");
      written.push(f);
    } catch (e) {
      return NextResponse.json(
        { error: `Cannot write ${f}: ${(e as Error).message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, written });
}
