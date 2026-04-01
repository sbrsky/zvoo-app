# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first (Docker layer caching)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source
COPY . .

# Accept env vars as build args (Vite bakes them at build time)
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_GEMINI_API_KEY
ARG VITE_ADMIN_EMAILS

# Build the static SPA
RUN npm run build

# ── Stage 2: Serve with Nginx ──────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
