# ── Dev stage ────────────────────────────────────────────────────────────────
# Used by docker-compose.override.yml (build.target: dev).
# Source code is mounted as a volume at runtime — only node_modules are baked in.
FROM node:24-alpine AS dev
RUN corepack enable npm && corepack prepare npm@11 --activate
WORKDIR /app
COPY package*.json ./
RUN npm install
# Source mounted at runtime; node_modules stay in the image layer
CMD ["npm", "run", "dev", "--", "--host"]

# ── Production build ─────────────────────────────────────────────────────────
FROM --platform=linux/amd64 node:24-alpine AS builder
RUN corepack enable npm && corepack prepare npm@11 --activate
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
