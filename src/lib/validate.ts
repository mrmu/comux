import path from "path";

/** Validate session/project name — alphanumeric, dash, underscore only */
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidSessionName(name: string): boolean {
  return name.length > 0 && name.length <= 100 && SAFE_NAME_RE.test(name);
}

/** Validate cwd is within any of the given roots (variadic for the common
 *  case of `[projectsRoot, comuxSelfRoot]`). The self-root exception lets
 *  the comux project manage itself even when the source dir lives outside
 *  PROJECTS_ROOT — without it, you can't bootstrap comux on a new host. */
export function isValidCwd(cwd: string, ...roots: string[]): boolean {
  const resolved = path.resolve(cwd);
  return roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

/** Hostname / MagicDNS label / FQDN — safe to pass to ssh as a target.
 *  No leading dash so it can never be mistaken for an ssh option. */
const HOSTNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isValidHostname(hostname: string): boolean {
  return hostname.length > 0 && hostname.length <= 253 && HOSTNAME_RE.test(hostname);
}

/** Unix login name for `user@host` ssh targets. */
const SSH_USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isValidSshUser(user: string): boolean {
  return user.length > 0 && user.length <= 64 && SSH_USER_RE.test(user);
}

/** Remote project path written into .comux/hosts.md — absolute, no shell
 *  metacharacters or traversal (agents will paste it after `cd`). */
export function isValidRemotePath(p: string): boolean {
  if (!p || p.length > 300) return false;
  if (!p.startsWith("/") && !p.startsWith("~")) return false;
  return !/[|;&`$(){}<>"'\\\n]/.test(p) && !/\.\.\//.test(p);
}

/** Validate command — no shell metacharacters, reasonable length */
const DANGEROUS_PATTERNS = [
  /[|;&`$(){}]/,     // shell operators
  /\.\.\//,          // path traversal
  /curl.*\|/i,       // pipe from curl
  /wget.*\|/i,
];

export function isValidCommand(command: string): boolean {
  if (!command || command.length > 200) return false;
  return !DANGEROUS_PATTERNS.some((p) => p.test(command));
}
