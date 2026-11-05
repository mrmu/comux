import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import { classifyRepoUrl } from "./repo-url";
import { inspectCwd } from "./git";

const execFileAsync = promisify(execFile);

export interface HealthCheck {
  id: string;
  label: string;
  ok: boolean | null;   // null = skipped (precondition not met)
  detail: string;       // short explanation of current state
  hint: string;         // actionable fix when ok=false
}

export interface HealthCheckInput {
  projectName: string;
  cwd: string;
  repoUrl: string;
  projectsRoot: string;
}

export async function runHealthChecks(input: HealthCheckInput): Promise<HealthCheck[]> {
  const { cwd, repoUrl, projectsRoot } = input;
  const checks: HealthCheck[] = [];

  // 1) projectsRoot readable + writable by the comux process user
  checks.push(await checkAccess(
    "projects-root",
    "PROJECTS_ROOT 可讀寫",
    projectsRoot,
    `comux 無法讀寫 ${projectsRoot}。在主機上：sudo chown -R $(whoami) ${projectsRoot}`
  ));

  // 2) cwd exists + is a git repo + remote matches
  const cwdStatus = cwd ? await inspectCwd(cwd, repoUrl) : null;
  if (!cwd) {
    checks.push({
      id: "cwd-set",
      label: "工作目錄已設定",
      ok: false,
      detail: "未設定",
      hint: "請先在「基本」區填入工作目錄路徑。",
    });
  } else {
    checks.push({
      id: "cwd-exists",
      label: "工作目錄存在",
      ok: cwdStatus!.cwdExists,
      detail: cwdStatus!.cwdExists ? cwd : `${cwd}（不存在）`,
      hint: "可在「版本庫」區設好 repo URL 後按 Clone 建立。",
    });

    if (cwdStatus!.cwdExists) {
      checks.push({
        id: "is-git-repo",
        label: "是 git repo",
        ok: cwdStatus!.isGitRepo,
        detail: cwdStatus!.isGitRepo ? "已 init" : "不是 git repo",
        hint: cwdStatus!.isEmpty
          ? "目錄為空，請按「版本庫 → Clone」。"
          : "目錄有檔案但不是 git repo，請手動處理（移走或在主機上 git init）。",
      });

      if (cwdStatus!.isGitRepo && repoUrl) {
        checks.push({
          id: "remote-matches",
          label: "git remote 與設定一致",
          ok: cwdStatus!.remoteMatches === true,
          detail:
            cwdStatus!.remoteMatches === true
              ? cwdStatus!.remoteUrl
              : `現有：${cwdStatus!.remoteUrl || "(無)"}`,
          hint: `在主機上：cd ${cwd} && git remote set-url origin ${repoUrl}`,
        });
      }

      // 3) cwd writable by comux
      checks.push(await checkWriteInDir(cwd));
    }
  }

  // 4) ssh push-auth probe — only meaningful when repoUrl is SSH and we
  //    actually expect to push. Uses ls-remote which is read-only.
  const repoUrlKind = classifyRepoUrl(repoUrl);
  if (repoUrlKind === "ssh") {
    checks.push(await checkSshLsRemote(repoUrl));
  } else {
    checks.push({
      id: "ssh-auth",
      label: "SSH push 認證",
      ok: null,
      detail: repoUrlKind === "https"
        ? "略過：repo URL 是 HTTPS，agent 改完無法 push 回去"
        : "略過：repo URL 未設定",
      hint: "若需要 agent push 回 repo，請改用 SSH URL（git@host:user/repo.git）。",
    });
  }

  // 5) Claude Code CLI present
  checks.push(await checkBinary(
    "claude-cli",
    "Claude Code CLI 在 PATH",
    "claude",
    ["--version"],
    "在主機上：curl -fsSL https://claude.ai/install.sh | bash（裝到 ~/.local/bin，重啟 comux 後會自動加進 PATH）"
  ));

  // 6) tmux present (terminal feature depends on it)
  checks.push(await checkBinary(
    "tmux",
    "tmux 可用",
    "tmux",
    ["-V"],
    "在主機上：sudo apt install -y tmux"
  ));

  return checks;
}

async function checkAccess(id: string, label: string, dir: string, hint: string): Promise<HealthCheck> {
  try {
    await fs.access(dir, fsConstants.R_OK | fsConstants.W_OK);
    return { id, label, ok: true, detail: dir, hint: "" };
  } catch (e) {
    return {
      id,
      label,
      ok: false,
      detail: (e as Error).message,
      hint,
    };
  }
}

async function checkWriteInDir(cwd: string): Promise<HealthCheck> {
  const probeDir = path.join(cwd, ".comux");
  const probeFile = path.join(probeDir, ".write_test");
  try {
    await fs.mkdir(probeDir, { recursive: true });
    await fs.writeFile(probeFile, "ok");
    await fs.unlink(probeFile);
    return {
      id: "cwd-writable",
      label: "comux 可寫入工作目錄",
      ok: true,
      detail: cwd,
      hint: "",
    };
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).message;
    return {
      id: "cwd-writable",
      label: "comux 可寫入工作目錄",
      ok: false,
      detail: msg,
      hint: `comux 無法寫入 ${cwd}。在主機上：sudo chown -R $(whoami) ${cwd}`,
    };
  }
}

async function checkSshLsRemote(repoUrl: string): Promise<HealthCheck> {
  try {
    await execFileAsync("git", ["ls-remote", "--heads", "--", repoUrl], {
      timeout: 15_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "/bin/echo",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
      },
    });
    return {
      id: "ssh-auth",
      label: "SSH push 認證",
      ok: true,
      detail: "ls-remote 通過（push 認證 OK）",
      hint: "",
    };
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr || (e as Error).message;
    let hint = "請把這台 comux 主機的 ssh 公鑰加到 git host 的 deploy keys。可用：cat ~/.ssh/id_ed25519.pub";
    if (/Host key verification failed/i.test(stderr)) {
      hint = "ssh host key 尚未信任，請先 ssh -T git@github.com 接受一次。";
    } else if (/Could not resolve host/i.test(stderr)) {
      hint = "DNS 解析失敗，主機沒有網路或 URL 拼錯。";
    }
    return {
      id: "ssh-auth",
      label: "SSH push 認證",
      ok: false,
      detail: stderr.split("\n").slice(0, 3).join(" "),
      hint,
    };
  }
}

async function checkBinary(
  id: string,
  label: string,
  cmd: string,
  args: string[],
  hint: string
): Promise<HealthCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 5_000 });
    return {
      id,
      label,
      ok: true,
      detail: (stdout || stderr).trim().split("\n")[0] || "ok",
      hint: "",
    };
  } catch (e) {
    return {
      id,
      label,
      ok: false,
      detail: (e as Error).message.split("\n")[0],
      hint,
    };
  }
}
