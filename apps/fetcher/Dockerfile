# Host-agnostic: Fly, Oracle, Hetzner, Railway, a Raspberry Pi. Nothing in here
# knows where it runs.
#
# Build from the repo root, because the guard is shared with the Worker:
#   docker build -f apps/fetcher/Dockerfile -t marklayer-fetcher .

FROM oven/bun:1.3.14-slim AS build
WORKDIR /src

# Whole source trees, so a new import between workspace files cannot break only this
# image. A workspace symlink resolves each import with no install and no network,
# because what the relay reaches has no third-party deps; bundle.test.ts holds that.
COPY packages/types/package.json packages/types/package.json
COPY packages/types/src packages/types/src
COPY packages/brand/package.json packages/brand/package.json
COPY packages/brand/src packages/brand/src
COPY apps/fetcher/package.json apps/fetcher/package.json
COPY apps/fetcher/src apps/fetcher/src
RUN mkdir -p node_modules/@marklayer \
 && ln -s /src/packages/types node_modules/@marklayer/types \
 && ln -s /src/packages/brand node_modules/@marklayer/brand \
 && bun build apps/fetcher/src/server.ts --target=bun --minify --outfile /out/server.js

FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY --from=build /out/server.js .

# Runs as bun, not root: the image's whole job is fetching URLs strangers chose.
USER bun
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "server.js"]
