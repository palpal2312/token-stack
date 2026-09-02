# S17 packaging: multi-stage build for the app + sen-plane daemon.
# Go stage: builds sen-plane AND runs go vet/test (the go:check reuse).
# Node stage: compiles node-pty (native) with the full toolchain, then builds
# Next; runtime stage copies only build artifacts + native modules.
FROM golang:1.26-bookworm AS go
WORKDIR /src/go
COPY go/go.mod go/go.sum* ./
COPY go/ .
RUN go build -o /out/sen-plane.exe ./cmd/sen-plane && go vet ./... && go test ./internal/... ./cmd/sen-plane

FROM node:24-bookworm-slim AS nodebuild
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libtool automake && rm -rf /var/lib/apt/lists/*
# COPY before npm ci so the postinstall script (scripts/copy-ghostty-wasm.mjs)
# exists in the image when npm runs lifecycle hooks.
COPY . .
RUN npm ci
ENV AGENTIC_OS_NEXT_DIST_DIR=.next
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    AGENTIC_OS_HOST=0.0.0.0 \
    AGENTIC_OS_PORT=3737 \
    PORT=3737 \
    SEN_DAEMON_URL=http://127.0.0.1:3979 \
    AGENTIC_OS_ALLOW_TEST_FIXTURE=0
WORKDIR /app
COPY --from=go /out/sen-plane.exe /usr/local/bin/sen-plane
COPY --from=nodebuild /app/.next ./.next
COPY --from=nodebuild /app/public ./public
COPY --from=nodebuild /app/package.json /app/package-lock.json* ./
COPY --from=nodebuild /app/node_modules ./node_modules
COPY --from=nodebuild /app/next.config.* ./
COPY --from=nodebuild /app/server.ts ./
COPY --from=nodebuild /app/src ./src
COPY --from=nodebuild /app/tsconfig.json ./
EXPOSE 3737
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "require('http').get('http://127.0.0.1:3737/api/orchestration/state',r=>process.exit(r.statusCode>=500?1:0)).on('error',()=>process.exit(1))" || exit 1
CMD ["sh","-c","sen-plane & exec npm start"]
