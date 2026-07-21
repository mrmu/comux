import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execFileAsync = promisify(execFile);

export { classifyRepoUrl, type RepoUrlKind } from "./repo-url";

export interface CwdGitStatus {
  cwdExists: boolean;
  isDirectory: boolean;
  isEmpty: boolean;
  isGitRepo: boolean;
  remoteUrl: string;
  remoteMatches: boolean | null; // null when no expected url to compare
}

export async function inspectCwd(
  cwd: string,
  expectedRemote: string
): Promise<CwdGitStatus> {
  const status: CwdGitStatus = {
    cwdExists: false,
    isDirectory: false,
    isEmpty: false,
    isGitRepo: false,
    remoteUrl: "",
    remoteMatches: expectedRemote ? false : null,
  };

  let stat;
  try {
    stat = await fs.stat(cwd);
  } catch {
    return status;
  }
  status.cwdExists = true;
  status.isDirectory = stat.isDirectory();
  if (!status.isDirectory) return status;

  const entries = await fs.readdir(cwd).catch(() => [] as string[]);
  // Ignore `.comux` when deciding emptiness — comux may have synced it
  // before the repo is cloned, and it shouldn't block the clone button.
  const meaningful = entries.filter((e) => e !== ".comux");
  status.isEmpty = meaningful.length === 0;
  status.isGitRepo = entries.includes(".git");

  if (status.isGitRepo) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["-C", cwd, "remote", "get-url", "origin"],
        { timeout: 5000 }
      );
      status.remoteUrl = stdout.trim();
    } catch {
      status.remoteUrl = "";
    }
    if (expectedRemote) {
      status.remoteMatches = normalizeRemote(status.remoteUrl) === normalizeRemote(expectedRemote);
    }
  }

  return status;
}

/** Normalize ssh / https forms of the same repo so a/b comparisons don't
 *  false-fail. Strips trailing `.git` and lowercases the host. */
function normalizeRemote(url: string): string {
  let u = url.trim().replace(/\.git$/i, "");
  // git@host:owner/repo → host/owner/repo
  const sshMatch = u.match(/^[a-zA-Z0-9._-]+@([a-zA-Z0-9.-]+):(.+)$/);
  if (sshMatch) u = `${sshMatch[1].toLowerCase()}/${sshMatch[2]}`;
  // https://host/owner/repo → host/owner/repo
  const httpsMatch = u.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/);
  if (httpsMatch) u = `${httpsMatch[1].toLowerCase()}/${httpsMatch[2]}`;
  return u;
}

export interface GitCloneResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Clone `repoUrl` into `cwd`. The caller must have already validated that
 *  `cwd` is within projectsRoot and the directory is empty / missing.
 *  Uses execFile (no shell) and a strict env so credential helpers and
 *  interactive ssh prompts can't hang the request. */
export async function gitClone(
  repoUrl: string,
  cwd: string,
  timeoutMs = 120_000
): Promise<GitCloneResult> {
  const parent = path.dirname(cwd);
  await fs.mkdir(parent, { recursive: true });

  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/echo",
    // Fail fast if host key isn't already trusted; user must `ssh -T git@github.com`
    // once on the host (or pre-seed known_hosts) before this works.
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      "git",
      ["clone", "--", repoUrl, cwd],
      { timeout: timeoutMs, env, maxBuffer: 4 * 1024 * 1024 }
    );
    return { ok: true, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout || "",
      stderr: e.stderr || e.message || "git clone failed",
    };
  }
}
