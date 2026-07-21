import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as tmux from "@/lib/tmux";
import { isValidSessionName, isValidCwd, isValidCommand } from "@/lib/validate";
import { getAllowedCwdRoots } from "@/lib/settings";

/** Restore all DB-saved sessions that aren't currently running in tmux. */
export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const liveSessions = await tmux.listSessions();
  const liveNames = new Set(liveSessions.map((s) => s.name));

  const projects = await prisma.project.findMany();
  const restored: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const p of projects) {
    if (liveNames.has(p.name)) continue;
    if (!p.cwd) continue;

    // Validate before executing anything from DB
    const allowedRoots = await getAllowedCwdRoots();
    if (!isValidSessionName(p.name)) { skipped.push(p.name); continue; }
    if (p.cwd && !isValidCwd(p.cwd, ...allowedRoots)) { skipped.push(p.name); continue; }
    if (p.command && !isValidCommand(p.command)) { skipped.push(p.name); continue; }

    try {
      // Same as session create: a missing cwd would drop the shell in $HOME
      if (p.cwd) {
        try { await fs.mkdir(p.cwd, { recursive: true }); } catch { /* surfaced by healthcheck */ }
      }
      // Restore with cwd only — don't auto-execute commands
      await tmux.createSession(p.name, undefined, p.cwd || undefined);
      restored.push(p.name);
    } catch {
      failed.push(p.name);
    }
  }

  return NextResponse.json({ restored, skipped, failed });
}
