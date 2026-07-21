import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);

/** One machine in the tailnet, normalized from `tailscale status --json`. */
export interface TailscaleNode {
  hostname: string;    // MagicDNS first label — the ssh-able name
  displayName: string; // HostName as reported (may contain spaces / non-ASCII)
  dnsName: string;     // full MagicDNS FQDN (no trailing dot)
  ip: string;          // first IPv4 Tailscale IP
  os: string;
  online: boolean;
  isSelf: boolean;
}

// macOS App Store install doesn't symlink the CLI into PATH; probe the
// well-known locations before giving up.
const BIN_CANDIDATES = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/usr/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

let cachedBin: string | null | undefined;

export function findTailscaleBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  for (const bin of BIN_CANDIDATES) {
    if (bin === "tailscale") {
      cachedBin = bin; // resolved via PATH at exec time; verified by first call
      const paths = (process.env.PATH || "").split(":");
      if (paths.some((p) => { try { fs.statSync(`${p}/tailscale`); return true; } catch { return false; } })) {
        return bin;
      }
      cachedBin = undefined;
      continue;
    }
    try { fs.statSync(bin); cachedBin = bin; return bin; } catch { /* next */ }
  }
  cachedBin = null;
  return null;
}

interface RawNode {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  TailscaleIPs?: string[];
}

function normalize(raw: RawNode, isSelf: boolean): TailscaleNode | null {
  const dnsName = (raw.DNSName || "").replace(/\.$/, "");
  const label = dnsName.split(".")[0] || "";
  // Fallback: sanitize HostName the way MagicDNS does (rare — DNSName absent)
  const hostname = label || (raw.HostName || "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!hostname) return null;
  return {
    hostname,
    displayName: raw.HostName || hostname,
    dnsName,
    ip: (raw.TailscaleIPs || []).find((ip) => !ip.includes(":")) || "",
    os: raw.OS || "",
    online: !!raw.Online,
    isSelf,
  };
}

/** Run `tailscale status --json` and return all nodes (Self first).
 *  Throws with a human-readable message when the CLI is missing or the
 *  daemon isn't running. */
export async function getTailscaleNodes(): Promise<TailscaleNode[]> {
  const bin = findTailscaleBin();
  if (!bin) {
    throw new Error("找不到 tailscale CLI — 請先在這台主機安裝並登入 Tailscale。");
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(bin, ["status", "--json"], { timeout: 10_000 }));
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0];
    throw new Error(`tailscale status 執行失敗：${msg}`);
  }
  const data = JSON.parse(stdout) as {
    BackendState?: string;
    Self?: RawNode;
    Peer?: Record<string, RawNode>;
  };
  if (data.BackendState && data.BackendState !== "Running") {
    throw new Error(`Tailscale 未連線（狀態：${data.BackendState}）— 請先在主機上 tailscale up。`);
  }
  const nodes: TailscaleNode[] = [];
  const self = data.Self ? normalize(data.Self, true) : null;
  if (self) nodes.push(self);
  for (const peer of Object.values(data.Peer || {})) {
    const n = normalize(peer, false);
    if (n) nodes.push(n);
  }
  return nodes;
}

/** Best-effort local hostname for the badge when Tailscale is unavailable. */
export function osHostname(): string {
  return os.hostname().split(".")[0];
}
