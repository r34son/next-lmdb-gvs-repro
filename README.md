# Next.js Turbopack + pnpm GVS + transitive LMDB

Minimal reproduction of a standalone deployment that contains LMDB's native
binary but cannot resolve its platform package from the relocated LMDB package.

Tested with Node.js 22.23.4, pnpm 12.18.0, Next.js 16.5.0-canary.48,
LMDB 2.9.4, and macOS arm64. Next canary.48 was the latest published npm
canary when tested on 2026-11-13. Linux has not been tested here.

## Reproduce

With Node.js and pnpm 12.18.0 installed:

```sh
pnpm install --frozen-lockfile
pnpm repro
```

The configured global virtual store is outside the app, in the sibling directory
`../next-lmdb-gvs-store`. Both Next roots remain the app directory. LMDB is only a
transitive dependency through the small local `lmdb-consumer` package.

`pnpm repro` builds the app, copies `.next/standalone` into a temporary directory,
checks that all symlinks resolve inside that copy, starts it, and requests the ESM
and CJS routes. Both routes would perform an actual LMDB write/read if the native
module could load. The script removes `LMDB_PREBUILD`, `NODE_PATH`, `NODE_OPTIONS`,
and `NEXT_TEST_NATIVE_DIR` from its build/server environments. It does not add or
repair any symlinks and does not modify dependencies or the copied artifact.

Expected: both requests return HTTP 200. Actual: the build succeeds, but the
verification exits with status 1 and reports:

```text
All standalone symlinks resolve inside the copied artifact.
Native package included: true
Native binary included: true
LMDB dependency symlink included: false
Native package resolves from LMDB: MODULE_NOT_FOUND
/: HTTP 500; LMDB read/write passed: false
/cjs: HTTP 500; LMDB read/write passed: false
```

The server reports `No native build was found` for `@lmdb/lmdb-darwin-arm64`.

## Relevant configuration

```js
serverExternalPackages: ['lmdb'],
outputFileTracingIncludes: {
  '/**/*': [
    `./node_modules/.pnpm/node_modules/@lmdb/lmdb-${process.platform}-${process.arch}/**/*`,
  ],
},
```

The native package's files and the application's private hoist alias are copied.
The different symlink used by LMDB's native loader is omitted:

```text
<GVS>/@/lmdb/2.9.4/<hash>/node_modules/
  lmdb/
  @lmdb/lmdb-<platform>-<arch> -> <native package>   # missing in standalone
```

`node-gyp-build-optional-packages` resolves the platform package using a require
function created from the real LMDB directory. The application's private alias
at `node_modules/.pnpm/node_modules/@lmdb/...` is not on that resolution path.

This is a runtime dependency-resolution failure, not an ABI mismatch: the native
binary is present in the copied standalone, but the required package cannot be
resolved from LMDB.

The two routes and `next.config.mjs` contain the app reproduction. The script in
`scripts/` only automates build, relocation, observation, and cleanup. There are
no application-specific integrations or private packages.

The reproduction was prepared with assistance from Codex.
