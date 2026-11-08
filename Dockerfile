FROM node:22-slim AS base

# --- Dependencies ---
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci || npm install

# --- Builder ---
FROM base AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# --- Runner ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# tmux + git + tools (Claude Code binary runs from host via volume mount)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl tmux git curl bash openssh-client python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install prod-server runtime deps (ws, node-pty, jsonwebtoken, pg — WS 驗證要查 DB)
RUN npm init -y > /dev/null 2>&1 && \
    npm install --omit=dev ws node-pty@1.0.0 jsonwebtoken pg 2>/dev/null | tail -1

# Remove build tools after native compile
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* || true

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Prisma 7 generated client + adapter
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/pg ./node_modules/pg

# Custom production server（+ 它 require 的共用 CJS 模組，例如 COMUX_SECRET 檢查）
COPY --from=builder /app/prod-server.js ./server.js
COPY --from=builder /app/server-shared ./server-shared

EXPOSE 3000
ENV PORT=3000
# 容器內必須聽 0.0.0.0，port 才轉得出容器；對外暴露與否由容器網路決定
# （compose 不要 publish 到公網介面，要 publish 也只綁 127.0.0.1:3000:3000）。
# 宿主機直接跑 prod-server.js 時預設是 127.0.0.1，不受這行影響。
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
