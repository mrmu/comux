import fs from "fs";
import path from "path";
import os from "os";

// 預設讀環境變數，沒有就用執行 comux 的帳號家目錄（不要寫死任何實際帳號路徑）
const HOST_HOME = process.env.HOST_HOME || process.env.HOME || os.homedir();
const SESSION_MAP_PATH = path.join(HOST_HOME, ".ccbot", "session_map.json");
const MAX_FILE_SIZE = 1_048_576; // 1 MB

const HIDDEN_NAMES = new Set([
  ".git", ".env", ".env.local", ".env.production",
  "node_modules", "__pycache__", ".venv", "venv",
  ".mypy_cache", ".pytest_cache", ".ruff_cache",
  ".DS_Store", ".idea", ".vscode",
  ".next", ".nuxt", "dist", "build",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".mp3", ".mp4", ".wav", ".avi", ".mkv", ".mov",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pyc", ".pyo", ".class",
  ".db", ".sqlite", ".sqlite3",
]);

export function getSessionCwd(tmuxSessionName: string): string | null {
  if (!fs.existsSync(SESSION_MAP_PATH)) return null;

  let sessionMap: Record<string, { cwd?: string }>;
  try {
    sessionMap = JSON.parse(fs.readFileSync(SESSION_MAP_PATH, "utf-8"));
  } catch {
    return null;
  }

  let bestCwd: string | null = null;
  for (const [key, info] of Object.entries(sessionMap)) {
    if (key.startsWith(`${tmuxSessionName}:`)) {
      if (info.cwd) bestCwd = info.cwd;
    }
  }
  return bestCwd;
}

function safeResolve(baseDir: string, relPath: string): string | null {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, relPath);
  if (!target.startsWith(base + path.sep) && target !== base) return null;
  return target;
}

export interface FileEntry {
  name: string;
  type: "dir" | "file";
  size: number;
}

export function listDirectory(baseDir: string, relPath = "."): FileEntry[] {
  const target = safeResolve(baseDir, relPath);
  if (!target) return [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const entries: FileEntry[] = [];
  try {
    for (const name of fs.readdirSync(target)) {
      if (HIDDEN_NAMES.has(name)) continue;
      try {
        const st = fs.statSync(path.join(target, name));
        if (st.isDirectory()) {
          entries.push({ name, type: "dir", size: 0 });
        } else if (st.isFile()) {
          entries.push({ name, type: "file", size: st.size });
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return entries;
}

export function readFile(
  baseDir: string,
  relPath: string
): { content: string; size: number; encoding: string } {
  const target = safeResolve(baseDir, relPath);
  if (!target) throw new Error("Invalid path");

  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error(`File not found: ${relPath}`);
  }
  if (!stat.isFile()) throw new Error(`File not found: ${relPath}`);
  if (stat.size > MAX_FILE_SIZE)
    throw new Error(`File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);

  const ext = path.extname(target).toLowerCase();
  if (BINARY_EXTS.has(ext))
    throw new Error(`Binary file not supported: ${ext}`);

  const content = fs.readFileSync(target, "utf-8");
  return { content, size: stat.size, encoding: "utf-8" };
}

export function writeFile(
  baseDir: string,
  relPath: string,
  content: string
): { ok: boolean; size: number } {
  const target = safeResolve(baseDir, relPath);
  if (!target) throw new Error("Invalid path");

  try {
    if (fs.statSync(target).isDirectory())
      throw new Error("Cannot write to a directory");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const encoded = Buffer.from(content, "utf-8");
  if (encoded.length > MAX_FILE_SIZE)
    throw new Error(
      `Content too large: ${encoded.length} bytes (max ${MAX_FILE_SIZE})`
    );

  const parentDir = path.dirname(target);
  if (!fs.existsSync(parentDir))
    throw new Error("Parent directory does not exist");

  fs.writeFileSync(target, encoded);
  return { ok: true, size: encoded.length };
}
