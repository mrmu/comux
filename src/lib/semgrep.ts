import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const execFileAsync = promisify(execFile);

// Runs semgrep in a throwaway Docker container against the given cwd, writes
// SARIF output to disk (audit evidence), and returns parsed findings.
//
// Ruleset choice: `p/default` is Semgrep Community's general-purpose pack —
// auto-selects rules by detected language, ~1000 rules covering OWASP Top 10.
// We avoid `--config=auto` because it mandates telemetry (metrics=on), which
// is bad for ISO scans where reproducibility + no-external-comms matters.

export const SEMGREP_IMAGE = "semgrep/semgrep:latest";
export const SEMGREP_CONFIG = "p/default";
export const SCAN_ROOT = path.join(
  process.env.HOME || os.homedir(),
  "comux-scans"
);

export interface RawFinding {
  ruleId: string;
  message: string;
  filePath: string;          // relative to project cwd
  line: number;
  endLine: number;
  severity: string;           // CRITICAL / HIGH / MEDIUM / LOW / INFO
  cwe: string;
  owasp: string;
  cvss: number | null;
  fingerprint: string;        // our own stable hash (semgrep's is "requires login" on OSS)
}

export interface ScanResult {
  success: boolean;
  errorMessage: string;
  toolVersion: string;
  sarifPath: string;
  findings: RawFinding[];
  summary: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    INFO: number;
  };
}

// Map Semgrep's severity/CVSS to our 5-level scale.
// Prefer CVSS security-severity if rule provides it (more precise than the
// 3-level ERROR/WARNING/INFO). Fallback to SARIF `level`.
function classifySeverity(sarifLevel: string, cvss: number | null): string {
  if (cvss !== null) {
    if (cvss >= 9.0) return "CRITICAL";
    if (cvss >= 7.0) return "HIGH";
    if (cvss >= 4.0) return "MEDIUM";
    if (cvss > 0) return "LOW";
  }
  switch (sarifLevel) {
    case "error":
      return "HIGH";
    case "warning":
      return "MEDIUM";
    case "note":
      return "LOW";
    default:
      return "INFO";
  }
}

function computeFingerprint(
  ruleId: string,
  filePath: string,
  line: number,
  snippet: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${ruleId}|${filePath}|${line}|${snippet.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

// Parse SARIF v2.1 emitted by Semgrep into our RawFinding shape. The key
// fields live under result.properties and result.rule (per-run descriptor).
function parseSarif(sarif: unknown, projectCwd: string): RawFinding[] {
  const findings: RawFinding[] = [];
  const doc = sarif as {
    runs?: Array<{
      tool?: { driver?: { rules?: Array<Record<string, unknown>> } };
      results?: Array<Record<string, unknown>>;
    }>;
  };
  const run = doc.runs?.[0];
  if (!run) return findings;

  // Build rule metadata index so we can look up CWE / OWASP / security-severity
  // per rule — semgrep inlines these on some results, not others.
  const ruleMeta = new Map<string, Record<string, unknown>>();
  for (const rule of run.tool?.driver?.rules || []) {
    const rid = rule.id as string;
    if (rid) ruleMeta.set(rid, rule);
  }

  for (const result of run.results || []) {
    const ruleId = (result.ruleId as string) || "";
    const message = ((result.message as { text?: string })?.text || "").trim();
    // SARIF emitted by semgrep p/default puts the level on the RULE's
    // defaultConfiguration, not on each result. Fall through rule → result.
    let level = (result.level as string) || "";

    const loc = (result.locations as Array<Record<string, unknown>>)?.[0];
    const phys = loc?.physicalLocation as Record<string, unknown> | undefined;
    const art = phys?.artifactLocation as { uri?: string } | undefined;
    const region = phys?.region as
      | { startLine?: number; endLine?: number; snippet?: { text?: string } }
      | undefined;
    let filePath = art?.uri || "";
    // semgrep emits "/src/..." when running inside the container; strip the mount prefix
    if (filePath.startsWith("/src/")) filePath = filePath.slice(5);
    if (filePath.startsWith("file:///src/")) filePath = filePath.slice(12);

    const line = region?.startLine || 0;
    const endLine = region?.endLine || line;
    const snippet = region?.snippet?.text || "";

    const props = (result.properties as Record<string, unknown>) || {};
    const rule = ruleMeta.get(ruleId);
    const ruleProps =
      (rule?.properties as Record<string, unknown>) || {};

    if (!level) {
      const cfg = rule?.defaultConfiguration as { level?: string } | undefined;
      level = cfg?.level || "";
    }

    const cvssRaw =
      props["security-severity"] ||
      ruleProps["security-severity"];
    const cvss =
      typeof cvssRaw === "string"
        ? parseFloat(cvssRaw)
        : (cvssRaw as number | undefined) ?? null;
    const validCvss = typeof cvss === "number" && !isNaN(cvss) ? cvss : null;

    // Semgrep encodes CWE/OWASP inside rule.properties.tags as strings:
    //   "CWE-95: Improper Neutralization..."
    //   "OWASP-A03:2021 - Injection"
    const tags = (ruleProps.tags as string[]) || [];
    let cwe = "";
    let owasp = "";
    for (const tag of tags) {
      if (!cwe && tag.startsWith("CWE-")) cwe = tag;
      if (!owasp && tag.startsWith("OWASP-")) owasp = tag;
    }

    const severity = classifySeverity(level, validCvss);
    const fingerprint = computeFingerprint(ruleId, filePath, line, snippet);

    findings.push({
      ruleId,
      message,
      filePath,
      line,
      endLine,
      severity,
      cwe,
      owasp,
      cvss: validCvss,
      fingerprint,
    });
    // Silence unused-variable linter for projectCwd — reserved for future path normalization.
    void projectCwd;
  }
  return findings;
}

export async function runSemgrep(
  projectCwd: string,
  scanId: number
): Promise<ScanResult> {
  const result: ScanResult = {
    success: false,
    errorMessage: "",
    toolVersion: "",
    sarifPath: "",
    findings: [],
    summary: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
  };

  if (!fs.existsSync(projectCwd)) {
    result.errorMessage = "project cwd does not exist";
    return result;
  }

  // Ensure persistent scan output dir exists — SARIF files are audit evidence
  // and must be kept, not written to /tmp.
  try {
    fs.mkdirSync(SCAN_ROOT, { recursive: true });
  } catch {
    /* ignore */
  }
  const sarifPath = path.join(SCAN_ROOT, `scan-${scanId}.sarif`);
  result.sarifPath = sarifPath;

  // Run semgrep via docker — no host install needed, same environment dev/prod.
  // Mounts:
  //   /src  = project cwd (read-only, source code)
  //   /out  = SARIF output directory (read-write)
  const outDir = path.dirname(sarifPath);
  const args = [
    "run",
    "--rm",
    "-v",
    `${projectCwd}:/src:ro`,
    "-v",
    `${outDir}:/out`,
    SEMGREP_IMAGE,
    "semgrep",
    `--config=${SEMGREP_CONFIG}`,
    "--sarif",
    `--output=/out/${path.basename(sarifPath)}`,
    "--metrics=off",
    "--timeout=60",           // per-rule timeout
    "--timeout-threshold=3",  // skip rule after 3 timeouts
    "--exclude=node_modules",
    "--exclude=.next",
    "--exclude=dist",
    "--exclude=build",
    "--exclude=.git",
    "/src",
  ];

  try {
    // maxBuffer set high because SARIF output can be large on first scan.
    const { stdout } = await execFileAsync("docker", args, {
      timeout: 15 * 60 * 1000, // 15 min absolute cap
      maxBuffer: 50 * 1024 * 1024,
    });
    // Pull semgrep version from first stdout line where it logs it, else query image.
    void stdout;
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string; message?: string };
    // Semgrep returns non-zero when findings exist; that's NOT a failure.
    // It only truly failed if SARIF wasn't written.
    if (!fs.existsSync(sarifPath)) {
      result.errorMessage = (e.stderr || e.message || "semgrep failed").slice(0, 500);
      return result;
    }
  }

  if (!fs.existsSync(sarifPath)) {
    result.errorMessage = "semgrep produced no SARIF output";
    return result;
  }

  let sarif: unknown;
  try {
    sarif = JSON.parse(fs.readFileSync(sarifPath, "utf-8"));
  } catch (e) {
    result.errorMessage = `failed to parse SARIF: ${(e as Error).message}`;
    return result;
  }

  result.findings = parseSarif(sarif, projectCwd);
  for (const f of result.findings) {
    if (f.severity in result.summary) {
      result.summary[f.severity as keyof typeof result.summary] += 1;
    }
  }
  result.success = true;

  // Capture tool version once for audit record.
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["run", "--rm", SEMGREP_IMAGE, "semgrep", "--version"],
      { timeout: 30_000 }
    );
    result.toolVersion = stdout.trim().split("\n")[0] || "";
  } catch {
    /* non-critical */
  }

  return result;
}

export async function getCurrentCommitSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
