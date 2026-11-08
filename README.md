<p align="center">
  <img src="public/logo-full.png" alt="comux" width="320" />
</p>

<p align="center">
  <strong>給 CLI AI coding agent 用的網頁版 tmux session 管理工具</strong>
</p>

<p align="center">
  用手機或電腦瀏覽器同時管理多個 AI 輔助開發的專案<br />
  <sub>相容 Claude Code、OpenAI Codex、Gemini CLI 等跑在 tmux 裡的 CLI agent</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/tmux-via%20node--pty-1bb91f?logo=tmux&logoColor=white" alt="tmux" />
</p>

---

## 能做什麼

- **Terminal** — xterm.js 透過 PTY 接宿主機的 tmux（真的終端機，不是模擬）
- **Chat** — 解析 agent 的對話記錄並以 SSE 即時推播（目前支援 Claude Code JSONL；Codex、Gemini CLI 規劃中）
- **Files** — 瀏覽、編輯專案檔案
- **Projects** — 一個專案對應一個 tmux session，session 裡可以開多個 window
- **Hosts** — 記錄每個專案的部署目標（SSH / Tailscale 機器）
- **DNS** — 透過 Cloudflare API 管理 DNS 記錄
- **Auth** — email + 密碼登入（bcrypt + JWT），註冊只開給管理員

## 架構（白話版）

comux 是一個「半容器化」的架構：

```
                                         宿主機 (Linux VPS)
                                         ┌──────────────────────────────┐
 瀏覽器（已登入 Tailscale 的裝置）        │  Tailscale Serve (HTTPS:443)  │
   └─ https://your-host.your-tailnet ───▶│        │                      │
          .ts.net（只有 tailnet 連得到）  │        ▼                      │
                                         │  comux (Node, 127.0.0.1:3000)│
                                         │  ├─ Next.js + API            │
                                         │  ├─ Terminal WebSocket       │
                                         │  └─ 讀寫 tmux / agent / ssh   │
                                         │                              │
                                         │  tmux + AI agent CLI         │
                                         │  (以部署帳號身份跑)            │
                                         │                              │
                                         │  ┌─────────────────────┐     │
                                         │  │ PostgreSQL 容器      │     │
                                         │  │ (5432 只開 local)    │     │
                                         │  └─────────────────────┘     │
                                         └──────────────────────────────┘
```

**重點：**

- comux 本體（Next.js + WebSocket）**直接跑在宿主機，只聽 `127.0.0.1:3000`**，**沒有容器化**，用 systemd 管理。
- 對外由 **Tailscale Serve** 提供 HTTPS（`tailscale serve --bg --https=443 http://127.0.0.1:3000`），只有 tailnet 內的裝置連得到，公網完全看不到。
- comux 等於這台主機的**網頁 shell**，所以不建議再用 nginx-proxy + socat 開到公網（舊做法保留在部署文件附錄，標為不建議）。
- PostgreSQL 是容器跑，port 5432 只綁 `127.0.0.1`，不對外開放。
- 因為 comux 直接在宿主機上用部署帳號身份執行，所以**天生就能用宿主機的 AI agent CLI、SSH keys、tmux socket、和 agent 的 config/認證目錄**（`~/.claude/`、`~/.codex/`、`~/.gemini/` 等）— 不需要做 UID mapping、pid:host、home mount 這些脆弱的容器 hack。

（為什麼不全容器化：早期版本有做過 `pid: host` + UID/GID mount + `~/` mount 去假冒 host user，結果 agent CLI 一更新或路徑一變就壞掉，改回直接跑 host 穩定得多。）

## 快速開始

### 正式機部署（Linux）

詳細步驟見 [`docs/deploy/setup.md`](docs/deploy/setup.md)。摘要：

```bash
# 前置：Node 22、tmux、git、docker、tailscale 都裝好；要用的 AI agent CLI (Claude Code / Codex / Gemini CLI / ...) 已登入認證
git clone git@github.com:mrmu/comux.git ~/comux && cd ~/comux

# 設定環境變數（DATABASE_URL、COMUX_SECRET、ALLOWED_ORIGINS 等）
# COMUX_SECRET 必填：openssl rand -hex 32（未設 / 太短 / 預設值 → 伺服器拒絕啟動）
cp .env.example .env && nano .env

# Build + 起 DB
npm ci && npm run build
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d db
npm run db:deploy   # prisma migrate deploy

# 用 systemd 管 comux 本體（只聽 127.0.0.1:3000）
sudo cp docs/deploy/comux.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now comux

# 用 Tailscale Serve 在 tailnet 內提供 HTTPS
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000

# 用 tailnet 內的裝置開 https://your-host.your-tailnet.ts.net，第一次會請你建 admin 帳號
# （需輸入 comux 啟動時印在 log 的 setup token：sudo journalctl -u comux | grep -A3 "setup token"）
```

### 更新

```bash
cd ~/comux && git pull && npm ci && npm run build && npm run db:deploy
sudo systemctl restart comux
# 舊版（用 db:push 建的 DB）第一次升級前先跑一次：npx prisma migrate resolve --applied 0_init
# tmux session 不受影響（它是獨立 daemon）
```

### 本機開發（macOS）

```bash
cp .env.example .env
# 本機也要設 COMUX_SECRET（未設或用預設值時 dev server 會拒絕啟動）
echo "COMUX_SECRET=$(openssl rand -hex 32)" >> .env   # 或手動填進 .env 裡空著的那行

docker compose up -d db dev-proxy   # DB + nginx-proxy 轉發橋接
npm run dev                         # http://comux.test
```

`npm run dev` 同時跑 Next.js（port 3000）+ Terminal WebSocket（port 3001）。

## 主要檔案

| 檔案 | 用途 |
|------|------|
| `prod-server.js` | 正式機入口：Next.js + WebSocket 合併在 port 3000 |
| `server.ts` | Dev 用的 Next.js + WebSocket 客製伺服器 |
| `ws-server.ts` | Terminal WebSocket 實作（PTY → `tmux attach-session`） |
| `docker-compose.production.yml` | 正式機：只起 DB（socat 公網 proxy 預設停用、不建議），app 停用 |
| `docs/deploy/comux.service` | systemd unit file（跑 `node prod-server.js`） |
| `docs/deploy/setup.md` | 完整部署指南 |
| `src/lib/tmux.ts` | tmux 指令封裝 |
| `src/lib/cloudflare.ts` | Cloudflare DNS API |
| `src/lib/auth.ts` | email + 密碼登入（bcrypt + JWT） |
| `src/lib/settings.ts` | DB 裡的鍵值設定（projectsRoot 等） |
