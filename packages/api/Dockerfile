# Multi-stage: build workspace, ship a slim non-root runtime.
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN npm install --workspaces --include-workspace-root
COPY packages/shared packages/shared
COPY packages/api packages/api
# Build @trip/shared to JS first — the runtime is plain `node` (no .ts loader),
# so the API's compiled imports of @trip/shared must resolve to dist/index.js.
RUN npm run build --workspace @trip/shared
RUN npm run build --workspace @trip/api

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# argon2 needs to be present as a native dep; copy resolved node_modules.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/api/dist ./packages/api/dist
# SQL migrations, applied by the API at boot (src/migrate.ts resolves ../db/migrations).
COPY --from=build /app/packages/api/db/migrations ./packages/api/db/migrations
COPY --from=build /app/packages/api/package.json ./packages/api/package.json
USER node
EXPOSE 3000
CMD ["node", "packages/api/dist/server.js"]
