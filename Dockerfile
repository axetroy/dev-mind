# =============================================================================
# dev-mind — AI Code Review Agent
# 多阶段 Docker 构建
# =============================================================================

# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:23-alpine AS deps

WORKDIR /app

# 复制依赖清单
COPY package.json package-lock.json* ./

# 安装生产依赖（跳过 devDependencies）
RUN npm ci --omit=dev --ignore-scripts

# ─── Stage 2: Build (currently no build step, but keep for future TS/Babel) ──
FROM node:23-alpine AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 语法检查
RUN node --check src/index.js && node --check src/cli.js

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:23-alpine AS production

WORKDIR /app

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 只复制运行所需的文件
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appgroup /app/src ./src
COPY --from=build --chown=appuser:appgroup /app/package.json ./

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:${PORT:-3000}/health').then(r => process.exit(r.ok?0:1)).catch(() => process.exit(1))"

# 切换到非 root 用户
USER appuser

EXPOSE 3000

CMD ["node", "src/index.js"]
