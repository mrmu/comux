import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isValidCwd } from "@/lib/validate";
import { getAllowedCwdRoots } from "@/lib/settings";
import { gitClone, inspectCwd } from "@/lib/git";
import { syncComuxDir } from "@/lib/sync-comux-dir";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const project = await prisma.project.findUnique({
    where: { name },
    select: { cwd: true, repoUrl: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.repoUrl) {
    return NextResponse.json(
      { error: "Repo URL not set — fill it in 版本庫 first" },
      { status: 400 }
    );
  }
  if (!project.cwd) {
    return NextResponse.json(
      { error: "Working directory not set" },
      { status: 400 }
    );
  }

  const allowedRoots = await getAllowedCwdRoots();
  if (!isValidCwd(project.cwd, ...allowedRoots)) {
    return NextResponse.json(
      { error: "Working directory must be within PROJECTS_ROOT (or comux's own source dir for self-managed setup)" },
      { status: 400 }
    );
  }

  // Refuse to clone over an existing non-empty directory — the user might
  // already have work in there. They can resolve manually (rm or move) and
  // try again.
  try {
    const entries = await fs.readdir(project.cwd);
    // Ignore `.comux` — comux may have synced it before clone
    const meaningful = entries.filter((e) => e !== ".comux");
    if (meaningful.length > 0) {
      return NextResponse.json(
        { error: "Working directory exists and is not empty — refusing to clone over it" },
        { status: 409 }
      );
    }
    // Only `.comux` (or empty) — clean up so git clone can proceed
    const comuxPath = path.join(project.cwd, ".comux");
    try { await fs.rm(comuxPath, { recursive: true }); } catch { /* ignore */ }
    try { await fs.rmdir(project.cwd); } catch { /* ignore */ }
  } catch {
    // ENOENT — git clone will create it
  }

  const result = await gitClone(project.repoUrl, project.cwd);
  if (!result.ok) {
    return NextResponse.json(
      { error: humanizeCloneError(result.stderr) },
      { status: 500 }
    );
  }

  // The pre-clone cleanup removed any seeded `.comux/`; regenerate it so
  // the fresh checkout immediately carries hosts.md & friends.
  await syncComuxDir(name);

  // Re-inspect so the UI can refresh status without a second round-trip.
  const status = await inspectCwd(project.cwd, project.repoUrl);
  return NextResponse.json({ ok: true, status });
}

function humanizeCloneError(stderr: string): string {
  const msg = stderr.trim();
  if (/Permission denied \(publickey\)/i.test(msg)) {
    return "SSH 認證失敗：請把 comux 主機的 ssh 公鑰加到 GitHub Deploy Keys（或對應的 git host）後重試。";
  }
  if (/Host key verification failed/i.test(msg)) {
    return "SSH host key 尚未信任：請在主機上先 `ssh -T git@github.com` 接受一次。";
  }
  if (/Repository not found|not found|does not exist/i.test(msg)) {
    return "找不到 repo：URL 拼錯，或這個帳號 / key 沒有權限讀取。";
  }
  if (/EACCES|Permission denied/i.test(msg)) {
    return "權限被拒：comux 無法寫入工作目錄。請在主機上修正 owner / 權限後重試。";
  }
  if (/Could not resolve host/i.test(msg)) {
    return "DNS 解析失敗，主機沒有網路或 git host 拼錯。";
  }
  return msg || "git clone failed";
}
