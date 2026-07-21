import fs from "fs";
import path from "path";
import { prisma } from "./db";
import { getSetting } from "./settings";
import { getSelfMachine, sshTargetOf } from "./machines";

/**
 * Sync auto-generated metadata from DB into `{cwd}/.comux/` so AI agents
 * (Claude Code, Codex, Cursor, …) can pick up project context in a
 * vendor-neutral location.
 *
 * Auto files (README.md / project.md / hosts.md) are regenerated from DB.
 * User files (deploy.md / test.md) are NOT touched here — they live as
 * source-of-truth files on disk, edited directly or via the docs API
 * (`/api/sessions/[name]/comux/docs`). On a fresh project we seed empty
 * scaffolding so the user has something to fill in.
 *
 * Also cleans up the legacy `.claude/comux-hosts.md` from when comux wrote
 * into Claude Code's own namespace.
 */
export async function syncComuxDir(projectName: string): Promise<void> {
  const project = await prisma.project
    .findUnique({
      where: { name: projectName },
      include: { hosts: { orderBy: { env: "asc" }, include: { machine: true } } },
    })
    .catch(() => null);

  if (!project?.cwd) return;

  // Migration: drop the old `.claude/comux-hosts.md` if present. `.claude/`
  // is Claude Code's own dir — comux should not squat there.
  const legacyPath = path.join(project.cwd, ".claude", "comux-hosts.md");
  try { fs.unlinkSync(legacyPath); } catch { /* ignore */ }

  const dir = path.join(project.cwd, ".comux");
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch { return; /* project directory missing */ }

  // Local/remote classification. Preferred signal: the host's machine is
  // the registry's self machine. Legacy fallback: free-text sshTarget
  // matches the localHost setting / localhost aliases.
  const self = await getSelfMachine();
  const localHostSetting = await getSetting("localHost") || "";
  const localAliases = new Set(["localhost", "127.0.0.1", "local", self.hostname]);
  if (localHostSetting) {
    localAliases.add(localHostSetting);
    const parts = localHostSetting.split("@");
    if (parts.length === 2) localAliases.add(parts[1]);
  }
  type HostRow = (typeof project.hosts)[number];
  const isLocal = (h: HostRow) =>
    h.machine ? h.machine.isSelf : localAliases.has(h.sshTarget);
  /** How to reach the host: registry machine wins over legacy sshTarget. */
  const targetOf = (h: HostRow) =>
    h.machine ? sshTargetOf(h.machine) : h.sshTarget;
  const whereOf = (h: HostRow) => (h.machine ? h.machine.hostname : h.sshTarget);

  const hasLocal = project.hosts.some((h) => h.deployType !== "cloud-run" && isLocal(h));
  const hasRemote = project.hosts.some((h) => h.deployType !== "cloud-run" && !isLocal(h));
  const hasCloudRun = project.hosts.some((h) => h.deployType === "cloud-run");
  const status = project.hosts.length === 0
    ? "No hosts configured."
    : hasLocal && hasRemote
      ? "Mixed — some envs run on this machine, others deploy via SSH (see hosts table)."
      : hasLocal
        ? "Runs on this machine. Do NOT use SSH — run deploy commands directly in the project directory."
        : hasRemote
          ? "Deploys via SSH to the hosts listed below."
          : hasCloudRun
            ? "Deploys to Cloud Run via gcloud from the dev machine. Do NOT use SSH."
            : "Deploys via SSH to the hosts listed below.";

  // README.md — always written. Tracked in git (along with the rest of the
  // directory) so the convention travels with the repo; anyone cloning can
  // immediately understand the layout without installing comux.
  writeAuto(
    path.join(dir, "README.md"),
    [
      "# .comux — Project Settings",
      "",
      "> Auto-maintained by [comux](https://github.com/mrmu/comux).",
      "> Files marked **auto** are regenerated — do not edit manually.",
      "> Files marked **user** are yours to edit; comux will not overwrite them.",
      "",
      "## Files",
      "",
      "| File | Owner | Purpose |",
      "|------|-------|---------|",
      "| `README.md`  | auto | This file |",
      "| `project.md` | auto | Project overview |",
      "| `hosts.md`   | auto | Deployment hosts (managed in the comux UI) |",
      "| `deploy.md`  | user | How to deploy this project |",
      "| `test.md`    | user | How to test / verify this project |",
      "",
      "## For AI agents",
      "",
      "These files contain authoritative project context. When deploying, testing, or",
      "reasoning about hosts, prefer the content here over ad-hoc notes elsewhere.",
      "",
      "### Onboarding an existing project",
      "",
      "If the repository already documents deployment or testing elsewhere (a",
      "`## Deploy` section in `CLAUDE.md`, a `docs/deploy.md`, a shell script in",
      "`scripts/`, etc.), help the user consolidate it:",
      "",
      "1. Read the existing material and summarise it into concise, runnable steps.",
      "2. Ask the user to paste the summary into comux → Settings → Project Docs",
      "   (Deploy steps / Test checklist). comux stores it in the DB and",
      "   regenerates `deploy.md` / `test.md` here.",
      "3. Once the content is in comux, treat the files in this directory as the",
      "   canonical source going forward.",
      "",
      "Hosts (`hosts.md`) are managed in the comux UI under Settings → Hosts.",
      "",
    ].join("\n")
  );

  // project.md — always written. Intentionally portable: no absolute cwd
  // (the reader is already sitting in the project dir), so the file can be
  // committed without per-machine diff noise.
  writeAuto(
    path.join(dir, "project.md"),
    [
      `# ${project.displayName || project.name}`,
      "",
      "> Auto-generated by comux. Do not edit manually.",
      "",
      `- **Name**: \`${project.name}\``,
      `- **Deployment**: ${status}`,
      ...(project.description ? ["", `**Description**: ${project.description}`] : []),
      "",
    ].join("\n")
  );

  // hosts.md — always written (even with no hosts, so agents see the status).
  // Opens with a "you are here" anchor so an agent can never confuse the
  // dev machine with a deploy target.
  const hostLines: string[] = [
    "# Deployment Hosts",
    "",
    "> Auto-generated by comux. Managed via the comux UI — do not edit manually.",
    "",
    "## Where am I?",
    "",
    `comux 主開發機是 \`${self.hostname}\`；本專案在主開發機上的開發目錄是 \`${project.cwd}\`。`,
    "在做任何部署動作之前，先執行 `hostname` 確認你目前在哪台機器：",
    "",
    `- 在 \`${self.hostname}\`（主開發機）→ 依下表 SSH 到目標機器（或用 gcloud）部署`,
    "- 已經在目標機器上 → 直接 `cd` 到對應路徑操作，**不要再 SSH**",
    "- 路徑或機器和下表對不起來 → 停下來問使用者，不要猜",
    "",
    `**Status**: ${status}`,
    "",
  ];

  if (project.hosts.length > 0) {
    // development → staging → production reads in deploy order
    const ENV_ORDER: Record<string, number> = { development: 0, staging: 1, production: 2 };
    const sorted = [...project.hosts].sort(
      (a, b) => (ENV_ORDER[a.env] ?? 9) - (ENV_ORDER[b.env] ?? 9)
    );

    // Auto row for the dev machine unless the user defined a development
    // host themselves — the dev path is always project.cwd.
    const hasDevRow = sorted.some((h) => h.env === "development");
    const rows: string[] = [];
    if (!hasDevRow) {
      rows.push(
        `| development | \`${self.hostname}\`（主開發機） | \`${project.cwd}\` | 你已經在這 — 直接 \`cd ${project.cwd}\`，不要 SSH |`
      );
    }
    for (const h of sorted) {
      if (h.deployType === "cloud-run") {
        rows.push(
          `| ${h.env} | ${h.name}（Cloud Run） | — | 在主開發機的 \`${project.cwd}\` 用 \`gcloud\` 部署，不要 SSH${h.description ? `。${h.description}` : ""} |`
        );
      } else if (isLocal(h)) {
        rows.push(
          `| ${h.env} | \`${whereOf(h)}\`（主開發機） | \`${h.path || project.cwd}\` | 本機直接執行，不要 SSH |`
        );
      } else {
        rows.push(
          `| ${h.env} | \`${whereOf(h)}\` | ${h.path ? `\`${h.path}\`` : "（未設定）"} | \`ssh ${targetOf(h)}\`${h.path ? ` 然後 \`cd ${h.path}\`` : ""} |`
        );
      }
    }
    hostLines.push(
      "| Environment | Where | Path | How to get there |",
      "|------------|-------|------|------------------|",
      ...rows,
      ""
    );

    const remoteHosts = sorted.filter((h) => h.deployType !== "cloud-run" && !isLocal(h));
    if (remoteHosts.length > 0) {
      hostLines.push("## Deploy commands", "");
      for (const h of remoteHosts) {
        hostLines.push(
          `### ${h.name} (${h.env})`,
          ...(h.description ? [h.description, ""] : []),
          "```bash",
          `ssh ${targetOf(h)}`,
          ...(h.path ? [`cd ${h.path}`] : []),
          "```",
          ""
        );
      }
    }
    const cloudRunHosts = sorted.filter((h) => h.deployType === "cloud-run");
    if (cloudRunHosts.length > 0) {
      hostLines.push("## Cloud Run", "");
      for (const h of cloudRunHosts) {
        hostLines.push(
          `### ${h.name} (${h.env})`,
          `部署方式：在主開發機（\`${self.hostname}\`）的 \`${project.cwd}\` 內用 \`gcloud\` 部署，需要先 \`gcloud auth login\` 授權。不要 SSH。`,
          ...(h.description ? [h.description] : []),
          ""
        );
      }
    }
  }
  writeAuto(path.join(dir, "hosts.md"), hostLines.join("\n"));

  // deploy.md / test.md are user-owned files. comux does NOT touch them
  // here — they're read/written via /api/sessions/[name]/comux/docs.
  // Seed empty scaffolding only if neither exists, so a fresh project
  // has something to fill in.
  seedDocIfMissing(path.join(dir, "deploy.md"), DEPLOY_TEMPLATE);
  seedDocIfMissing(path.join(dir, "test.md"), TEST_TEMPLATE);
}

const DEPLOY_TEMPLATE = `# Deployment

<!--
  Edit this file directly, or via comux → Settings → 部署步驟.
  comux will not overwrite this file.
-->

## Steps

- [ ]
`;

const TEST_TEMPLATE = `# Test & Verification

<!--
  Edit this file directly, or via comux → Settings → 測試清單.
  comux will not overwrite this file.
-->

## Before deploying

- [ ]

## After deploying

- [ ]
`;

function seedDocIfMissing(filePath: string, content: string): void {
  try { fs.statSync(filePath); return; }
  catch { /* file missing — seed it */ }
  try { fs.writeFileSync(filePath, content, "utf-8"); }
  catch { /* ignore — user can create it later */ }
}

function writeAuto(filePath: string, content: string): void {
  try {
    // Skip the write if the file already has the exact same content. Keeps
    // mtime stable across unrelated mutations so git / file watchers don't
    // flag `.comux/` as touched when nothing meaningful changed.
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return;
  } catch { /* no existing file — fall through to write */ }
  try { fs.writeFileSync(filePath, content, "utf-8"); }
  catch { /* ignore */ }
}

/** Single source of truth for what "has a comux pointer" means in any agent file. */
export function hasComuxPointer(content: string): boolean {
  return /\.comux\//.test(content);
}

/** The pointer block we append to CLAUDE.md / AGENTS.md / etc. The "re-read"
 *  wording is deliberate — the files are DB-backed and can change via the
 *  comux UI between turns, so agents must not rely on earlier snapshots. */
export const COMUX_POINTER_BLOCK = [
  "",
  "## Project Settings (managed by comux)",
  "",
  "Project-level configuration lives in [`.comux/`](.comux/).",
  "**Before deploying, testing, or reasoning about hosts, re-read these",
  "files** — they may have been updated via the comux UI since you last",
  "loaded them. Do not rely on earlier snapshots.",
  "",
  "- [`.comux/project.md`](.comux/project.md) — project overview (auto)",
  "- [`.comux/hosts.md`](.comux/hosts.md) — deployment hosts (auto)",
  "- [`.comux/deploy.md`](.comux/deploy.md) — deployment steps",
  "- [`.comux/test.md`](.comux/test.md) — test checklist; walk every item and mark a deploy green only when all pass",
  "",
].join("\n");

/** Well-known agent-context filenames comux can manage pointers in.
 *  Each is plain markdown so the pointer block appends cleanly. */
export const AGENT_POINTER_TARGETS = [
  { filename: "CLAUDE.md", agent: "Claude Code" },
  { filename: "AGENTS.md", agent: "OpenAI Codex" },
] as const;

export function readPointerStatus(cwd: string, filename: string): {
  filename: string;
  exists: boolean;
  hasPointer: boolean;
} {
  const p = path.join(cwd, filename);
  try {
    const content = fs.readFileSync(p, "utf-8");
    return { filename, exists: true, hasPointer: hasComuxPointer(content) };
  } catch {
    return { filename, exists: false, hasPointer: false };
  }
}

/** Idempotently ensure the pointer block is present in `{cwd}/{filename}`.
 *  Creates the file (and any parent dirs) if missing. */
export function ensurePointer(cwd: string, filename: string): {
  ok: boolean;
  alreadyPresent: boolean;
  created: boolean;
} {
  const p = path.join(cwd, filename);
  let existing = "";
  let created = false;
  try {
    existing = fs.readFileSync(p, "utf-8");
  } catch {
    created = true;
  }
  if (hasComuxPointer(existing)) {
    return { ok: true, alreadyPresent: true, created: false };
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(p, existing + separator + COMUX_POINTER_BLOCK, "utf-8");
  return { ok: true, alreadyPresent: false, created };
}
