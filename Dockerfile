# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first (Docker layer caching)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Use the per-environment .env file if present (Cloud Build sets ENV_FILE build arg)
# Default to .env.dev for direct MCP deploys
ARG ENV_FILE=.env.dev
RUN cp ${ENV_FILE} .env

# Build the static SPA — Vite reads .env automatically
RUN npm run build

# ── Stage 2: Serve with Nginx ──────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
