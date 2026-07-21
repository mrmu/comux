import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as tmux from "@/lib/tmux";
import { isValidCwd, isValidCommand } from "@/lib/validate";
import { getAllowedCwdRoots } from "@/lib/settings";
import { syncComuxDir } from "@/lib/sync-comux-dir";

/** pane_current_command values that mean "nothing but a shell is running". */
const SHELL_COMMANDS = new Set(["bash", "zsh", "sh", "fish", "dash", "ksh", "tcsh", "login", ""]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const project = await prisma.project.findUnique({
    where: { name },
    select: { name: true, displayName: true, color: true, cwd: true, agent: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // `agent` records which agent this project uses (drives Chat-tab
  // visibility / transcript adapter); `agent_running` is the live state —
  // whether the tmux pane is actually running something beyond a shell.
  // After a session restart agent stays set but agent_running is false, so
  // the UI lands on Terminal until the agent is (re)launched.
  let agentRunning = false;
  if (project.agent) {
    const cmd = await tmux.getPaneCommand(name);
    agentRunning = !SHELL_COMMANDS.has(cmd);
  }

  return NextResponse.json({
    name: project.name,
    display_name: project.displayName,
    color: project.color,
    cwd: project.cwd,
    agent: project.agent,
    agent_running: agentRunning,
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json();

  // Validate cwd if provided
  const allowedRoots = await getAllowedCwdRoots();
  if (body.cwd !== undefined && body.cwd !== "" && !isValidCwd(body.cwd, ...allowedRoots)) {
    return NextResponse.json(
      { error: "Working directory must be within PROJECTS_ROOT (or comux's own source dir for self-managed setup)" },
      { status: 400 }
    );
  }

  // Validate command if provided
  if (body.command !== undefined && body.command !== "" && !isValidCommand(body.command)) {
    return NextResponse.json(
      { error: "Invalid command" },
      { status: 400 }
    );
  }

  if (body.priority !== undefined && !["high", "medium", "low"].includes(body.priority)) {
    return NextResponse.json({ error: "priority must be high/medium/low" }, { status: 400 });
  }

  await prisma.project.upsert({
    where: { name },
    update: {
      ...(body.display_name && { displayName: body.display_name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.color && { color: body.color }),
      ...(body.cwd !== undefined && { cwd: body.cwd }),
      ...(body.command !== undefined && { command: body.command }),
      ...(body.repo_url !== undefined && { repoUrl: body.repo_url }),
      ...(body.repo_token !== undefined && { repoToken: body.repo_token }),
      ...(body.priority !== undefined && { priority: body.priority }),
    },
    create: {
      name,
      displayName: body.display_name || name,
      description: body.description || "",
      color: body.color || "#6366f1",
      cwd: body.cwd || "",
      command: body.command || "",
      repoUrl: body.repo_url || "",
      repoToken: body.repo_token || "",
    },
  });

  // Regenerate `.comux/` whenever project metadata changes (esp. first-time
  // cwd set creates the dir and seeds user files).
  await syncComuxDir(name);

  return NextResponse.json({ ok: true });
}
