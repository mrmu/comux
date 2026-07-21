import fs from "fs";
import path from "path";

const RE_ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g;
const CLAUDE_DIR = path.join(process.env.HOME || "/Users/audilu", ".claude");
const CLAUDE_PROJECTS = path.join(CLAUDE_DIR, "projects");
const MAX_SUMMARY = 200;

const SKIP_TYPES = new Set([
  "summary",
  "file-history-snapshot",
  "progress",
  "system",
  "lock",
  "result",
]);

export interface ChatMessage {
  role: string;
  content_type: string;
  text: string;
  tool_name?: string;
  result?: string | null;
  detail?: string | null;
  is_error?: boolean;
}

/**
 * Get the JSONL project directory for a given cwd.
 * Claude Code encodes: /Users/foo/bar → -Users-foo-bar
 */
function getProjectDir(projectCwd: string): string | null {
  const encodedCwd = projectCwd.replace(/[^a-zA-Z0-9-]/g, "-");
  const projectDir = path.join(CLAUDE_PROJECTS, encodedCwd);
  return fs.existsSync(projectDir) ? projectDir : null;
}

/**
 * Find the JSONL file for a specific session ID.
 */
export function findSessionJsonlById(
  projectCwd: string,
  sessionId: string
): string | null {
  if (!projectCwd || !sessionId) return null;
  const dir = getProjectDir(projectCwd);
  if (!dir) return null;
  const filePath = path.join(dir, `${sessionId}.jsonl`);
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Read the last user or assistant text line from a JSONL, trimmed to `max`
 * characters. Used to give each session in the picker a recognizable preview.
 * Reads only the tail of the file for speed.
 */
export function getSessionPreview(filePath: string, max = 80): string {
  try {
    const stat = fs.statSync(filePath);
    // Read up to 200KB from the tail — tool-heavy sessions can have tens of KB
    // between consecutive user/assistant text blocks.
    const readBytes = Math.min(stat.size, 200_000);
    const buf = Buffer.alloc(readBytes);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, readBytes, stat.size - readBytes);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8").split("\n").filter(Boolean);
    // Walk backwards looking for a user or assistant text message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type !== "user" && entry.type !== "assistant") continue;
        const content = entry.message?.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block && typeof block === "object" && block.type === "text" && block.text) {
              text = block.text;
              break;
            }
          }
        }
        text = text.replace(RE_ANSI, "").replace(/\s+/g, " ").trim();
        // Skip system-reminder wrapped text
        if (/<(system-reminder|local-command|command-name|bash-input)/.test(text)) continue;
        if (!text) continue;
        return text.length > max ? text.slice(0, max) + "…" : text;
      } catch {
        continue;
      }
    }
  } catch {
    /* unreadable */
  }
  return "";
}

/**
 * List all JSONL sessions for a project, sorted by most recent.
 */
export function listSessionJsonls(
  projectCwd: string
): { sessionId: string; path: string; mtime: number }[] {
  if (!projectCwd) return [];
  const dir = getProjectDir(projectCwd);
  if (!dir) return [];

  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        sessionId: f.replace(".jsonl", ""),
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

function formatToolSummary(
  name: string,
  inputData: Record<string, unknown>
): string {
  if (typeof inputData !== "object" || !inputData) return name;

  let summary = "";
  const get = (key: string) => (inputData[key] as string) || "";

  switch (name) {
    case "Read":
    case "Glob":
      summary = get("file_path") || get("pattern");
      break;
    case "Write":
      summary = get("file_path");
      break;
    case "Edit":
    case "NotebookEdit":
      summary = get("file_path") || get("notebook_path");
      break;
    case "Bash":
      summary = get("command");
      break;
    case "Grep":
      summary = get("pattern");
      break;
    case "Task":
      summary = get("description");
      break;
    case "WebFetch":
      summary = get("url");
      break;
    case "WebSearch":
      summary = get("query");
      break;
    case "Skill":
      summary = get("skill");
      break;
    default:
      for (const v of Object.values(inputData)) {
        if (typeof v === "string" && v) {
          summary = v;
          break;
        }
      }
  }

  if (summary) {
    if (summary.length > MAX_SUMMARY) summary = summary.slice(0, MAX_SUMMARY) + "...";
    return `${name}(${summary})`;
  }
  return name;
}

function formatResultStats(text: string, toolName: string | null): string {
  if (!text) return "";
  const lineCount = text.split("\n").length;

  switch (toolName) {
    case "Read":
      return `Read ${lineCount} lines`;
    case "Write":
      return `Wrote ${lineCount} lines`;
    case "Bash":
      return `Output ${lineCount} lines`;
    case "Grep":
      return `Found ${text.split("\n").filter((l) => l.trim()).length} matches`;
    case "Glob":
      return `Found ${text.split("\n").filter((l) => l.trim()).length} files`;
    case "Task":
      return `Agent output ${lineCount} lines`;
    case "WebFetch":
      return `Fetched ${text.length} chars`;
    case "WebSearch":
      return `${(text.match(/\n\n/g) || []).length + 1} search results`;
    case "Edit":
      return "Edited successfully";
    default:
      return `${lineCount} lines`;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && item.type === "text")
          return item.text || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function parseJsonlMessages(
  filePath: string,
  maxMessages = 100
): ChatMessage[] {
  let data: string;
  try {
    // Read only the tail of large files for performance
    const stat = fs.statSync(filePath);
    const TAIL_BYTES = 5_000_000; // 5MB — tool-heavy sessions can have huge entries
    if (stat.size > TAIL_BYTES) {
      const buf = Buffer.alloc(TAIL_BYTES);
      const fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
      fs.closeSync(fd);
      data = buf.toString("utf-8");
      // Skip first partial line
      const firstNewline = data.indexOf("\n");
      if (firstNewline > 0) data = data.slice(firstNewline + 1);
    } else {
      data = fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    return [];
  }

  const entries: Array<Record<string, unknown>> = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }

  const messages: ChatMessage[] = [];
  const pendingTools: Map<
    string,
    { toolName: string; msgIndex: number }
  > = new Map();

  for (const entry of entries) {
    const msgType = entry.type as string;
    if (SKIP_TYPES.has(msgType) || !["user", "assistant"].includes(msgType))
      continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") continue;

    let content = message.content as Array<Record<string, unknown>>;
    if (!Array.isArray(content)) {
      content = content
        ? [{ type: "text", text: String(content) }]
        : [];
    }

    if (msgType === "assistant") {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const btype = block.type as string;

        if (btype === "text") {
          let text = ((block.text as string) || "").trim();
          if (text && text !== "(no content)") {
            text = text.replace(RE_ANSI, "");
            messages.push({ role: "assistant", content_type: "text", text });
          }
        } else if (btype === "tool_use") {
          const toolId = block.id as string;
          const name = (block.name as string) || "unknown";
          const inp = (block.input as Record<string, unknown>) || {};
          const summary = formatToolSummary(name, inp);

          const msg: ChatMessage = {
            role: "assistant",
            content_type: "tool",
            text: summary,
            tool_name: name,
            result: null,
            detail: null,
            is_error: false,
          };
          messages.push(msg);

          if (toolId) {
            pendingTools.set(toolId, {
              toolName: name,
              msgIndex: messages.length - 1,
            });
          }
        } else if (btype === "thinking") {
          const thinkingText = block.thinking as string;
          if (thinkingText) {
            messages.push({
              role: "assistant",
              content_type: "thinking",
              text: thinkingText,
            });
          }
        }
      }
    } else if (msgType === "user") {
      const userTextParts: string[] = [];

      for (const block of content) {
        if (!block || typeof block !== "object") {
          if (typeof block === "string" && (block as string).trim()) {
            userTextParts.push((block as string).trim());
          }
          continue;
        }
        const btype = block.type as string;

        if (btype === "tool_result") {
          const toolUseId = block.tool_use_id as string;
          const resultContent = block.content;
          let resultText = extractText(resultContent).replace(RE_ANSI, "");
          const isError = block.is_error as boolean;

          const toolInfo = pendingTools.get(toolUseId);
          if (toolInfo) pendingTools.delete(toolUseId);
          const toolName = toolInfo?.toolName || null;

          let stats: string;
          if (isError) {
            const errorLine = resultText
              ? resultText.split("\n")[0].slice(0, 100)
              : "Error";
            stats = `Error: ${errorLine}`;
          } else {
            stats = formatResultStats(resultText, toolName);
          }

          if (toolInfo && toolInfo.msgIndex < messages.length) {
            const target = messages[toolInfo.msgIndex];
            target.result = stats;
            target.detail = resultText || null;
            target.is_error = isError;
          }
        } else if (btype === "text") {
          const t = ((block.text as string) || "").trim();
          if (
            t &&
            !/(<(bash-input|bash-stdout|bash-stderr|local-command|system-reminder|command-name))/.test(
              t
            )
          ) {
            userTextParts.push(t);
          }
        }
      }

      if (userTextParts.length) {
        const combined = userTextParts.join("\n");
        if (!/<(local-command-stdout|command-name)/.test(combined)) {
          messages.push({
            role: "user",
            content_type: "text",
            text: combined.replace(RE_ANSI, ""),
          });
        }
      }
    }
  }

  // Return only the most recent messages for performance
  if (messages.length > maxMessages) {
    return messages.slice(-maxMessages);
  }
  return messages;
}
