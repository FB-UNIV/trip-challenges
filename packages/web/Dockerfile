# Build the PWA, serve static via nginx. TLS/headers handled at the edge (Traefik).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
RUN npm install --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY packages/web packages/web
# Build @trip/shared first so vite's production build resolves it to dist/index.js.
RUN npm run build --workspace @trip/shared
RUN npm run build --workspace @trip/web

FROM nginx:1.27-alpine AS runtime
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
EXPOSE 80
