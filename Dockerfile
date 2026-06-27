# METAorder-v2 — Production-Image (API + gebaute SPA)
# Build: docker build -t metaorder-v2 .
# Compose: docker compose up --build
#
# Ein Stage statt Builder+Runner: vermeidet (1) zweites `npm ci` und (2) großes
# `COPY node_modules` zwischen Stages — beides erhöht die Spitzenlast auf der
# Docker-Disk und triggert bei knappem Speicher ENOSPC. Nach `npm prune` bleiben
# nur Runtime-Dependencies; `client/` wird entfernt (SPA liegt unter dist/public).

FROM node:22-bookworm-slim

WORKDIR /app

ENV UPLOADS_DIR=/app/uploads
# Nicht vor `npm ci`: bei NODE_ENV=production würde npm keine devDependencies installieren (Vite/esbuild fehlen).

COPY package.json package-lock.json* .npmrc ./
RUN npm ci && npm cache clean --force

COPY . .

ENV NODE_ENV=production

# pdf-parse haengt an @napi-rs/canvas, das standardmaessig **alle** Plattform-Binaer
# (darwin, musl, x64, arm64, …) unter node_modules legt — mehrere hundert MB und
# haeufig ENOSPC beim Image-Export. Im Debian-glibc-Image reicht eine GNU-Variante.
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force \
  && ARCH=$(dpkg --print-architecture 2>/dev/null || echo amd64) \
  && case "$ARCH" in \
       arm64) KEEP="canvas-linux-arm64-gnu" ;; \
       amd64) KEEP="canvas-linux-x64-gnu" ;; \
       armhf) KEEP="canvas-linux-arm-gnueabihf" ;; \
       riscv64) KEEP="canvas-linux-riscv64-gnu" ;; \
       *) KEEP="canvas-linux-x64-gnu" ;; \
     esac \
  && if [ -d node_modules/@napi-rs ]; then \
       find node_modules/@napi-rs -mindepth 1 -maxdepth 1 -type d -name "canvas-*" ! -name "$KEEP" -exec rm -rf {} + ; \
     fi \
  && rm -rf client \
  && chmod +x scripts/docker-entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
