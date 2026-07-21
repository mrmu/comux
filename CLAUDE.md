# comux

AI-Ops development platform — web-based tmux session manager with Claude Code integration.

## Repository

GitHub: `git@github.com:mrmu/comux.git`

## Architecture

```
Host (Linux VPS / macOS)
├── tmux server              ← session 持久化
├── Claude Code CLI          ← 已安裝、已認證 (Max Plan)
├── comux (Next.js + WS)    ← Node 直接跑在 host (systemd in prod, `npm run dev` in dev)
├── {projectsRoot}/          ← 所有專案目錄 (DB 設定)
└── ~/.claude/               ← Claude Code 認證 + 設定

Docker (只跑輔助服務)
├── PostgreSQL               ← 專案 metadata、用戶帳號、settings
└── comux-proxy (socat)     ← 註冊 VIRTUAL_HOST 給 nginx-proxy，轉發到 host:3000
                               (讓 acme-companion 自動簽 Let's Encrypt 憑證)
```

- comux 本體**不跑在容器裡** — host 直接跑 Node，這樣才能直接存取 tmux socket、
  Claude Code 認證、SSH keys、`~/.claude/` 等檔案。早期把 comux 塞容器再用
  `pid: host` + UID/GID override + home mount 假冒 host user 的做法已棄用。
- Docker 只負責 DB 和一個薄 socat proxy 讓 nginx-proxy-automation 能掃到
  `VIRTUAL_HOST` / `LETSENCRYPT_HOST` 自動簽憑證。

## Tech Stack

- **Framework**: Next.js 16 (App Router, standalone output)
- **Database**: PostgreSQL via Prisma 7
- **Auth**: Email + password (bcrypt + JWT), admin-only registration
- **Terminal**: xterm.js + WebSocket + node-pty → tmux attach-session (PTY)
- **Chat**: SSE (fs.watch JSONL) + fetch (initial load)
- **DNS**: Cloudflare API (CF_API_TOKEN + CF_ZONE_ID)
- **UI**: Custom CSS (mobile-first, no framework)

## 本機開發 (macOS)

```bash
# Prerequisites
brew install tmux
npm install -g @anthropic-ai/claude-code

# 啟動 DB + nginx-proxy 轉發
docker compose up -d db dev-proxy

# 啟動 dev server (Next.js + terminal WS)
npm run dev

# 開啟 http://comux.test
# 首次使用會要求建立 admin 帳號 + 設定專案目錄
```

- `npm run dev` 跑兩個進程：Next.js (port 3000) + terminal WebSocket (port 3001)
- `dev-proxy` (socat) 讓 nginx-proxy 把 comux.test 轉到 host 的 port 3000

## Production 部署

**部署方式與完整步驟請見 [`docs/deploy/setup.md`](docs/deploy/setup.md)**。
摘要：Node 直接跑在宿主機（systemd 管理），Docker 只跑 DB + socat proxy，
nginx-proxy-automation 透過 socat 容器的 `VIRTUAL_HOST` 自動簽 Let's Encrypt。

### 正式機清單

| 用途 | 網址 | SSH |
|------|------|-----|
| 個人專案 | https://comux.audilu.com | `devops@linode-audi-inv` (Tailscale，需要時 `sudo su` 切 root) |
| 泛科專案 | — | 尚未完成設定 |

## Commands

```bash
npm run dev          # Dev: Next.js + WS server (host tmux)
npm run build        # Production build (prisma generate + next build)
npm start            # Local prod-mode smoke test (tsx server.ts) — 正式機用 prod-server.js + systemd
npm run db:push      # Push schema to DB
npm run db:migrate   # Run migrations
```

## Project Structure

```
src/
  app/              # Next.js App Router
    api/            # REST API routes
      auth/         # login, register, logout, password, users
      sessions/     # CRUD, chat, chat-stream (SSE), files, hosts, windows
      dns/          # Cloudflare DNS management
      config/       # Frontend config (projectsRoot)
      settings/     # DB-backed settings CRUD
  components/       # React client components
  lib/              # Server utilities
    tmux.ts         # tmux command adapter
    auth.ts         # JWT + bcrypt auth
    settings.ts     # DB settings (projectsRoot, etc.)
    cloudflare.ts   # Cloudflare DNS API
    validate.ts     # Input validation (session name, cwd, command)
    jsonl-parser.ts # Claude Code JSONL conversation parser
    project-cwd.ts  # Get project working directory from DB
  generated/        # Prisma client (auto-generated)
prisma/             # DB schema
server.ts           # Dev custom server (unused, kept for reference)
ws-server.ts        # WebSocket terminal (shared dev/prod)
ws-dev-server.ts    # Dev: standalone WS server on port 3001
prod-server.js      # Production: standalone Next.js + WS
docs/deploy/        # Deployment guide
```

## DB Schema

- **User**: email (unique), password (bcrypt), name
- **Setting**: key-value store (projectsRoot, etc.)
- **Project**: name, displayName, color, cwd, command, jsonlSessionId
- **Machine**: Tailscale 站點註冊表 — hostname (MagicDNS label, unique), sshUser, online, isSelf (comux 主開發機), source (tailscale/manual)。同步 (`tailscale status --json`) 只更新已納管站點＋self；tailnet 其他機器需在 Machines 頁勾選「納管」才會入庫（共用 tailnet 時避免公司 comux 看見個人站點）
- **Host**: projectName → machineId (FK → Machine) + path (該站點上的專案目錄) + deployType (ssh/cloud-run), env (production/staging/development)；sshTarget 為舊制手填欄位，machineId 存在時以 Machine 為準
- **Note**: sessionName → content (一對多)

## Security

- Session name 驗證: `/^[a-zA-Z0-9_-]+$/`，tmux `-t =name` 強制精確匹配
- CWD 限制在 projectsRoot (DB setting) 內
- Command 驗證：拒絕 shell metacharacters
- WebSocket origin allowlist (ALLOWED_ORIGINS env)
- Login rate limit (5/min per IP)
- Cookie: httpOnly + sameSite:strict + secure (prod)
- 首個用戶自助註冊，之後只能管理員建帳號
- Restore 不自動執行 DB 中的 command

## 每次修改都要先測試，前後端都要，然後確認功能正常。

## Project Settings (managed by comux)

Project-level configuration lives in [`.comux/`](.comux/).
**Before deploying, testing, or reasoning about hosts, re-read these
files** — they may have been updated via the comux UI since you last
loaded them. Do not rely on earlier snapshots.

- [`.comux/project.md`](.comux/project.md) — project overview (auto)
- [`.comux/hosts.md`](.comux/hosts.md) — deployment hosts (auto)
- [`.comux/deploy.md`](.comux/deploy.md) — deployment steps
- [`.comux/test.md`](.comux/test.md) — test checklist; walk every item and mark a deploy green only when all pass
