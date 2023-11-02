pnpm esbuild \
  --bundle \
  --outfile=dist/wrapFetch.js \
  --sourcemap=linked \
  --metafile=metafile-fetch.json \
  --format=esm \
  --target=es2022 \
  scripts/worker/builder.ts

pnpm esbuild \
  --banner:js="#! /usr/bin/env node" \
  --bundle \
  --outfile=dist/bin.mjs \
  --sourcemap=linked \
  --metafile=metafile.json \
  --platform=node \
  --packages=external \
  --format=esm \
  --target=es2022 \
  scripts/index.ts
