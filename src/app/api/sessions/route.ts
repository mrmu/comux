import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as tmux from "@/lib/tmux";
import { isValidSessionName, isValidCwd, isValidCommand } from "@/lib/validate";
import { getProjectsRoot, getAllowedCwdRoots } from "@/lib/settings";

export async function GET(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get live tmux sessions
  const liveSessions = await tmux.listSessions();
  const liveNames = new Set(liveSessions.map((s) => s.name));

  // Get all projects from DB
  const projects = await prisma.project.findMany({
    include: { hosts: { include: { machine: true } } },
  });

  // Each project's live tmux state is overlaid (running flag, dimensions,
  // activity). tmux sessions without a matching DB project are NOT
  // surfaced here — comux is a project manager, not a tmux process
  // viewer; those rogue sessions belong on the host, not in the UI.
  const result = projects.map((p) => {
    const live = liveSessions.find((s) => s.name === p.name);
    return {
      name: p.name,
      display_name: p.displayName,
      description: p.description,
      color: p.color,
      priority: p.priority,
      cwd: p.cwd,
      command: p.command,
      repo_url: p.repoUrl,
      repo_token: p.repoToken ? "***" : "", // mask token in list
      created: live?.created || "",
      attached: live?.attached || false,
      width: live?.width || 0,
      height: live?.height || 0,
      activity: live?.activity || "",
      running: liveNames.has(p.name),
      hosts: p.hosts.map((h) => ({
        id: h.id,
        name: h.name,
        ssh_target: h.sshTarget,
        env: h.env,
        description: h.description,
        path: h.path,
        machine: h.machine?.hostname || null,
      })),
    };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const name = (body.name || "").trim();
  const projectsRoot = await getProjectsRoot();
  const cwd = body.cwd || `${projectsRoot}/${name}`;
  const command = body.command || undefined;
  const displayName = body.display_name || name;
  const color = body.color || "#6366f1";

  if (!name || !isValidSessionName(name)) {
    return NextResponse.json(
      { error: "Invalid project name (alphanumeric, dash, underscore only)" },
      { status: 400 }
    );
  }

  const allowedRoots = await getAllowedCwdRoots();
  if (cwd && !isValidCwd(cwd, ...allowedRoots)) {
    return NextResponse.json(
      { error: "Working directory must be within PROJECTS_ROOT (or comux's own source dir for self-managed setup)" },
      { status: 400 }
    );
  }

  if (command && !isValidCommand(command)) {
    return NextResponse.json(
      { error: "Invalid command" },
      { status: 400 }
    );
  }

  // Make sure the working directory exists before tmux starts — `-c` with a
  // missing path silently drops the shell into $HOME, which is exactly where
  // an agent should NOT wake up. cwd is already validated against the
  // allowed roots, and "empty dir = new project" is a supported flow.
  if (cwd) {
    try { await fs.mkdir(cwd, { recursive: true }); }
    catch { /* permission problems surface in tmux/healthcheck */ }
  }

  const session = await tmux.createSession(name, command, cwd);
  await prisma.project.upsert({
    where: { name },
    update: { displayName, color, cwd, command },
    create: { name, displayName, color, cwd, command },
  });

  return NextResponse.json({
    name: session.name,
    display_name: displayName,
    color,
  });
}
