#!/usr/bin/env sh
set -eu

cd /app

corepack enable
pnpm config set store-dir /app/node_modules/.pnpm-store

if [ ! -x node_modules/.bin/tsc ]; then
  pnpm config set registry "${NPM_REGISTRY:-https://registry.npmjs.org}"
  pnpm install --frozen-lockfile --ignore-scripts
  pnpm rebuild esbuild better-sqlite3
fi

exec node /app/docker/hot-reload.mjs
