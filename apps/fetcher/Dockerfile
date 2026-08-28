# Host-agnostic: Fly, Oracle, Hetzner, Railway, a Raspberry Pi. Nothing in here
# knows where it runs.
#
# Build from the repo root, because the guard is shared with the Worker:
#   docker build -f apps/fetcher/Dockerfile -t marklayer-fetcher .

FROM oven/bun:1.3.14-slim AS build
WORKDIR /src

# Only the two files the bundle actually needs. A workspace symlink resolves the
# import with no install and no network — @marklayer/types/net is dependency-free,
# which is the whole reason the relay imports that subpath rather than the index.
COPY packages/types/package.json packages/types/package.json
COPY packages/types/src/net.ts packages/types/src/net.ts
COPY apps/fetcher/package.json apps/fetcher/package.json
COPY apps/fetcher/src apps/fetcher/src
RUN mkdir -p node_modules/@marklayer \
 && ln -s /src/packages/types node_modules/@marklayer/types \
 && bun build apps/fetcher/src/server.ts --target=bun --minify --outfile /out/server.js

FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY --from=build /out/server.js .

# Runs as bun, not root: the image's whole job is fetching URLs strangers chose.
USER bun
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "server.js"]
