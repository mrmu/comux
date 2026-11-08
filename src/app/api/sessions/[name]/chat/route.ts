import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import * as tmux from "@/lib/tmux";
import { parseJsonlMessages } from "@/lib/jsonl-parser";
import { resolveChatSession } from "@/lib/chat-session-resolver";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);

  if (cwd) {
    const resolved = await resolveChatSession(name, cwd);
    if (resolved) {
      const messages = parseJsonlMessages(resolved.path);
      if (messages.length) {
        return NextResponse.json({
          messages,
          source: "jsonl",
          sessionId: resolved.sessionId,
          resolvedBy: resolved.source,
        });
      }
    }
  }

  // Fallback: terminal parsing
  const content = await tmux.capturePane(name, 500);
  const messages = tmux.parseClaudeConversation(content);
  return NextResponse.json({ messages, source: "terminal" });
}
