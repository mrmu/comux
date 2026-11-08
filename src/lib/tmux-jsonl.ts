import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs";

const execFileAsync = promisify(execFile);
const TMUX_SOCKET = process.env.TMUX_SOCKET || "";
const CLAUDE_HOME = path.join(process.env.HOME || os.homedir(), ".claude");
const CLAUDE_SESSIONS = path.join(CLAUDE_HOME, "sessions");

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 3000 });
    return stdout;
  } catch {
    return "";
  }
}

async function tmuxPanePid(sessionName: string): Promise<number | null> {
  const args = [
    ...(TMUX_SOCKET ? ["-S", TMUX_SOCKET] : []),
    "display-message",
    "-t",
    sessionName,
    "-p",
    "#{pane_pid}",
  ];
  const pid = parseInt((await run("tmux", args)).trim());
  return Number.isFinite(pid) ? pid : null;
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const psOut = await run("ps", ["-eo", "pid,ppid"]);
  const childrenOf = new Map<number, number[]>();
  for (const line of psOut.split("\n").slice(1)) {
    const [pidStr, ppidStr] = line.trim().split(/\s+/);
    const pid = parseInt(pidStr);
    const ppid = parseInt(ppidStr);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const arr = childrenOf.get(ppid) || [];
    arr.push(pid);
    childrenOf.set(ppid, arr);
  }
  const out: number[] = [];
  const stack = [rootPid];
  const seen = new Set<number>();
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    for (const c of childrenOf.get(p) || []) {
      if (!seen.has(c)) {
        out.push(c);
        stack.push(c);
      }
    }
  }
  return out;
}

// Read claude's session state file at ~/.claude/sessions/<pid>.json.
// Claude Code writes this file on start with the session ID it's using,
// so it's the authoritative source for "which JSONL does this PID write to".
function readSessionFile(pid: number): { sessionId: string; cwd: string } | null {
  try {
    const raw = fs.readFileSync(path.join(CLAUDE_SESSIONS, `${pid}.json`), "utf-8");
    const obj = JSON.parse(raw) as { sessionId?: string; cwd?: string };
    if (obj.sessionId && obj.cwd) return { sessionId: obj.sessionId, cwd: obj.cwd };
  } catch {
    /* missing or unreadable — not a running claude */
  }
  return null;
}

/**
 * Find the session ID of the claude process running inside the given tmux
 * session. Returns null if no claude is found, or if its cwd doesn't match
 * the project (protects against a claude that chdir'd elsewhere).
 */
export async function detectTmuxJsonl(
  tmuxSessionName: string,
  projectCwd: string
): Promise<string | null> {
  if (!tmuxSessionName || !projectCwd) return null;

  const rootPid = await tmuxPanePid(tmuxSessionName);
  if (!rootPid) return null;

  const candidates = [rootPid, ...(await descendantPids(rootPid))];
  for (const pid of candidates) {
    const info = readSessionFile(pid);
    if (info && info.cwd === projectCwd) return info.sessionId;
  }
  return null;
}
