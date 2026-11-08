import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProjectCwd } from "@/lib/project-cwd";
import { parseJsonlMessages } from "@/lib/jsonl-parser";
import { resolveChatSession } from "@/lib/chat-session-resolver";
import { extractNoteExchanges } from "@/lib/extract-note-exchanges";
import fs from "fs";

/**
 * SSE stream of chat messages. Every 3s it re-resolves which JSONL to follow
 * (respecting pin / tmux-detect / latest-mtime). When the resolved session
 * changes, it switches the file watcher to the new file.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  if (!(await requireAuth(request)))
    return new Response("Unauthorized", { status: 401 });

  const { name } = await params;
  const cwd = await getProjectCwd(name);
  if (!cwd) return new Response("Project not found", { status: 404 });

  const encoder = new TextEncoder();
  let closed = false;
  let jsonlPath: string | null = null;
  let currentSessionId = "";
  let watcher: fs.FSWatcher | null = null;

  const stream = new ReadableStream({
    start(controller) {
      function sendEvent(data: string) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      }

      function sendMessages() {
        if (!jsonlPath || closed) return;
        try {
          const messages = parseJsonlMessages(jsonlPath);
          sendEvent(
            JSON.stringify({
              messages,
              source: "jsonl",
              sessionId: currentSessionId,
            })
          );
        } catch {
          /* ignore */
        }
        // Opportunistic: each SSE tick also scans the JSONL for note-tagged
        // exchanges and persists new ones. Keeps NoteExchange rows close to
        // real-time so a later /clear or rm can't erase the record.
        extractNoteExchanges(cwd!).catch(() => { /* non-fatal */ });
      }

      function watchFile(path: string) {
        if (watcher) watcher.close();
        let debounce: ReturnType<typeof setTimeout> | null = null;
        watcher = fs.watch(path, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => sendMessages(), 300);
        });
        watcher.on("error", () => {});
      }

      async function syncResolved() {
        const resolved = await resolveChatSession(name, cwd!);
        if (!resolved) return;
        if (resolved.path !== jsonlPath) {
          jsonlPath = resolved.path;
          currentSessionId = resolved.sessionId;
          sendMessages();
          watchFile(jsonlPath);
        }
      }

      // Initial resolve
      syncResolved();

      // Re-resolve periodically — catches tmux switching to a new claude,
      // user pinning/unpinning, and new files appearing.
      const checkInterval = setInterval(() => {
        if (closed) {
          clearInterval(checkInterval);
          return;
        }
        syncResolved();
      }, 3000);

      const keepalive = setInterval(() => {
        if (closed) {
          clearInterval(keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 30000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (watcher) watcher.close();
        clearInterval(checkInterval);
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
