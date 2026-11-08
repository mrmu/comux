# comux 部署指南

## 架構

```
Linux Host (VPS)
├── dev user (e.g. deploy)
│   ├── tmux server          ← session 持久化
│   ├── Claude Code CLI      ← Max Plan 登入
│   ├── Node.js + comux      ← systemd 管理，只聽 127.0.0.1:3000
│   └── ~/.claude/           ← 認證 + 設定
│
├── Tailscale Serve          ← tailnet 內 HTTPS:443 → http://127.0.0.1:3000
│                              （公網完全看不到 comux）
└── Docker
    └── PostgreSQL           ← 專案 metadata + 用戶帳號（只綁 127.0.0.1:5432）
```

comux 本身**不跑在容器裡** — 直接在宿主機用 `systemd` 管理。
容器版本的舊部署因為要假冒 host user (UID/GID mount + pid:host + home mount)
太脆弱，Claude Code 或路徑變動容易整個壞掉，所以全砍。

> **comux 等於這台主機的網頁 shell。** 只透過 Tailscale Serve（或其他只在私有網路
> 可達的反向代理）存取，不要直接開到公網。舊的 nginx-proxy + socat 公網做法見文末
> 「附錄：nginx-proxy 公網模式（不建議）」。

---

## 1. 建立 dev user

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
id deploy   # 記下 uid/gid
```

## 2. 安裝宿主機工具

以 dev user 登入：

```bash
su - deploy

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

## 3. Tailscale（必要）

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status   # 記下這台機器的 MagicDNS 名稱，例如 your-host.your-tailnet.ts.net
```

tailnet 管理後台需開啟 MagicDNS 與 HTTPS Certificates，Tailscale Serve 才能簽憑證。

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

# Auth JWT（必填，≥ 32 字元；未設 / 太短 / 公開預設值 → comux 拒絕啟動）
COMUX_SECRET=${JWT}

# 專案根目錄
PROJECTS_ROOT=/home/deploy/projects

# 監聽位址（預設就是 127.0.0.1；寫出來提醒自己不要改成 0.0.0.0）
HOSTNAME=127.0.0.1

# Tailscale Serve 從本機連進來：信任 loopback 的 X-Forwarded-For（登入限流才分得出裝置）
TRUSTED_PROXIES=127.0.0.1,::1

# WS / CSRF origin allowlist：Tailscale Serve 的 MagicDNS 名稱
ALLOWED_ORIGINS=your-host.your-tailnet.ts.net,localhost

# Cloudflare (選用，DNS 管理功能才需要)
CF_API_TOKEN=
CF_ZONE_ID=
EOF

# 安裝依賴 + build
npm ci
npm run build
```

## 5. 啟動 DB

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d db

# 確認
docker ps | grep postgres
```

## 6. 建立 DB schema

```bash
cd ~/comux
npm run db:deploy   # = npx prisma migrate deploy
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

## 8. Tailscale Serve

```bash
# tailnet 內 HTTPS:443 → 本機 comux
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

`--bg` 會把設定存起來，重開機後自動恢復。要撤掉：`sudo tailscale serve --https=443 off`。

## 9. 驗證

```bash
# Node 只聽 loopback（應該只看到 127.0.0.1:3000，不能有 0.0.0.0:3000 / *:3000）
ss -ltnp | grep 3000
curl -s http://127.0.0.1:3000/api/auth/check

# 從 tailnet 內另一台裝置
curl -I https://your-host.your-tailnet.ts.net
```

用已登入 Tailscale 的裝置開 `https://your-host.your-tailnet.ts.net`，
建 admin 帳號 → 專案 → Terminal 輸入 `claude`。

建立第一個 admin 帳號需要 **setup token**：系統裡還沒有任何使用者時，comux 啟動會把
一次性的 token 印在 log（`sudo journalctl -u comux | grep -A3 "setup token"`），
註冊頁要填這個值。也可以在 `.env` 預先設 `COMUX_SETUP_TOKEN=<至少 16 字元的隨機值>`。
第一個帳號建立後 token 立即作廢，之後的帳號只能由已登入的使用者在帳號頁新增。

---

## 更新 comux

```bash
cd ~/comux
git pull
npm ci
npm run build
npm run db:deploy   # 套用新的 migration（= npx prisma migrate deploy）
sudo systemctl restart comux
# tmux session 不受影響（獨立 daemon）
```

### 從 `db push` 時代升級（一次性 baseline）

早期版本沒有 migration 歷史，是用 `npm run db:push` 同步 schema。這類既有 DB
第一次跑 `migrate deploy` 會出現 `P3005 The database schema is not empty`，
先把初始 migration 標記為已套用，再 deploy：

```bash
npx prisma migrate resolve --applied 0_init
npm run db:deploy
```

（`0_init` 等同 `db push` 時代的完整 schema；之後的 migration，例如
`users.token_version`，才會實際執行。）

## 常用 debug

```bash
# Node log
sudo journalctl -u comux -f

# Tailscale Serve 設定
tailscale serve status

# DB 直接連
docker exec -it $(docker compose ps -q db) psql -U comux

# tmux (直接在 host，不透過容器)
tmux list-sessions
tmux attach -t <project-name>
```

---

## macOS 本機開發

```bash
cd ~/next/comux
brew install tmux
npm install -g @anthropic-ai/claude-code

# 本機也要設 COMUX_SECRET（≥ 32 字元；未設或用預設值時 dev server 拒絕啟動）
cp .env.example .env
#   把 `openssl rand -hex 32` 的結果填進 .env 的 COMUX_SECRET=

docker compose up -d db dev-proxy
npm run dev

# http://comux.test
```

`npm run dev` 跑兩個進程（Next.js port 3000 + WS port 3001），兩者都只聽 `127.0.0.1`。
`dev-proxy` 容器把 `comux.test` 流量從 nginx-proxy 轉到宿主機 port 3000（Docker Desktop
的 `host.docker.internal` 會轉到宿主機的 loopback）。若你的 Docker 環境連不到宿主機
loopback，可暫時用 `COMUX_DEV_HOST=0.0.0.0 npm run dev`，但要確定這台機器不在不信任的網路上。

---

## 附錄：nginx-proxy 公網模式（不建議）

早期的部署方式是用 `docker-compose.production.yml` 裡的 `prod-proxy`（socat 容器）
掛到 nginx-proxy-automation 的 `wp-proxy` network，讓 acme-companion 依
`VIRTUAL_HOST` / `LETSENCRYPT_HOST` 自動簽 Let's Encrypt 憑證，把 comux 開到公網。

**不建議這樣做**，原因：

- comux 等於主機的網頁 shell（終端機直接 attach tmux），公開後唯一的防線只剩登入頁；
  任何 Next.js / ws / 認證邏輯的漏洞都會直接變成遠端拿 shell
- 登入頁會被全網掃描與暴力破解
- socat 容器連不到宿主機的 `127.0.0.1`，comux 必須改聽 `0.0.0.0`，還得自己用防火牆
  擋掉公網直連 3000，設錯一步就整個裸露

真的需要時（例如沒辦法裝 Tailscale 的裝置），至少要：comux 前面再加一層 IP allowlist
或 SSO、防火牆只開 443、`prod-proxy` 用 `--profile public-proxy` 明確啟用，並在 `.env`
設好 `VIRTUAL_HOST` / `LETSENCRYPT_EMAIL` / `ALLOWED_ORIGINS`。

---

## 多台正式機

實際主機名、網址、SSH 帳號、安裝路徑與 Tailscale tag 記在內部部署筆記（不放公開 repo）。
每台的通則：

- 以部署帳號透過 Tailscale SSH 登入（`ssh <deploy-user>@<host>`），需要時 `sudo` 切 root
- comux 裝在部署帳號家目錄下，systemd 服務 `comux.service`，`systemctl restart comux` 需 root
- 對外只走 `tailscale serve`，網址為 `https://<host>.<your-tailnet>.ts.net`
- DB 容器名為 `webmux-db-1`（歷史命名，見 `docker-compose.yml` 的 `name:`），psql 帳號/DB 皆為 `comux`
