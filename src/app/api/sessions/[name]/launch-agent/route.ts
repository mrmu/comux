import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as tmux from "@/lib/tmux";

const execFileAsync = promisify(execFile);

const AGENTS = {
  // Claude defaults to --dangerously-skip-permissions because comux is
  // already running on a single-tenant host that comux itself controls;
  // the per-tool permission prompts add friction without security gain.
  claude:  { binary: "claude",  label: "Claude Code",  args: ["--dangerously-skip-permissions"] },
  codex:   { binary: "codex",   label: "OpenAI Codex", args: [] as string[] },
  gemini:  { binary: "gemini",  label: "Gemini CLI",   args: [] as string[] },
} as const;
type AgentId = keyof typeof AGENTS;

function isAgentId(s: unknown): s is AgentId {
  return typeof s === "string" && s in AGENTS;
}

/** Launch an AI agent CLI inside the project's tmux session and record
 *  which agent the project is now running. The agent declaration here
 *  drives the Chat-tab visibility and (later) the transcript adapter
 *  the chat view will use. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const body = await request.json().catch(() => ({}));
  const agentId: unknown = body?.agent;
  if (!isAgentId(agentId)) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }
  const { binary, label, args } = AGENTS[agentId];

  const project = await prisma.project.findUnique({ where: { name } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Pre-flight: confirm the binary is on PATH so we don't quietly send
  // a typo into the user's shell.
  try {
    await execFileAsync("which", [binary], { timeout: 3000 });
  } catch {
    return NextResponse.json(
      { error: `${label} CLI 沒裝（找不到 \`${binary}\`）。請先在主機上 npm install -g ... 後重試。` },
      { status: 400 }
    );
  }

  // Make sure a tmux session exists for the project — if not, start one
  // in the project's cwd so the launch lands in the right directory.
  const live = await tmux.listSessions();
  if (!live.find((s) => s.name === name)) {
    if (!project.cwd) {
      return NextResponse.json(
        { error: "工作目錄未設定，無法啟動 agent。" },
        { status: 400 }
      );
    }
    try {
      await tmux.createSession(name, undefined, project.cwd);
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to create tmux session: ${(e as Error).message}` },
        { status: 500 }
      );
    }
  }

  // If the pane is already running something (typically the previous agent
  // instance), the launch command would be typed INTO that program instead
  // of the shell — the classic way to end up with a flag-less `claude`
  // after a "restart". Exit it first and wait for the shell to come back.
  let paneCmd = await tmux.getPaneCommand(name);
  if (!SHELL_COMMANDS.has(paneCmd)) {
    // Escape clears any half-typed input; Ctrl-C twice exits claude's REPL
    // (and interrupts/exits most CLIs). Re-send while waiting in case the
    // first pair only interrupted a running task.
    await tmux.sendSpecialKey(name, "Escape").catch(() => {});
    await sleep(150);
    for (let attempt = 0; attempt < 3 && !SHELL_COMMANDS.has(paneCmd); attempt++) {
      await tmux.sendSpecialKey(name, "C-c").catch(() => {});
      await sleep(350);
      await tmux.sendSpecialKey(name, "C-c").catch(() => {});
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        await sleep(400);
        paneCmd = await tmux.getPaneCommand(name);
        if (SHELL_COMMANDS.has(paneCmd)) break;
      }
    }
    if (!SHELL_COMMANDS.has(paneCmd)) {
      return NextResponse.json(
        { error: `終端機裡還有程式在執行（${paneCmd}），自動結束失敗 — 請先在 Terminal 手動結束它，再按重啟。` },
        { status: 409 }
      );
    }
  }

  const launchCmd = [binary, ...args].join(" ");
  try {
    await tmux.sendKeys(name, launchCmd);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to send command to tmux: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  await prisma.project.update({
    where: { name },
    data: { agent: agentId },
  });

  // Claude Code shows a one-time folder-trust prompt before the REPL. On a
  // comux host that decision was already made when the user created the
  // project (and we launch with --dangerously-skip-permissions anyway), so
  // accept it automatically and only report ready once the REPL is up —
  // the UI holds the Terminal tab until then instead of bouncing the user
  // to a Chat view that can't answer interactive prompts.
  const ready = agentId === "claude" ? await waitForClaudeReady(name) : true;

  return NextResponse.json({ ok: true, agent: agentId, ready });
}

/** pane_current_command values that mean "just a shell, safe to type into". */
const SHELL_COMMANDS = new Set(["bash", "zsh", "sh", "fish", "dash", "ksh", "tcsh", "login", ""]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const TRUST_PROMPT_RE = /trust this folder|Do you trust|Quick safety check/i;
// "? for shortcuts" / "bypass permissions" only ever appear in the live
// REPL footer — not in the shell echo of the launch command.
const REPL_READY_RE = /\? for shortcuts|bypass permissions/i;

async function waitForClaudeReady(session: string): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  let trustAccepted = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const pane = await tmux.capturePane(session, 50).catch(() => "");
    if (REPL_READY_RE.test(pane)) return true;
    if (!trustAccepted && TRUST_PROMPT_RE.test(pane)) {
      // "Yes, I trust this folder" is pre-selected — Enter confirms it
      await tmux.sendSpecialKey(session, "Enter").catch(() => {});
      trustAccepted = true;
    }
  }
  return false;
}
