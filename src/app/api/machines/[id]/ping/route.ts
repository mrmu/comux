import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sshTargetOf } from "@/lib/machines";
import { isValidHostname, isValidSshUser } from "@/lib/validate";

const execFileAsync = promisify(execFile);

/** Test ssh reachability: `ssh -o BatchMode=yes <target> true`.
 *  BatchMode fails fast instead of hanging on a password prompt, so a
 *  failure here means either unreachable or key auth not set up — both
 *  things the user wants to know before pointing an agent at the machine. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAuth(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const machine = await prisma.machine.findUnique({ where: { id: parseInt(id) } });
  if (!machine) {
    return NextResponse.json({ error: "Machine not found" }, { status: 404 });
  }
  if (machine.isSelf) {
    return NextResponse.json({ ok: true, detail: "這台就是 comux 主開發機，不需要 SSH。" });
  }
  // Defense in depth: hostname/sshUser are validated on write, but re-check
  // before handing them to a subprocess.
  if (!isValidHostname(machine.hostname) || (machine.sshUser && !isValidSshUser(machine.sshUser))) {
    return NextResponse.json({ error: "hostname / ssh user 含不合法字元" }, { status: 400 });
  }

  const target = sshTargetOf(machine);
  const started = Date.now();
  try {
    await execFileAsync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", "--", target, "true"],
      { timeout: 15_000 }
    );
    return NextResponse.json({ ok: true, detail: `ssh ${target} OK（${Date.now() - started}ms）` });
  } catch (e) {
    const stderr = ((e as { stderr?: string }).stderr || (e as Error).message).trim();
    let hint = "";
    if (/failed to look up local user "([^"]+)"/i.test(stderr)) {
      const missing = stderr.match(/failed to look up local user "([^"]+)"/i)?.[1];
      hint = `目的機器上沒有使用者「${missing}」${machine.sshUser ? "" : "（未設定 SSH 使用者時會用 comux 主機的執行身分）"} — 按「編輯」把 SSH 使用者改成該機器上實際存在的帳號。`;
    } else if (/Permission denied/i.test(stderr)) {
      hint = "連得到但認證失敗 — 確認 Tailscale SSH 已啟用，或把主開發機公鑰加到該機器。";
    } else if (/Could not resolve|Name or service not known/i.test(stderr)) {
      hint = "解析不到主機名稱 — 確認這台機器在 tailnet 上且 MagicDNS 開啟。";
    } else if (/timed out|timeout/i.test(stderr)) {
      hint = "連線逾時 — 機器可能離線。";
    }
    return NextResponse.json({
      ok: false,
      detail: stderr.split("\n").slice(0, 2).join(" "),
      hint,
    });
  }
}
