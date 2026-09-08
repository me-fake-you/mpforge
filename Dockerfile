# 构建阶段
FROM node:22-bookworm-slim AS builder

ARG MPFORGE_NETWORK_MODE=mock-only
ARG MPFORGE_REAL_WECHAT_DISABLED=true
ARG MPFORGE_DEMO_MODE=true
ENV MPFORGE_NETWORK_MODE=${MPFORGE_NETWORK_MODE} \
    MPFORGE_REAL_WECHAT_DISABLED=${MPFORGE_REAL_WECHAT_DISABLED} \
    MPFORGE_DEMO_MODE=${MPFORGE_DEMO_MODE} \
    VITE_MPFORGE_DEMO_MODE=${MPFORGE_DEMO_MODE}

WORKDIR /build

# 复制依赖相关文件
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# 使用与仓库一致的 pnpm 版本，避免 latest 带来不兼容
RUN corepack enable && \
    corepack prepare pnpm@9.0.2 --activate && \
    pnpm install --frozen-lockfile && \
    pnpm --filter @mpforge/web run build

# 运行阶段 - 使用 nginx 提供静态文件服务
FROM nginx:alpine

# 复制构建产物
COPY --from=builder /build/apps/web/dist /usr/share/nginx/html

# 复制 nginx 配置（支持 SPA 路由）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
