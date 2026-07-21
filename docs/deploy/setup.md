# comux 部署指南

## 架構

```
Linux Host (VPS)
├── dev user (e.g. devops)
│   ├── tmux server          ← session 持久化
│   ├── Claude Code CLI      ← Max Plan 登入
│   ├── Node.js + comux      ← systemd 管理，佔 port 3000
│   └── ~/.claude/           ← 認證 + 設定
│
└── Docker
    ├── PostgreSQL           ← 專案 metadata + 用戶帳號
    └── comux-proxy          ← socat: wp-proxy network → host:3000
                               (讓 nginx-proxy + acme-companion 看到
                                VIRTUAL_HOST / LETSENCRYPT_HOST 自動簽憑證)
```

comux 本身**不跑在容器裡** — 直接在宿主機用 `systemd` 管理。
容器版本的舊部署因為要假冒 host user (UID/GID mount + pid:host + home mount)
太脆弱，Claude Code 或路徑變動容易整個壞掉，所以全砍。

Docker 只剩兩件事：

1. 跑 PostgreSQL
2. 提供一個薄薄的 socat 容器註冊 `VIRTUAL_HOST` 給 nginx-proxy，讓 SSL 自動續

---

## 1. 建立 dev user

```bash
sudo adduser devops
sudo usermod -aG docker devops
id devops   # 記下 uid/gid
```

## 2. 安裝宿主機工具

以 dev user 登入：

```bash
su - devops

# Node.js 22 (comux + Claude Code 共用)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# tmux + git
sudo apt install -y tmux git

# Claude Code
npm install -g @anthropic-ai/claude-code
claude   # 首次 OAuth 登入 (Max Plan)
claude --version
tmux -V
```

## 3. Tailscale（選用）

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

## 4. 拉 comux + build

```bash
cd ~
git clone git@github.com:mrmu/comux.git
cd comux

# 先產生兩個 secret，再寫進 .env (DATABASE_URL 和 POSTGRES_PASSWORD 必須同一個密碼)
DB_PASS=$(openssl rand -hex 16)
JWT=$(openssl rand -hex 32)

cat > .env << EOF
# Database (localhost 因為 Node 跑在 host，DB 容器 port 5432 mapped to host)
DATABASE_URL=postgresql://comux:${DB_PASS}@localhost:5432/comux?schema=public
POSTGRES_PASSWORD=${DB_PASS}

# Auth JWT
COMUX_SECRET=${JWT}

# 專案根目錄
PROJECTS_ROOT=/home/devops/projects

# Domain / SSL
VIRTUAL_HOST=comux.yoursite.com
LETSENCRYPT_EMAIL=you@example.com

# WS origin allowlist
ALLOWED_ORIGINS=comux.yoursite.com,localhost

# Cloudflare (選用，DNS 管理功能才需要)
CF_API_TOKEN=
CF_ZONE_ID=
EOF

# 安裝依賴 + build
npm ci
npm run build
```

## 5. 啟動 DB + nginx-proxy

```bash
# wp-proxy network 必須已存在 (nginx-proxy-automation 那組)
docker network create wp-proxy 2>/dev/null || true

# 起 DB + prod-proxy (socat)
# 注意 .env 裡含逗號的值（例如 ALLOWED_ORIGINS）要先手動 export，
# 否則 docker compose v5 會在第一個逗號截斷，導致 nginx-proxy 註冊錯 hostname。
set -a; . ./.env; set +a
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d

# 確認
docker ps | grep -E 'comux|postgres'
```

## 6. Push DB schema

```bash
cd ~/comux
npm run db:push
```

## 7. systemd 管理 comux

```bash
# 複製 unit file (視情況調整 User/WorkingDirectory 路徑)
sudo cp docs/deploy/comux.service /etc/systemd/system/comux.service
sudo nano /etc/systemd/system/comux.service   # 確認 User=, WorkingDirectory=, EnvironmentFile= 路徑對

sudo systemctl daemon-reload
sudo systemctl enable --now comux

# 檢查
sudo systemctl status comux
sudo journalctl -u comux -f
```

## 8. 驗證

```bash
# Node 跑在 host
curl -s http://localhost:3000/api/auth/check

# 容器 proxy 也通
docker exec comux-proxy nc -zv host.docker.internal 3000

# nginx-proxy 有簽憑證後
curl -I https://comux.yoursite.com
```

瀏覽器開 `https://comux.yoursite.com`，建 admin 帳號 → 專案 → Terminal 輸入 `claude`。

---

## 更新 comux

```bash
cd ~/comux
git pull
npm ci
npm run build
sudo systemctl restart comux
# tmux session 不受影響（獨立 daemon）
```

## 常用 debug

```bash
# Node log
sudo journalctl -u comux -f

# 代理容器 log
docker logs comux-proxy -f

# DB 直接連
docker exec -it $(docker compose ps -q db) psql -U comux

# tmux (直接在 host，不透過容器)
tmux list-sessions
tmux attach -t <project-name>
```

---

## macOS 本機開發

本機流程未變：

```bash
cd ~/next/comux
brew install tmux
npm install -g @anthropic-ai/claude-code

docker compose up -d db dev-proxy
npm run dev

# http://comux.test
```

`npm run dev` 跑兩個進程（Next.js port 3000 + WS port 3001），`dev-proxy` 容器把
`comux.test` 流量從 nginx-proxy 轉到宿主機 port 3000

## 個人專案正式機

網址: https://comux.audilu.com
已透過加入tailscale 能用以下ssh指令登入，且需要時也能用sudo su切換成管理者權限:

```
devops@linode-audi-inv
```

## 泛科專案正式機

網址: https://comux.pangogo.com（機器：`lobster-9527`，tag:pan-devops）

```
ssh devops_bot@lobster-9527   # comux 跑在 /home/devops_bot/comux (systemd: comux.service)
ssh root@lobster-9527         # systemctl restart comux 需要 root
```

DB 容器名為 `webmux-db-1`（歷史命名），psql 帳號/DB 皆為 `comux`。
