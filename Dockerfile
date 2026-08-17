# Build stage
#
# node:24-alpine tracks the ACTIVE LTS line (24, Krypton) — not the newest tag.
# Verified 2026-08-17: the two current LTS majors are 24 and 22, and the tag
# resolves to v24.19.0. Refresh the digest and re-check the tag together; a stale
# tag is invisible if only the digest is re-resolved.
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# Runtime
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The server reports its version from package.json at runtime.
COPY package.json package-lock.json ./

# Ownership proof for the MCP Registry: must match server.json's name exactly.
LABEL io.modelcontextprotocol.server.name="io.github.ni-c/audiobookshelf-mcp"

# Drop root: the node image ships an unprivileged `node` user (uid 1000).
USER node

# stdio transport only — no port, no healthcheck, and no child processes, so no
# tini either. The server starts without credentials (tools stay listable, so
# registries and sandbox inspectors can introspect it); every call then fails
# with the setup instructions instead of reaching the API.
#
# Run it with:
#   docker run -i --rm \
#     -e AUDIOBOOKSHELF_URL=https://abs.example.com \
#     -e AUDIOBOOKSHELF_API_KEY=… \
#     ghcr.io/ni-c/audiobookshelf-mcp
ENTRYPOINT ["node", "dist/index.js"]
