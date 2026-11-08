import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import * as tmux from "@/lib/tmux";
import {
  extractInteractiveContent,
  parseStatusLine,
} from "@/lib/terminal-parser";

const SHELL_NAMES = new Set(["bash", "zsh", "sh", "fish", "dash"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const content = await tmux.capturePane(name);
  const paneCmd = await tmux.getPaneCommand(name);
  // idle = no process, or process is a shell (not claude)
  const processIdle = !paneCmd || SHELL_NAMES.has(paneCmd.toLowerCase());

  const result: Record<string, unknown> = {
    interactive: false,
    type: null,
    content: null,
    status: null,
    process: paneCmd,
    idle: processIdle,
  };

  const ui = extractInteractiveContent(content);
  if (ui) {
    result.interactive = true;
    result.type = ui.name;
    result.content = ui.content;
  }

  const status = parseStatusLine(content);
  if (status) result.status = status;

  return NextResponse.json(result);
}
