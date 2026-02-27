# ── Dev stage ────────────────────────────────────────────────────────────────
# Used by docker-compose.override.yml (build.target: dev).
# Source code is mounted as a volume at runtime — only node_modules are baked in.
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json ./
RUN npm install
# Source mounted at runtime; node_modules stay in the image layer
CMD ["npm", "run", "dev", "--", "--host"]

# ── Production build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
